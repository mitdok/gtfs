/**
 * GTFS Studio バックエンドAPI（依存ゼロ・node:http）。
 *
 * 提供するもの:
 * - 仕様ロックの取得・保存（10.2）。永続化は `SpecLockRepository`。
 * - 検収の実行（11.4）。zip(base64) と任意の validator report から
 *   `runAcceptancePipeline` を回し、11.5 形式の検収結果を返す。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  runAcceptancePipeline,
  type SpecLock,
  type SpecLockId,
} from "@gtfs-studio/core";
import type { SpecLockRepository } from "./spec-lock-repository.js";

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
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(text + "\n");
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

    return sendJson(res, 404, { error: `not found: ${method} ${path}` });
  }
}
