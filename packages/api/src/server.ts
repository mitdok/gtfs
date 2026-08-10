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
  parseStandardValidatorReport,
  runAcceptancePipeline,
  tripProgressToTripUpdate,
  validateFeed,
  type SpecLock,
  type SpecLockId,
  type RealtimeTripMatchProbe,
} from "@gtfs-studio/core";
import { createHash } from "node:crypto";
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
import type { FeedRevision, RevisionRepository, WarningApproval } from "./revision-repository.js";
import type { RtRelayService } from "./rt-relay.js";

const VALID_LOCK_IDS: SpecLockId[] = [
  "GTFS_SCHEDULE_LOCK",
  "GTFS_JP_V4_LOCK",
  "GOOGLE_TRANSIT_LOCK",
  "VALIDATOR_LOCK",
];
const VALID_REVISION_STATUSES = new Set(["validated", "published", "superseded"]);

export interface ApiOptions {
  repository: SpecLockRepository;
  /** GTFS revision 永続化。未指定なら revision/publish 系は 501。 */
  revisions?: RevisionRepository;
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
  /**
   * 静的GTFSのrevision作成・publish・public URL smoke用token。
   * 未指定または空配列なら互換性のため認証しない。
   */
  staticWriteTokens?: string[];
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

function sendZip(res: ServerResponse, status: number, bytes: Uint8Array, headers: Record<string, string> = {}) {
  res.writeHead(status, { ...corsHeaders(), "content-type": "application/zip", ...headers });
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
    "access-control-allow-headers": "content-type,authorization,x-api-token,x-rt-source-token",
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

interface CreateRevisionRequest extends AcceptanceRequest {
  id?: string;
}

interface PublicUrlSmokeRequest {
  url?: string;
  timeoutMs?: number;
  validationDate?: string;
  standardReport?: unknown;
}

interface WarningApprovalsRequest {
  approvals?: Partial<WarningApproval>[];
}

type StaticAuditAction =
  | "revision.create"
  | "revision.publish"
  | "revision.public_url_smoke"
  | "revision.warning_approvals"
  | "revision.auth_failed";

interface StaticAuditEvent {
  id: number;
  at: string;
  projectId: string;
  action: StaticAuditAction;
  targetType: "revision" | "project";
  targetId: string;
  outcome: "success" | "failed" | "blocked";
  detail?: Record<string, unknown>;
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
  blockId?: string;
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
  gtfsRevision?: string;
}

export function createApiServer(options: ApiOptions): Server {
  const { repository } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const staticWriteTokens = new Set((options.staticWriteTokens ?? []).filter((token) => token.trim() !== ""));
  const rtVehicleTokens = new Set((options.rtVehicleTokens ?? []).filter((token) => token.trim() !== ""));
  const rtVehicleRateLimit = options.rtVehicleRateLimit ?? { windowMs: 60_000, max: 60 };
  const rtVehicleRateBuckets = new Map<string, number[]>();
  const staticAudit: StaticAuditEvent[] = [];
  let nextStaticAuditId = 1;
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

    // 公開APIでは参照系だけを匿名利用に限定する。staticWriteTokens が設定されている
    // 環境では、個別ルートの実装漏れにかかわらず全変更・計算要求を一律で保護する。
    if (method !== "GET") {
      const auth = authorizeStaticWrite(req);
      if (!auth.ok) {
        const projectMatch = path.match(/^\/projects\/([^/]+)/);
        if (projectMatch) {
          const projectId = decodeURIComponent(projectMatch[1]!);
          const revisionMatch = path.match(/^\/projects\/[^/]+\/revisions\/([^/:]+)/);
          const targetId = revisionMatch ? decodeURIComponent(revisionMatch[1]!) : projectId;
          recordStaticAudit(projectId, "revision.auth_failed", revisionMatch ? "revision" : "project", targetId, "blocked", {
            method,
            path,
          });
        }
        return sendJson(res, auth.status, { error: auth.error });
      }
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

    const revisionsRootMatch = path.match(/^\/projects\/([^/]+)\/revisions$/);
    if (revisionsRootMatch) {
      const revisions = options.revisions;
      if (!revisions) return sendJson(res, 501, { error: "revision repository is not configured" });
      const projectId = decodeURIComponent(revisionsRootMatch[1]!);
      if (method === "GET") {
        const limitParam = url.searchParams.get("limit");
        const offsetParam = url.searchParams.get("offset");
        const statusParam = url.searchParams.get("status");
        if (statusParam !== null && !VALID_REVISION_STATUSES.has(statusParam)) {
          return sendJson(res, 400, { error: "invalid revision status" });
        }
        const projectRevisions = revisions.list(projectId);
        const statusCounts = projectRevisions.reduce(
          (counts, revision) => ({ ...counts, [revision.status]: counts[revision.status] + 1 }),
          { validated: 0, published: 0, superseded: 0 },
        );
        const all = projectRevisions.filter((revision) => statusParam === null || revision.status === statusParam);
        const limit = limitParam === null ? all.length : Math.max(1, Math.min(500, Number(limitParam) || 100));
        const offset = Math.max(0, Number(offsetParam) || 0);
        return sendJson(res, 200, {
          revisions: all.slice(offset, offset + limit),
          total: all.length,
          limit,
          offset,
          hasMore: offset + limit < all.length,
          statusCounts,
        });
      }
      if (method === "POST") {
        const auth = authorizeStaticWrite(req);
        if (!auth.ok) {
          recordStaticAudit(projectId, "revision.auth_failed", "project", projectId, "blocked", {
            operation: "revision.create",
          });
          return sendJson(res, auth.status, { error: auth.error });
        }
        const body = (await readJsonBody(req)) as CreateRevisionRequest;
        if (!body.zipBase64) {
          recordStaticAudit(projectId, "revision.create", "project", projectId, "failed", {
            error: "zipBase64 is required",
          });
          return sendJson(res, 400, { error: "zipBase64 is required" });
        }
        const zip = new Uint8Array(Buffer.from(body.zipBase64, "base64"));
        const profileId = body.profileId ?? "gtfs-jp-v4";
        const executedAt = now();
        const specLocks = repository.snapshot();
        const result = runAcceptancePipeline({
          zip,
          profileId,
          validationDate: body.validationDate,
          standardReport: body.standardReport as never,
          specLocks,
          realFeedRoundtrip: body.realFeedRoundtrip,
          v3Migration: body.v3Migration,
          publicUrl: body.publicUrl,
          releaseCandidate: body.releaseCandidate,
          executedAt,
        });
        const revision = revisions.create({
          id: body.id,
          projectId,
          createdAt: executedAt,
          profileId,
          validationDate: body.validationDate,
          releaseCandidate: body.releaseCandidate,
          zip,
          specLocks,
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
        recordStaticAudit(projectId, "revision.create", "revision", revision.id, "success", {
          status: revision.acceptance.status,
          gateStatus: revision.gate.status,
          zipSha256: revision.zipSha256,
        });
        return sendJson(res, 201, revision);
      }
      return sendJson(res, 405, { error: "method not allowed" });
    }

    const latestZipMatch = path.match(/^\/projects\/([^/]+)\/latest\/gtfs\.zip$/);
    if (latestZipMatch && method === "GET") {
      const revisions = options.revisions;
      if (!revisions) return sendJson(res, 501, { error: "revision repository is not configured" });
      const projectId = decodeURIComponent(latestZipMatch[1]!);
      const revision = revisions.getLatestPublished(projectId);
      if (!revision) return sendJson(res, 404, { error: "published revision not found" });
      const zip = revisions.readZip(projectId, revision.id);
      if (!zip) return sendJson(res, 404, { error: "zip not found" });
      return sendZip(res, 200, zip, {
        "cache-control": "no-cache",
        "x-gtfs-revision": revision.id,
        "x-gtfs-sha256": revision.zipSha256,
      });
    }

    const revisionZipMatch = path.match(/^\/projects\/([^/]+)\/revisions\/([^/]+)\/gtfs\.zip$/);
    if (revisionZipMatch && method === "GET") {
      const revisions = options.revisions;
      if (!revisions) return sendJson(res, 501, { error: "revision repository is not configured" });
      const projectId = decodeURIComponent(revisionZipMatch[1]!);
      const revisionId = decodeURIComponent(revisionZipMatch[2]!);
      const revision = revisions.get(projectId, revisionId);
      if (!revision) return sendJson(res, 404, { error: "revision not found" });
      const zip = revisions.readZip(projectId, revisionId);
      if (!zip) return sendJson(res, 404, { error: "zip not found" });
      return sendZip(res, 200, zip, {
        "cache-control": "immutable",
        "x-gtfs-revision": revision.id,
        "x-gtfs-sha256": revision.zipSha256,
      });
    }

    const publishMatch = path.match(/^\/projects\/([^/]+)\/revisions\/([^/]+):publish$/);
    if (publishMatch) {
      const revisions = options.revisions;
      if (!revisions) return sendJson(res, 501, { error: "revision repository is not configured" });
      if (method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
      const projectId = decodeURIComponent(publishMatch[1]!);
      const revisionId = decodeURIComponent(publishMatch[2]!);
      const auth = authorizeStaticWrite(req);
      if (!auth.ok) {
        recordStaticAudit(projectId, "revision.auth_failed", "revision", revisionId, "blocked", {
          operation: "revision.publish",
        });
        return sendJson(res, auth.status, { error: auth.error });
      }
      const revision = revisions.get(projectId, revisionId);
      if (!revision) {
        recordStaticAudit(projectId, "revision.publish", "revision", revisionId, "failed", {
          error: "revision not found",
        });
        return sendJson(res, 404, { error: "revision not found" });
      }
      if (revision.gate.status !== "ready" || revision.acceptance.status !== "ready") {
        recordStaticAudit(projectId, "revision.publish", "revision", revisionId, "blocked", {
          status: revision.acceptance.status,
          blockers: revision.gate.blockers,
        });
        return sendJson(res, 409, {
          error: "revision is not ready",
          status: revision.acceptance.status,
          blockers: revision.gate.blockers,
        });
      }
      const published = revisions.publish(projectId, revisionId, now());
      recordStaticAudit(projectId, "revision.publish", "revision", revisionId, "success", {
        publishedAt: published?.publishedAt,
      });
      return sendJson(res, 200, published);
    }

    const publicUrlSmokeMatch = path.match(/^\/projects\/([^/]+)\/revisions\/([^/]+)\/public-url-smoke$/);
    if (publicUrlSmokeMatch) {
      const revisions = options.revisions;
      if (!revisions) return sendJson(res, 501, { error: "revision repository is not configured" });
      if (method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
      const projectId = decodeURIComponent(publicUrlSmokeMatch[1]!);
      const revisionId = decodeURIComponent(publicUrlSmokeMatch[2]!);
      const auth = authorizeStaticWrite(req);
      if (!auth.ok) {
        recordStaticAudit(projectId, "revision.auth_failed", "revision", revisionId, "blocked", {
          operation: "revision.public_url_smoke",
        });
        return sendJson(res, auth.status, { error: auth.error });
      }
      const revision = revisions.get(projectId, revisionId);
      if (!revision) {
        recordStaticAudit(projectId, "revision.public_url_smoke", "revision", revisionId, "failed", {
          error: "revision not found",
        });
        return sendJson(res, 404, { error: "revision not found" });
      }
      const body = (await readJsonBody(req)) as PublicUrlSmokeRequest;
      if (!body.url) {
        recordStaticAudit(projectId, "revision.public_url_smoke", "revision", revisionId, "failed", {
          error: "url is required",
        });
        return sendJson(res, 400, { error: "url is required" });
      }
      const result = await smokePublicGtfsUrl(body, revision);
      recordStaticAudit(
        projectId,
        "revision.public_url_smoke",
        "revision",
        revisionId,
        result.ok ? "success" : "failed",
        {
          url: body.url,
          stage: result.stage,
          verified: result.verified,
          sha256Matched: result.sha256Matched,
          error: result.error,
        },
      );
      return sendJson(res, 200, result);
    }

    const warningApprovalsMatch = path.match(/^\/projects\/([^/]+)\/revisions\/([^/]+)\/warning-approvals$/);
    if (warningApprovalsMatch) {
      const revisions = options.revisions;
      if (!revisions) return sendJson(res, 501, { error: "revision repository is not configured" });
      const projectId = decodeURIComponent(warningApprovalsMatch[1]!);
      const revisionId = decodeURIComponent(warningApprovalsMatch[2]!);
      const revision = revisions.get(projectId, revisionId);
      if (!revision) return sendJson(res, 404, { error: "revision not found" });

      if (method === "GET") {
        return sendJson(res, 200, {
          projectId,
          revisionId,
          approvals: revision.warningApprovals ?? [],
        });
      }

      if (method === "POST" || method === "PUT") {
        const auth = authorizeStaticWrite(req);
        if (!auth.ok) {
          recordStaticAudit(projectId, "revision.auth_failed", "revision", revisionId, "blocked", {
            operation: "revision.warning_approvals",
          });
          return sendJson(res, auth.status, { error: auth.error });
        }
        const body = (await readJsonBody(req)) as WarningApprovalsRequest;
        if (!Array.isArray(body.approvals)) return sendJson(res, 400, { error: "approvals must be an array" });
        const approvals = body.approvals.map(normalizeWarningApproval);
        const updated = revisions.saveWarningApprovals(projectId, revisionId, approvals, now());
        if (!updated) return sendJson(res, 404, { error: "revision not found" });
        recordStaticAudit(projectId, "revision.warning_approvals", "revision", revisionId, "success", {
          approvals: approvals.length,
        });
        return sendJson(res, 200, {
          projectId,
          revisionId,
          approvals: updated.warningApprovals ?? [],
        });
      }

      return sendJson(res, 405, { error: "method not allowed" });
    }

    const revisionMatch = path.match(/^\/projects\/([^/]+)\/revisions\/([^/]+)$/);
    if (revisionMatch) {
      const revisions = options.revisions;
      if (!revisions) return sendJson(res, 501, { error: "revision repository is not configured" });
      if (method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
      const revision = revisions.get(decodeURIComponent(revisionMatch[1]!), decodeURIComponent(revisionMatch[2]!));
      return revision ? sendJson(res, 200, revision) : sendJson(res, 404, { error: "revision not found" });
    }

    const staticAuditMatch = path.match(/^\/projects\/([^/]+)\/audit$/);
    if (staticAuditMatch) {
      const projectId = decodeURIComponent(staticAuditMatch[1]!);
      if (method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
      const auth = authorizeStaticWrite(req);
      if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });
      const limit = Number(url.searchParams.get("limit") ?? "100");
      const events = staticAudit
        .filter((event) => event.projectId === projectId)
        .slice(-Math.max(1, Math.min(500, limit)))
        .reverse();
      return sendJson(res, 200, { events });
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
              blockId: body.blockId,
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

      const sourceStaticCompatMatch = path.match(/^\/rt\/sources\/([^/]+)\/static-compat\/check$/);
      if (sourceStaticCompatMatch) {
        if (method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
        const id = decodeURIComponent(sourceStaticCompatMatch[1]!);
        const source = rt.store.getSource(id);
        if (!source) return sendJson(res, 404, { error: `unknown rt source: ${id}` });
        const body = (await readJsonBody(req)) as RtStaticCompatRequest;
        if (!body.zipBase64) return sendJson(res, 400, { error: "zipBase64 is required" });
        const served = rt.store.serve(id, rtNow());
        if (!served.ok || !served.summary) {
          return sendJson(res, 503, { error: "no cached feed", source, stale: true });
        }
        const staticFeed = importGtfsZip(new Uint8Array(Buffer.from(body.zipBase64, "base64"))).feed;
        const requestedRevision = body.gtfsRevision?.trim() || undefined;
        const sourceRevision = source.gtfsRevision;
        return sendJson(res, 200, {
          source,
          sourceRevision,
          requestedRevision,
          revisionMatched:
            sourceRevision && requestedRevision ? sourceRevision === requestedRevision : undefined,
          stale: served.stale,
          ageSec: served.ageSec,
          summary: served.summary,
          compatibility: checkRealtimeStaticCompatibility(staticFeed, served.summary),
        });
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
            activeFrom: body.activeFrom,
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

  function authorizeStaticWrite(req: IncomingMessage):
    | { ok: true; token?: string }
    | { ok: false; status: 401; error: string } {
    if (staticWriteTokens.size === 0) return { ok: true };

    const token =
      extractBearer(req.headers.authorization) ??
      (Array.isArray(req.headers["x-api-token"])
        ? req.headers["x-api-token"][0]
        : req.headers["x-api-token"]);

    if (!token || !staticWriteTokens.has(token)) {
      return { ok: false, status: 401, error: "invalid or missing static write token" };
    }
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

  function recordStaticAudit(
    projectId: string,
    action: StaticAuditAction,
    targetType: StaticAuditEvent["targetType"],
    targetId: string,
    outcome: StaticAuditEvent["outcome"],
    detail?: Record<string, unknown>,
  ) {
    staticAudit.push({
      id: nextStaticAuditId++,
      at: now(),
      projectId,
      action,
      targetType,
      targetId,
      outcome,
      detail,
    });
    if (staticAudit.length > 1000) staticAudit.splice(0, staticAudit.length - 1000);
  }

  function rtNowForAudit(): number {
    return (options.rtNow ?? (() => Math.floor(Date.now() / 1000)))();
  }
}

function normalizeWarningApproval(input: Partial<WarningApproval>): WarningApproval {
  const key = requiredString(input.key, "approval.key");
  const code = requiredString(input.code, "approval.code");
  const message = requiredString(input.message, "approval.message");
  const impact = requiredString(input.impact, "approval.impact");
  const approver = requiredString(input.approver, "approval.approver");
  const approvedAt = requiredString(input.approvedAt, "approval.approvedAt");
  if (Number.isNaN(Date.parse(approvedAt))) throw new Error(`invalid approval.approvedAt: ${approvedAt}`);
  return {
    key,
    code,
    message,
    entity: input.entity,
    impact,
    approver,
    approvedAt,
  };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`);
  return value.trim();
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

async function smokePublicGtfsUrl(input: PublicUrlSmokeRequest, revision: FeedRevision) {
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
    return {
      ok: false,
      stage: "fetch",
      url: input.url,
      revisionId: revision.id,
      error: (e as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    return {
      ok: false,
      stage: "http",
      url: input.url,
      revisionId: revision.id,
      httpStatus: response.status,
    };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (e) {
    return {
      ok: false,
      stage: "body",
      url: input.url,
      revisionId: revision.id,
      httpStatus: response.status,
      error: (e as Error).message,
    };
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const sha256Matched = sha256 === revision.zipSha256;
  try {
    const feed = importGtfsZip(bytes).feed;
    const gtfsJpV4 = validateFeed(feed, {
      profileId: "gtfs-jp-v4",
      validationDate: input.validationDate ?? revision.validationDate,
    }).summary;
    const googleTransitReady = validateFeed(feed, {
      profileId: "google-transit-ready",
      validationDate: input.validationDate ?? revision.validationDate,
    }).summary;
    const standardValidator = input.standardReport
      ? parseStandardValidatorReport(input.standardReport as never)
      : undefined;
    const standardErrors = standardValidator?.summary.errors;
    const verified =
      sha256Matched &&
      gtfsJpV4.errors === 0 &&
      googleTransitReady.errors === 0 &&
      (standardErrors ?? 0) === 0;
    return {
      ok: verified,
      verified,
      stage: "validate",
      url: input.url,
      revisionId: revision.id,
      httpStatus: response.status,
      byteLength: bytes.byteLength,
      expectedSha256: revision.zipSha256,
      sha256,
      sha256Matched,
      validation: { gtfsJpV4, googleTransitReady },
      standardValidator: standardValidator
        ? {
            validatorName: standardValidator.validatorName,
            validatorVersion: standardValidator.validatorVersion,
            executedAt: standardValidator.executedAt,
            summary: standardValidator.summary,
          }
        : undefined,
      publicUrl: { verified, standardErrors },
    };
  } catch (e) {
    return {
      ok: false,
      stage: "validate",
      url: input.url,
      revisionId: revision.id,
      httpStatus: response.status,
      byteLength: bytes.byteLength,
      expectedSha256: revision.zipSha256,
      sha256,
      sha256Matched,
      error: (e as Error).message,
    };
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
