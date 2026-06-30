/**
 * GTFS-RT 外部中継サービス（RT-2 のネットワーク側）。
 *
 * core の `RtRelayStore`（decode/正規化/キャッシュ/メトリクス）に、HTTP 取得（poll）と
 * 条件付きGET（ETag / Last-Modified）を足す。`fetch` は注入可能でテストできる。
 */
import {
  createRtRelayStore,
  type RtFeedSummary,
  type RtRelayStore,
  type RtSource,
} from "@gtfs-studio/core/realtime";

export interface RtFetchResponse {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type RtFetch = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<RtFetchResponse>;

export interface PollResult {
  sourceId: string;
  outcome: "ingested" | "not_modified" | "failed" | "skipped";
  status?: number;
  error?: string;
  summary?: RtFeedSummary;
  reason?: "disabled" | "not_active_yet";
  activeFrom?: number | string;
}

export interface RtRelayService {
  readonly store: RtRelayStore;
  poll(sourceId: string): Promise<PollResult>;
}

interface ConditionalCache {
  etag?: string;
  lastModified?: string;
}

export interface RtRelayServiceOptions {
  fetch?: RtFetch;
  now?: () => number;
  timeoutMs?: number;
  initialSources?: RtSource[];
}

export function createRtRelayService(options: RtRelayServiceOptions = {}): RtRelayService {
  const store = createRtRelayStore(options.initialSources ?? []);
  const fetchImpl = options.fetch ?? (globalThis.fetch as unknown as RtFetch);
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const timeoutMs = options.timeoutMs ?? 10_000;
  const conditional = new Map<string, ConditionalCache>();

  async function poll(sourceId: string): Promise<PollResult> {
    const source = store.getSource(sourceId);
    if (!source) throw new Error(`unknown rt source: ${sourceId}`);
    if (!fetchImpl) throw new Error("fetch is not available; inject options.fetch");
    const at = now();
    if (source.enabled === false) {
      return { sourceId, outcome: "skipped", reason: "disabled" };
    }
    const activeFromSec = source.activeFrom === undefined ? undefined : parseActiveFrom(source.activeFrom);
    if (activeFromSec !== undefined && at < activeFromSec) {
      return { sourceId, outcome: "skipped", reason: "not_active_yet", activeFrom: source.activeFrom };
    }

    const headers: Record<string, string> = { ...(source.headers ?? {}) };
    const cond = conditional.get(sourceId);
    if (cond?.etag) headers["if-none-match"] = cond.etag;
    if (cond?.lastModified) headers["if-modified-since"] = cond.lastModified;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: RtFetchResponse;
    try {
      res = await fetchImpl(source.url, { headers, signal: controller.signal });
    } catch (e) {
      store.recordFailure(sourceId, `fetch error: ${(e as Error).message}`, at);
      return { sourceId, outcome: "failed", error: (e as Error).message };
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 304) {
      return { sourceId, outcome: "not_modified", status: 304 };
    }
    if (!res.ok) {
      store.recordFailure(sourceId, `HTTP ${res.status}`, at, res.status);
      return { sourceId, outcome: "failed", status: res.status, error: `HTTP ${res.status}` };
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      store.recordFailure(sourceId, `body read error: ${(e as Error).message}`, at, res.status);
      return { sourceId, outcome: "failed", status: res.status, error: (e as Error).message };
    }

    try {
      const { summary } = store.ingest(sourceId, bytes, at, res.status);
      conditional.set(sourceId, {
        etag: res.headers.get("etag") ?? undefined,
        lastModified: res.headers.get("last-modified") ?? undefined,
      });
      return { sourceId, outcome: "ingested", status: res.status, summary };
    } catch (e) {
      store.recordFailure(sourceId, `decode error: ${(e as Error).message}`, at, res.status);
      return { sourceId, outcome: "failed", status: res.status, error: (e as Error).message };
    }
  }

  return { store, poll };
}

function parseActiveFrom(value: number | string): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw new Error("RtSource.activeFrom must be a non-negative Unix second");
    return Math.floor(value);
  }
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error("RtSource.activeFrom must be a Unix second or ISO timestamp");
  return Math.floor(ms / 1000);
}
