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
  runAcceptancePipeline,
  type SpecLock,
  type SpecLockId,
} from "@gtfs-studio/core";
import type { RtSource } from "@gtfs-studio/core/realtime";
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
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(text + "\n");
}

function sendBytes(res: ServerResponse, status: number, bytes: Uint8Array, headers: Record<string, string>) {
  res.writeHead(status, { "content-type": "application/x-protobuf", ...headers });
  res.end(Buffer.from(bytes));
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

export function createApiServer(options: ApiOptions): Server {
  const { repository } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const rtVehicleTokens = new Set((options.rtVehicleTokens ?? []).filter((token) => token.trim() !== ""));
  const rtVehicleRateLimit = options.rtVehicleRateLimit ?? { windowMs: 60_000, max: 60 };
  const rtVehicleRateBuckets = new Map<string, number[]>();

  return createServer((req, res) => {
    void handle(req, res).catch((e) => {
      sendJson(res, 400, { error: (e as Error).message });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";

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

      if (path === "/rt/alerts") {
        const store = options.rtAlerts;
        if (!store) return sendJson(res, 501, { error: "rt alerts are not configured" });
        if (method === "GET") return sendJson(res, 200, { alerts: store.list() });
        if (method === "POST") {
          const body = (await readJsonBody(req)) as Partial<ServiceAlertInput & { enabled: boolean }>;
          if (!body.id) return sendJson(res, 400, { error: "id is required" });
          const stored = store.upsert(body as ServiceAlertInput & { enabled?: boolean }, rtNow());
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
          return sendJson(res, 200, stored);
        }
        if (method === "DELETE") {
          return sendJson(res, 200, { removed: store.remove(id) });
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
          return sendJson(res, 200, stored);
        }
        if (method === "DELETE") {
          const auth = authorizeRtVehicleWrite(req);
          if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });
          return sendJson(res, 200, { removed: store.remove(id) });
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
          return sendJson(res, 200, stored);
        }
        if (method === "DELETE") {
          return sendJson(res, 200, { removed: store.remove(id) });
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
        const result = await rt.poll(decodeURIComponent(pollMatch[1]!));
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
        return sendBytes(res, 200, served.bytes, {
          "x-feed-stale": String(served.stale),
          "x-feed-age-sec": String(served.ageSec ?? ""),
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
            gtfsRevision: body.gtfsRevision,
          };
          if (source.url.trim() === "") return sendJson(res, 400, { error: "url is required" });
          return sendJson(res, 200, rt.store.upsertSource(source));
        }
        if (method === "DELETE") {
          return sendJson(res, 200, { removed: rt.store.removeSource(id) });
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
}
