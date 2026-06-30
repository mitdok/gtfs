/**
 * GTFS Studio バックエンドAPI（依存ゼロ・node:http）。
 *
 * 提供するもの:
 * - 仕様ロックの取得・保存（10.2）。永続化は `SpecLockRepository`。
 * - 検収の実行（11.4）。zip(base64) と任意の validator report から
 *   `runAcceptancePipeline` を回し、11.5 形式の検収結果を返す。
 * - GTFS-RT 外部中継（RT-2）。source 登録・poll・状態・`.pb` 再配信。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  buildRealtimeTripIndex,
  evaluateRealtimeTripMatching,
  importGtfsZip,
  matchedTripDelayToTripUpdate,
  runAcceptancePipeline,
  tripProgressToTripUpdate,
  type SpecLock,
  type SpecLockId,
  type RealtimeTripMatchProbe,
} from "@gtfs-studio/core";
import {
  RT_FRESHNESS_SLO_SEC,
  checkRealtimeStaticCompatibility,
  validateRealtimeFeed,
  type RtFeedType,
  type RtSource,
} from "@gtfs-studio/core/realtime";
import type {
  RealtimeAlertStore,
  RealtimeTripUpdateStore,
  RealtimeVehicleStore,
  ServiceAlertInput,
  TripUpdateInput,
  VehiclePositionInput,
} from "@gtfs-studio/core/realtime";
import type { SpecLockRepository } from "./spec-lock-repository.js";
import type { RtRelayService } from "./rt-relay.js";

const VALID_LOCK_IDS: SpecLockId[] = [
  "GTFS_SCHEDULE_LOCK",
  "GTFS_JP_V4_LOCK",
  "GOOGLE_TRANSIT_LOCK",
  "VALIDATOR_LOCK",
];

export interface ApiOptions {
  repository: SpecLockRepository;
  /** ISO 文字列を返す時刻ソース（テストで固定するため差し替え可能）。 */
  now?: () => string;
  /** GTFS-RT 外部中継サービス（未指定なら /rt 系は 501）。 */
  rtRelay?: RtRelayService;
  /** 手動ServiceAlerts保存・配信用ストア（未指定なら /rt/alerts 系は 501）。 */
  rtAlerts?: RealtimeAlertStore;
  /** VehiclePositions保存・配信用ストア（未指定なら /rt/vehicles 系は 501）。 */
  rtVehicles?: RealtimeVehicleStore;
  /** TripUpdates保存・配信用ストア（未指定なら /rt/trip-updates 系は 501）。 */
  rtTripUpdates?: RealtimeTripUpdateStore;
  /** `.pb` 再配信時の age 算定基準（Unix秒）。テスト用。既定は実時刻。 */
  rtNow?: () => number;
  /**
   * VehiclePositions書き込み用source token。
   * 未指定または空配列なら互換性のため認証しない。
   */
  rtVehicleTokens?: string[];
  /**
   * VehiclePositions書き込み用のtoken単位レート制限。
   * 既定は 60 requests / 60s。token認証が無効な場合は適用しない。
   */
  rtVehicleRateLimit?: { windowMs: number; max: number };
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { ...corsHeaders(), "content-type": "application/json; charset=utf-8" });
  res.end(text + "\n");
}

function sendBytes(res: ServerResponse, status: number, bytes: Uint8Array, headers: Record<string, string>) {
  res.writeHead(status, { ...corsHeaders(), "content-type": "application/x-protobuf", ...headers });
  res.end(Buffer.from(bytes));
}

function sendNoContent(res: ServerResponse) {
  res.writeHead(204, corsHeaders());
  res.end();
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-rt-source-token",
  };
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 64 * 1024 * 1024) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (raw === "") return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error(`invalid JSON body: ${(e as Error).message}`));
      }
    });
    req.on("error", reject);
  });
}

function extractBearer(auth: string | undefined): string | undefined {
  const match = auth?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

/** 検収リクエストの本体。 */
interface AcceptanceRequest {
  zipBase64?: string;
  profileId?: string;
  validationDate?: string;
  standardReport?: unknown;
  realFeedRoundtrip?: { standardErrors: number };
  v3Migration?: { standardErrors: number; warningsReasonable?: boolean };
  publicUrl?: { verified: boolean; standardErrors?: number };
  releaseCandidate?: string;
}

interface RtFreshnessStatus {
  feedType: RtFeedType;
  configured: boolean;
  status: "fresh" | "stale" | "no_data" | "not_configured";
  sloSec: number;
  ageSec?: number;
  entityCount: number;
  latestUpdatedAt?: string;
  sourceId?: string;
  lastError?: string;
}

type RtAuditAction =
  | "alert.upsert"
  | "alert.delete"
  | "vehicle.upsert"
  | "vehicle.delete"
  | "trip_update.upsert"
  | "trip_update.delete"
  | "source.upsert"
  | "source.delete"
  | "source.poll"
  | "source.feed_blocked"
  | "smoke.run";

interface RtAuditEvent {
  id: number;
  at: string;
  action: RtAuditAction;
  targetType: "alert" | "vehicle" | "trip_update" | "source" | "smoke";
  targetId: string;
  outcome: "success" | "failed" | "blocked";
  detail?: Record<string, unknown>;
}

interface RtSmokeRequest {
  url?: string;
  feedType?: RtFeedType;
  timeoutMs?: number;
}

interface VehicleTripUpdateRequest {
  zipBase64?: string;
  atTime?: string | number;
  delaySec?: number;
  serviceId?: string;
  directionId?: number;
  atStopId?: string;
  maxTimeDiffSec?: number;
  maxStopDistanceMeters?: number;
  id?: string;
  save?: boolean;
}

interface TripMatchingEvaluateRequest {
  zipBase64?: string;
  probes?: RealtimeTripMatchProbe[];
}

interface RtStaticCompatRequest {
  zipBase64?: string;
  feedBase64?: string;
}

export function createApiServer(options: ApiOptions): Server {
  const { repository } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const rtVehicleTokens = new Set((options.rtVehicleTokens ?? []).filter((token) => token.trim() !== ""));
  const rtVehicleRateLimit = options.rtVehicleRateLimit ?? { windowMs: 60_000, max: 60 };
  const rtVehicleRateBuckets = new Map<string, number[]>();
  const rtAudit: RtAuditEvent[] = [];
  let nextAuditId = 1;

  return createServer((req, res) => {
    void handle(req, res).catch((e) => {
      sendJson(res, 400, { error: (e as Error).message });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (method === "OPTIONS") return sendNoContent(res);

    if (method === "GET" && (path === "/" || path === "/health")) {
      return sendJson(res, 200, { status: "ok", service: "gtfs-studio-api" });
    }

    if (path === "/spec-locks") {
      if (method === "GET") return sendJson(res, 200, { specLocks: repository.list() });
      return sendJson(res, 405, { error: "method not allowed" });
    }

    const lockMatch = path.match(/^\/spec-locks\/([A-Z_]+)$/);
    if (lockMatch) {
      const id = lockMatch[1] as SpecLockId;
      if (!VALID_LOCK_IDS.includes(id)) return sendJson(res, 404, { error: `unknown spec lock: ${id}` });

      if (method === "GET") {
        const lock = repository.get(id);
        return lock ? sendJson(res, 200, lock) : sendJson(res, 404, { error: "not found" });
      }
      if (method === "PUT") {
        const body = (await readJsonBody(req)) as Partial<SpecLock>;
        const lock: SpecLock = {
          ...body,
          id,
          status: body.status === "locked" ? "locked" : "missing",
          label: body.label ?? id,
          source: body.source ?? "",
        };
        return sendJson(res, 200, repository.upsert(lock));
      }
      return sendJson(res, 405, { error: "method not allowed" });
    }

    if (path === "/acceptance") {
      if (method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
      const body = (await readJsonBody(req)) as AcceptanceRequest;
      if (!body.zipBase64) return sendJson(res, 400, { error: "zipBase64 is required" });

      const zip = new Uint8Array(Buffer.from(body.zipBase64, "base64"));
      const result = runAcceptancePipeline({
        zip,
        profileId: body.profileId,
        validationDate: body.validationDate,
        standardReport: body.standardReport as never,
        specLocks: repository.snapshot(),
        realFeedRoundtrip: body.realFeedRoundtrip,
        v3Migration: body.v3Migration,
        publicUrl: body.publicUrl,
        releaseCandidate: body.releaseCandidate,
        executedAt: now(),
      });

      return sendJson(res, 200, {
        status: result.acceptance.status,
        acceptance: result.acceptance,
        gate: {
          status: result.gate.status,
          blockers: result.gate.blockers,
          requiredSpecLocks: result.gate.requiredSpecLocks,
        },
        validation: {
          gtfsJpV4: result.v4Validation.summary,
          googleTransitReady: result.googleValidation.summary,
        },
        importWarnings: result.importWarnings,
      });
    }

    // ---- GTFS-RT 手動ServiceAlerts（RT-1） / 外部中継（RT-2） ----
    if (path === "/rt/sources" || path.startsWith("/rt/")) {
      const rtNow = options.rtNow ?? (() => Math.floor(Date.now() / 1000));

      if (path === "/rt/status" && method === "GET") {
        return sendJson(res, 200, { feeds: evaluateRtFreshness(rtNow()) });
      }

      if (path === "/rt/audit" && method === "GET") {
        const limit = Number(url.searchParams.get("limit") ?? "100");
        const events = rtAudit.slice(-Math.max(1, Math.min(500, limit))).reverse();
        return sendJson(res, 200, { events });
      }

      if (path === "/rt/smoke") {
        if (method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
        const body = (await readJsonBody(req)) as RtSmokeRequest;
        if (!body.url) return sendJson(res, 400, { error: "url is required" });
        const result = await smokeRealtimeUrl(body, rtNow());
        recordAudit("smoke.run", "smoke", body.url, result.ok ? "success" : "failed", {
          stage: result.stage,
          httpStatus: result.httpStatus,
          error: result.error,
          stale: result.stale,
        });
        return sendJson(res, 200, result);
      }

      if (path === "/rt/alerts") {
        const store = options.rtAlerts;
        if (!store) return sendJson(res, 501, { error: "rt alerts are not configured" });
        if (method === "GET") return sendJson(res, 200, { alerts: store.list() });
        if (method === "POST") {
          const body = (await readJsonBody(req)) as Partial<ServiceAlertInput & { enabled: boolean }>;
          if (!body.id) return sendJson(res, 400, { error: "id is required" });
          const stored = store.upsert(body as ServiceAlertInput & { enabled?: boolean }, rtNow());
          recordAudit("alert.upsert", "alert", stored.id, "success", { method });
          return sendJson(res, 200, stored);
        }
        return sendJson(res, 405, { error: "method not allowed" });
      }

      if (path === "/rt/alerts.pb" && method === "GET") {
        const store = options.rtAlerts;
        if (!store) return sendJson(res, 501, { error: "rt alerts are not configured" });
        return sendBytes(res, 200, store.encode({ timestamp: rtNow(), activeAt: rtNow() }), {
          "cache-control": "no-cache",
        });
      }

      const alertMatch = path.match(/^\/rt\/alerts\/([^/]+)$/);
      if (alertMatch) {
        const store = options.rtAlerts;
        if (!store) return sendJson(res, 501, { error: "rt alerts are not configured" });
        const id = decodeURIComponent(alertMatch[1]!);
        if (method === "GET") {
          const alert = store.get(id);
          return alert ? sendJson(res, 200, alert) : sendJson(res, 404, { error: "not found" });
        }
        if (method === "PUT") {
          const body = (await readJsonBody(req)) as Partial<ServiceAlertInput & { enabled: boolean }>;
          const stored = store.upsert({ ...(body as ServiceAlertInput), id }, rtNow());
          recordAudit("alert.upsert", "alert", id, "success", { method });
          return sendJson(res, 200, stored);
        }
        if (method === "DELETE") {
          const removed = store.remove(id);
          recordAudit("alert.delete", "alert", id, removed ? "success" : "failed", { removed });
          return sendJson(res, 200, { removed });
        }
        return sendJson(res, 405, { error: "method not allowed" });
      }

      if (path === "/rt/vehicles") {
        const store = options.rtVehicles;
        if (!store) return sendJson(res, 501, { error: "rt vehicles are not configured" });
        if (method === "GET") return sendJson(res, 200, { vehicles: store.list() });
        if (method === "POST") {
          const auth = authorizeRtVehicleWrite(req);
          if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });
          const body = (await readJsonBody(req)) as Partial<VehiclePositionInput>;
          if (!body.id) return sendJson(res, 400, { error: "id is required" });
          const stored = store.upsert(body as VehiclePositionInput, rtNow());
          recordAudit("vehicle.upsert", "vehicle", stored.id, "success", { method });
          return sendJson(res, 200, stored);
        }
        return sendJson(res, 405, { error: "method not allowed" });
      }

      if (path === "/rt/vehicles.pb" && method === "GET") {
        const store = options.rtVehicles;
        if (!store) return sendJson(res, 501, { error: "rt vehicles are not configured" });
        return sendBytes(res, 200, store.encode({ timestamp: rtNow() }), {
          "cache-control": "no-cache",
        });
      }

      if (path === "/rt/trip-matching/evaluate") {
        if (method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
        const body = (await readJsonBody(req)) as TripMatchingEvaluateRequest;
        if (!body.zipBase64) return sendJson(res, 400, { error: "zipBase64 is required" });
        if (!Array.isArray(body.probes)) return sendJson(res, 400, { error: "probes must be an array" });
        const feed = importGtfsZip(new Uint8Array(Buffer.from(body.zipBase64, "base64"))).feed;
        const index = buildRealtimeTripIndex(feed);
        return sendJson(res, 200, evaluateRealtimeTripMatching(index, body.probes));
      }

      if (path === "/rt/static-compat/check") {
        if (method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
        const body = (await readJsonBody(req)) as RtStaticCompatRequest;
        if (!body.zipBase64) return sendJson(res, 400, { error: "zipBase64 is required" });
        if (!body.feedBase64) return sendJson(res, 400, { error: "feedBase64 is required" });
        const staticFeed = importGtfsZip(new Uint8Array(Buffer.from(body.zipBase64, "base64"))).feed;
        const { summary } = validateRealtimeFeed(new Uint8Array(Buffer.from(body.feedBase64, "base64")));
        return sendJson(res, 200, {
          summary,
          compatibility: checkRealtimeStaticCompatibility(staticFeed, summary),
        });
      }

      const vehicleTripUpdateMatch = path.match(/^\/rt\/vehicles\/([^/]+)\/trip-update$/);
      if (vehicleTripUpdateMatch) {
        const vehicleStore = options.rtVehicles;
        if (!vehicleStore) return sendJson(res, 501, { error: "rt vehicles are not configured" });
        if (method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
        const id = decodeURIComponent(vehicleTripUpdateMatch[1]!);
        const vehicle = vehicleStore.get(id);
        if (!vehicle) return sendJson(res, 404, { error: "vehicle not found" });
        const body = (await readJsonBody(req)) as VehicleTripUpdateRequest;
        if (!body.zipBase64) return sendJson(res, 400, { error: "zipBase64 is required" });
        if (body.atTime === undefined) return sendJson(res, 400, { error: "atTime is required" });
        if (body.delaySec === undefined) return sendJson(res, 400, { error: "delaySec is required" });

        const feed = importGtfsZip(new Uint8Array(Buffer.from(body.zipBase64, "base64"))).feed;
        const index = buildRealtimeTripIndex(feed);
        const timestamp = rtNow();
        const update = vehicle.tripId
          ? tripProgressToTripUpdate(index, {
              id: body.id ?? `${vehicle.id}-trip-update`,
              tripId: vehicle.tripId,
              atTime: body.atTime,
              delaySec: body.delaySec,
              timestamp,
              vehicleId: vehicle.vehicleId,
            })
          : matchedTripDelayToTripUpdate(index, {
              id: body.id ?? `${vehicle.id}-trip-update`,
              routeId: vehicle.routeId ?? "",
              serviceId: body.serviceId,
              directionId: body.directionId,
              atTime: body.atTime,
              atStopId: body.atStopId,
              latitude: vehicle.latitude,
              longitude: vehicle.longitude,
              maxTimeDiffSec: body.maxTimeDiffSec,
              maxStopDistanceMeters: body.maxStopDistanceMeters,
              delaySec: body.delaySec,
              timestamp,
              vehicleId: vehicle.vehicleId,
            });

        const saved = body.save ? options.rtTripUpdates?.upsert(update, rtNow()) : undefined;
        if (body.save && !options.rtTripUpdates) {
          return sendJson(res, 501, { error: "rt trip updates are not configured" });
        }
        if (saved) {
          recordAudit("trip_update.upsert", "trip_update", saved.id, "success", {
            method,
            sourceVehicleId: vehicle.id,
          });
        }
        return sendJson(res, 200, { vehicle, update, saved });
      }

      const vehicleMatch = path.match(/^\/rt\/vehicles\/([^/]+)$/);
      if (vehicleMatch) {
        const store = options.rtVehicles;
        if (!store) return sendJson(res, 501, { error: "rt vehicles are not configured" });
        const id = decodeURIComponent(vehicleMatch[1]!);
        if (method === "GET") {
          const vehicle = store.get(id);
          return vehicle ? sendJson(res, 200, vehicle) : sendJson(res, 404, { error: "not found" });
        }
        if (method === "PUT") {
          const auth = authorizeRtVehicleWrite(req);
          if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });
          const body = (await readJsonBody(req)) as Partial<VehiclePositionInput>;
          const stored = store.upsert({ ...(body as VehiclePositionInput), id }, rtNow());
          recordAudit("vehicle.upsert", "vehicle", id, "success", { method });
          return sendJson(res, 200, stored);
        }
        if (method === "DELETE") {
          const auth = authorizeRtVehicleWrite(req);
          if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });
          const removed = store.remove(id);
          recordAudit("vehicle.delete", "vehicle", id, removed ? "success" : "failed", { removed });
          return sendJson(res, 200, { removed });
        }
        return sendJson(res, 405, { error: "method not allowed" });
      }

      if (path === "/rt/trip-updates") {
        const store = options.rtTripUpdates;
        if (!store) return sendJson(res, 501, { error: "rt trip updates are not configured" });
        if (method === "GET") return sendJson(res, 200, { tripUpdates: store.list() });
        if (method === "POST") {
          const body = (await readJsonBody(req)) as Partial<TripUpdateInput>;
          if (!body.id) return sendJson(res, 400, { error: "id is required" });
          const stored = store.upsert(body as TripUpdateInput, rtNow());
          recordAudit("trip_update.upsert", "trip_update", stored.id, "success", { method });
          return sendJson(res, 200, stored);
        }
        return sendJson(res, 405, { error: "method not allowed" });
      }

      if (path === "/rt/trip-updates.pb" && method === "GET") {
        const store = options.rtTripUpdates;
        if (!store) return sendJson(res, 501, { error: "rt trip updates are not configured" });
        return sendBytes(res, 200, store.encode({ timestamp: rtNow() }), {
          "cache-control": "no-cache",
        });
      }

      const tripUpdateMatch = path.match(/^\/rt\/trip-updates\/([^/]+)$/);
      if (tripUpdateMatch) {
        const store = options.rtTripUpdates;
        if (!store) return sendJson(res, 501, { error: "rt trip updates are not configured" });
        const id = decodeURIComponent(tripUpdateMatch[1]!);
        if (method === "GET") {
          const update = store.get(id);
          return update ? sendJson(res, 200, update) : sendJson(res, 404, { error: "not found" });
        }
        if (method === "PUT") {
          const body = (await readJsonBody(req)) as Partial<TripUpdateInput>;
          const stored = store.upsert({ ...(body as TripUpdateInput), id }, rtNow());
          recordAudit("trip_update.upsert", "trip_update", id, "success", { method });
          return sendJson(res, 200, stored);
        }
        if (method === "DELETE") {
          const removed = store.remove(id);
          recordAudit("trip_update.delete", "trip_update", id, removed ? "success" : "failed", { removed });
          return sendJson(res, 200, { removed });
        }
        return sendJson(res, 405, { error: "method not allowed" });
      }

      const rt = options.rtRelay;
      if (!rt) return sendJson(res, 501, { error: "rt relay is not configured" });

      if (path === "/rt/sources") {
        if (method === "GET") return sendJson(res, 200, { sources: rt.store.sources() });
        return sendJson(res, 405, { error: "method not allowed" });
      }

      const pollMatch = path.match(/^\/rt\/sources\/([^/]+)\/poll$/);
      if (pollMatch && method === "POST") {
        const sourceId = decodeURIComponent(pollMatch[1]!);
        const result = await rt.poll(sourceId);
        recordAudit("source.poll", "source", sourceId, result.outcome === "failed" ? "failed" : "success", {
          outcome: result.outcome,
          status: result.status,
          error: result.error,
        });
        return sendJson(res, 200, result);
      }

      const statusMatch = path.match(/^\/rt\/sources\/([^/]+)\/status$/);
      if (statusMatch && method === "GET") {
        const id = decodeURIComponent(statusMatch[1]!);
        if (!rt.store.getSource(id)) return sendJson(res, 404, { error: `unknown rt source: ${id}` });
        const served = rt.store.serve(id, rtNow());
        return sendJson(res, 200, {
          source: rt.store.getSource(id),
          metrics: served.metrics,
          stale: served.stale,
          ageSec: served.ageSec,
          summary: served.summary,
        });
      }

      const feedMatch = path.match(/^\/rt\/sources\/([^/]+)\/feed\.pb$/);
      if (feedMatch && method === "GET") {
        const id = decodeURIComponent(feedMatch[1]!);
        if (!rt.store.getSource(id)) return sendJson(res, 404, { error: `unknown rt source: ${id}` });
        const served = rt.store.serve(id, rtNow());
        if (!served.ok || !served.bytes) {
          return sendJson(res, 503, { error: "no cached feed", stale: true });
        }
        const source = rt.store.getSource(id);
        if (served.stale && source?.stalePolicy === "block") {
          recordAudit("source.feed_blocked", "source", id, "blocked", {
            ageSec: served.ageSec,
            stalePolicy: source.stalePolicy,
          });
          return sendJson(res, 503, {
            error: "cached feed is stale",
            stale: true,
            ageSec: served.ageSec,
            stalePolicy: source.stalePolicy,
          });
        }
        return sendBytes(res, 200, served.bytes, {
          "x-feed-stale": String(served.stale),
          "x-feed-age-sec": String(served.ageSec ?? ""),
          "x-feed-stale-policy": source?.stalePolicy ?? "warn",
          "cache-control": "no-cache",
        });
      }

      const idMatch = path.match(/^\/rt\/sources\/([^/]+)$/);
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1]!);
        if (method === "PUT") {
          const body = (await readJsonBody(req)) as Partial<RtSource>;
          const source: RtSource = {
            id,
            url: body.url ?? "",
            feedType: body.feedType ?? "mixed",
            pollIntervalSec: body.pollIntervalSec ?? 30,
            headers: body.headers,
            enabled: body.enabled,
            stalePolicy: body.stalePolicy ?? "warn",
            gtfsRevision: body.gtfsRevision,
          };
          if (source.url.trim() === "") return sendJson(res, 400, { error: "url is required" });
          const stored = rt.store.upsertSource(source);
          recordAudit("source.upsert", "source", id, "success", {
            feedType: stored.feedType,
            stalePolicy: stored.stalePolicy ?? "warn",
          });
          return sendJson(res, 200, stored);
        }
        if (method === "DELETE") {
          const removed = rt.store.removeSource(id);
          recordAudit("source.delete", "source", id, removed ? "success" : "failed", { removed });
          return sendJson(res, 200, { removed });
        }
        if (method === "GET") {
          const source = rt.store.getSource(id);
          return source ? sendJson(res, 200, source) : sendJson(res, 404, { error: "not found" });
        }
        return sendJson(res, 405, { error: "method not allowed" });
      }

      return sendJson(res, 404, { error: `not found: ${method} ${path}` });
    }

    return sendJson(res, 404, { error: `not found: ${method} ${path}` });
  }

  function authorizeRtVehicleWrite(req: IncomingMessage):
    | { ok: true; token?: string }
    | { ok: false; status: 401 | 429; error: string } {
    if (rtVehicleTokens.size === 0) return { ok: true };

    const token =
      extractBearer(req.headers.authorization) ??
      (Array.isArray(req.headers["x-rt-source-token"])
        ? req.headers["x-rt-source-token"][0]
        : req.headers["x-rt-source-token"]);

    if (!token || !rtVehicleTokens.has(token)) {
      return { ok: false, status: 401, error: "invalid or missing rt vehicle token" };
    }

    const nowMs = Date.now();
    const since = nowMs - rtVehicleRateLimit.windowMs;
    const kept = (rtVehicleRateBuckets.get(token) ?? []).filter((t) => t > since);
    if (kept.length >= rtVehicleRateLimit.max) {
      rtVehicleRateBuckets.set(token, kept);
      return { ok: false, status: 429, error: "rt vehicle rate limit exceeded" };
    }
    kept.push(nowMs);
    rtVehicleRateBuckets.set(token, kept);
    return { ok: true, token };
  }

  function evaluateRtFreshness(nowSec: number): RtFreshnessStatus[] {
    const feeds: RtFreshnessStatus[] = [
      evaluateStoredFeed(
        "service_alerts",
        options.rtAlerts?.list().map((alert) => alert.updatedAt),
        options.rtAlerts?.list().length,
        nowSec,
      ),
      evaluateStoredFeed(
        "vehicle_positions",
        options.rtVehicles?.list().map((vehicle) => vehicle.updatedAt),
        options.rtVehicles?.list().length,
        nowSec,
      ),
      evaluateStoredFeed(
        "trip_updates",
        options.rtTripUpdates?.list().map((update) => update.updatedAt),
        options.rtTripUpdates?.list().length,
        nowSec,
      ),
    ];

    const relay = options.rtRelay;
    if (relay) {
      for (const source of relay.store.sources()) {
        const served = relay.store.serve(source.id, nowSec);
        feeds.push({
          feedType: source.feedType,
          sourceId: source.id,
          configured: true,
          status: !served.ok ? "no_data" : served.stale ? "stale" : "fresh",
          sloSec: RT_FRESHNESS_SLO_SEC[source.feedType],
          ageSec: served.ageSec,
          entityCount: served.summary?.entityCount ?? 0,
          latestUpdatedAt:
            served.metrics.feedTimestamp !== undefined
              ? new Date(served.metrics.feedTimestamp * 1000).toISOString()
              : undefined,
          lastError: served.metrics.lastError,
        });
      }
    }

    return feeds;
  }

  function recordAudit(
    action: RtAuditAction,
    targetType: RtAuditEvent["targetType"],
    targetId: string,
    outcome: RtAuditEvent["outcome"],
    detail?: Record<string, unknown>,
  ) {
    rtAudit.push({
      id: nextAuditId++,
      at: new Date(rtNowForAudit() * 1000).toISOString(),
      action,
      targetType,
      targetId,
      outcome,
      detail,
    });
    if (rtAudit.length > 1000) rtAudit.splice(0, rtAudit.length - 1000);
  }

  function rtNowForAudit(): number {
    return (options.rtNow ?? (() => Math.floor(Date.now() / 1000)))();
  }
}

async function smokeRealtimeUrl(input: RtSmokeRequest, nowSec: number) {
  const target = new URL(input.url!);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("url must be http or https");
  }
  const timeoutMs = Math.max(1_000, Math.min(input.timeoutMs ?? 10_000, 30_000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(target, { signal: controller.signal });
  } catch (e) {
    return { ok: false, stage: "fetch", url: input.url, error: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    return { ok: false, stage: "http", url: input.url, httpStatus: response.status };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (e) {
    return { ok: false, stage: "body", url: input.url, httpStatus: response.status, error: (e as Error).message };
  }

  try {
    const { summary } = validateRealtimeFeed(bytes);
    const feedType = input.feedType ?? inferFeedType(summary.counts);
    const sloSec = RT_FRESHNESS_SLO_SEC[feedType];
    const ageSec = summary.feedTimestamp === undefined ? undefined : Math.max(0, nowSec - summary.feedTimestamp);
    const stale = ageSec === undefined ? true : ageSec > sloSec;
    return {
      ok: summary.issues.length === 0,
      stage: "decode",
      url: input.url,
      httpStatus: response.status,
      byteLength: bytes.byteLength,
      feedType,
      sloSec,
      ageSec,
      stale,
      summary,
    };
  } catch (e) {
    return { ok: false, stage: "decode", url: input.url, httpStatus: response.status, byteLength: bytes.byteLength, error: (e as Error).message };
  }
}

function inferFeedType(counts: { tripUpdate: number; vehiclePosition: number; alert: number }): RtFeedType {
  const present = [
    counts.tripUpdate > 0 ? "trip_updates" : undefined,
    counts.vehiclePosition > 0 ? "vehicle_positions" : undefined,
    counts.alert > 0 ? "service_alerts" : undefined,
  ].filter(Boolean) as RtFeedType[];
  return present.length === 1 ? present[0]! : "mixed";
}

function evaluateStoredFeed(
  feedType: RtFeedType,
  timestamps: string[] | undefined,
  entityCount: number | undefined,
  nowSec: number,
): RtFreshnessStatus {
  const sloSec = RT_FRESHNESS_SLO_SEC[feedType];
  if (!timestamps) {
    return { feedType, configured: false, status: "not_configured", sloSec, entityCount: 0 };
  }
  const latestSec = timestamps
    .map((value) => Math.floor(Date.parse(value) / 1000))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  if (latestSec === undefined) {
    return { feedType, configured: true, status: "no_data", sloSec, entityCount: entityCount ?? 0 };
  }
  const ageSec = Math.max(0, nowSec - latestSec);
  return {
    feedType,
    configured: true,
    status: ageSec > sloSec ? "stale" : "fresh",
    sloSec,
    ageSec,
    entityCount: entityCount ?? 0,
    latestUpdatedAt: new Date(latestSec * 1000).toISOString(),
  };
}
