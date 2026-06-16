/**
 * GTFS-RT 外部中継・正規化（RT-2）。
 *
 * 既存の外部 GTFS-RT `.pb` を取り込み、decode・最低限の検証・正規化（種別件数・参照ID・
 * FeedHeaderタイムスタンプの抽出）を行い、最新成功Feedをキャッシュして再配信する。
 * 鮮度（age）と中継メトリクス（取得時刻・連続失敗・HTTP/decodeエラー）も保持する。
 *
 * 本モジュールはネットワークに依存しない（取得済みバイト列を受け取る）。実際の取得
 * （HTTP poll）は api 層が担い、結果を `ingest` / `recordFailure` で渡す。
 */
import { decodeRealtimeFeed } from "./realtime.js";
import type { transit_realtime } from "gtfs-realtime-bindings";

export type RtFeedType = "trip_updates" | "vehicle_positions" | "service_alerts" | "mixed";

/** RT-5-1 鮮度SLO（秒）: TripUpdates/VehiclePositions=90、Alerts=600。 */
export const RT_FRESHNESS_SLO_SEC: Record<RtFeedType, number> = {
  trip_updates: 90,
  vehicle_positions: 90,
  service_alerts: 600,
  mixed: 90,
};

export interface RtSource {
  id: string;
  url: string;
  feedType: RtFeedType;
  /** ポーリング間隔（秒）。 */
  pollIntervalSec: number;
  /** 取得時に付与する認証等のヘッダ。 */
  headers?: Record<string, string>;
  enabled?: boolean;
  /** 静的GTFS revision との紐付け（RT-5-5 切替整合用）。 */
  gtfsRevision?: string;
}

export interface RtFeedSummary {
  /** FeedHeader.timestamp（Unix秒）。 */
  feedTimestamp?: number;
  gtfsRealtimeVersion?: string;
  incrementality?: string;
  entityCount: number;
  counts: { tripUpdate: number; vehiclePosition: number; alert: number };
  /** 参照ID（静的GTFSとの整合検証用、重複排除済み）。 */
  referencedTripIds: string[];
  referencedRouteIds: string[];
  referencedStopIds: string[];
  /** 検証で見つかった問題。 */
  issues: string[];
}

export interface RtRelayMetrics {
  sourceId: string;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  lastErrorAt?: number;
  lastError?: string;
  lastHttpStatus?: number;
  feedTimestamp?: number;
  entityCount?: number;
  consecutiveFailures: number;
}

export interface RtServeResult {
  ok: boolean;
  /** 最新成功Feedのバイト列（成功実績が無ければ undefined）。 */
  bytes?: Uint8Array;
  /** 鮮度SLOを超過しているか（バイト列が古い/未取得）。 */
  stale: boolean;
  /** 最新成功Feedの age（秒）。 */
  ageSec?: number;
  summary?: RtFeedSummary;
  metrics: RtRelayMetrics;
}

/**
 * GTFS-RT Feed を decode・検証・正規化する（ネットワーク非依存）。
 */
export function validateRealtimeFeed(
  input: Uint8Array | transit_realtime.FeedMessage,
): { feed: transit_realtime.FeedMessage; summary: RtFeedSummary } {
  const feed = input instanceof Uint8Array ? decodeRealtimeFeed(input) : input;
  const issues: string[] = [];

  const header = feed.header;
  const version = header?.gtfsRealtimeVersion;
  if (!version) issues.push("FeedHeader.gtfs_realtime_version がありません");
  // proto2 の未設定 uint64 は decode 時に 0 になりうるため、0 も「欠落」として扱う
  // （Unix秒 0 = 1970 は実フィードでは無効）。
  const rawTs = header?.timestamp;
  const feedTimestamp = rawTs != null && Number(rawTs) > 0 ? Number(rawTs) : undefined;
  if (feedTimestamp === undefined) issues.push("FeedHeader.timestamp がありません");

  let tripUpdate = 0;
  let vehiclePosition = 0;
  let alert = 0;
  const tripIds = new Set<string>();
  const routeIds = new Set<string>();
  const stopIds = new Set<string>();

  const entities = feed.entity ?? [];
  for (const [i, entity] of entities.entries()) {
    if (!entity.id) issues.push(`entity[${i}] に id がありません`);
    if (entity.tripUpdate) {
      tripUpdate++;
      const trip = entity.tripUpdate.trip;
      if (!trip?.tripId && !trip?.routeId) {
        issues.push(`trip_update entity "${entity.id}" に trip_id / route_id がありません`);
      }
      if (trip?.tripId) tripIds.add(trip.tripId);
      if (trip?.routeId) routeIds.add(trip.routeId);
      for (const stu of entity.tripUpdate.stopTimeUpdate ?? []) {
        if (stu.stopId) stopIds.add(stu.stopId);
      }
    }
    if (entity.vehicle) {
      vehiclePosition++;
      const pos = entity.vehicle.position;
      if (!pos) {
        issues.push(`vehicle entity "${entity.id}" に position がありません`);
      } else if (!isValidLatLon(pos.latitude, pos.longitude)) {
        issues.push(`vehicle entity "${entity.id}" の座標が範囲外です`);
      }
      if (entity.vehicle.trip?.tripId) tripIds.add(entity.vehicle.trip.tripId);
      if (entity.vehicle.trip?.routeId) routeIds.add(entity.vehicle.trip.routeId);
    }
    if (entity.alert) {
      alert++;
      for (const sel of entity.alert.informedEntity ?? []) {
        if (sel.routeId) routeIds.add(sel.routeId);
        if (sel.stopId) stopIds.add(sel.stopId);
        if (sel.trip?.tripId) tripIds.add(sel.trip.tripId);
      }
    }
  }

  const summary: RtFeedSummary = {
    feedTimestamp,
    gtfsRealtimeVersion: version ?? undefined,
    incrementality:
      header?.incrementality != null ? String(header.incrementality) : undefined,
    entityCount: entities.length,
    counts: { tripUpdate, vehiclePosition, alert },
    referencedTripIds: [...tripIds].sort(),
    referencedRouteIds: [...routeIds].sort(),
    referencedStopIds: [...stopIds].sort(),
    issues,
  };
  return { feed, summary };
}

function isValidLatLon(lat?: number | null, lon?: number | null): boolean {
  return (
    lat != null &&
    lon != null &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180 &&
    !(lat === 0 && lon === 0)
  );
}

interface RelayEntry {
  source: RtSource;
  bytes?: Uint8Array;
  summary?: RtFeedSummary;
  metrics: RtRelayMetrics;
}

export interface RtRelayStore {
  sources(): RtSource[];
  getSource(id: string): RtSource | undefined;
  upsertSource(source: RtSource): RtSource;
  removeSource(id: string): boolean;
  /** poll 成功: バイト列を decode・検証して最新成功Feedとして保存する。 */
  ingest(
    sourceId: string,
    bytes: Uint8Array,
    fetchedAt: number,
    httpStatus?: number,
  ): { summary: RtFeedSummary; metrics: RtRelayMetrics };
  /** poll 失敗を記録する。 */
  recordFailure(
    sourceId: string,
    error: string,
    fetchedAt: number,
    httpStatus?: number,
  ): RtRelayMetrics;
  /** 再配信: 最新成功Feedのバイト列と鮮度判定を返す。 */
  serve(sourceId: string, now: number): RtServeResult;
  metrics(sourceId: string): RtRelayMetrics | undefined;
  allMetrics(): RtRelayMetrics[];
}

export function createRtRelayStore(initialSources: RtSource[] = []): RtRelayStore {
  const entries = new Map<string, RelayEntry>();

  function ensure(sourceId: string): RelayEntry {
    const entry = entries.get(sourceId);
    if (!entry) throw new Error(`unknown rt source: ${sourceId}`);
    return entry;
  }

  const store: RtRelayStore = {
    sources: () => [...entries.values()].map((e) => ({ ...e.source })),
    getSource: (id) => {
      const e = entries.get(id);
      return e ? { ...e.source } : undefined;
    },
    upsertSource: (source) => {
      if (source.id.trim() === "") throw new Error("RtSource.id is required");
      if (source.pollIntervalSec <= 0) throw new Error("pollIntervalSec must be > 0");
      const existing = entries.get(source.id);
      const entry: RelayEntry = existing ?? {
        source: { ...source },
        metrics: { sourceId: source.id, consecutiveFailures: 0 },
      };
      entry.source = { ...source };
      entries.set(source.id, entry);
      return { ...entry.source };
    },
    removeSource: (id) => entries.delete(id),

    ingest: (sourceId, bytes, fetchedAt, httpStatus) => {
      const entry = ensure(sourceId);
      const { summary } = validateRealtimeFeed(bytes);
      entry.bytes = bytes.slice();
      entry.summary = summary;
      entry.metrics = {
        ...entry.metrics,
        lastAttemptAt: fetchedAt,
        lastSuccessAt: fetchedAt,
        lastHttpStatus: httpStatus ?? entry.metrics.lastHttpStatus,
        feedTimestamp: summary.feedTimestamp,
        entityCount: summary.entityCount,
        consecutiveFailures: 0,
        lastError: undefined,
      };
      return { summary, metrics: { ...entry.metrics } };
    },

    recordFailure: (sourceId, error, fetchedAt, httpStatus) => {
      const entry = ensure(sourceId);
      entry.metrics = {
        ...entry.metrics,
        lastAttemptAt: fetchedAt,
        lastErrorAt: fetchedAt,
        lastError: error,
        lastHttpStatus: httpStatus ?? entry.metrics.lastHttpStatus,
        consecutiveFailures: entry.metrics.consecutiveFailures + 1,
      };
      return { ...entry.metrics };
    },

    serve: (sourceId, now) => {
      const entry = ensure(sourceId);
      const metrics = { ...entry.metrics };
      if (!entry.bytes) {
        return { ok: false, stale: true, metrics };
      }
      // age は FeedHeader.timestamp 優先、無ければ取得時刻基準。
      const basis = entry.summary?.feedTimestamp ?? entry.metrics.lastSuccessAt;
      const ageSec = basis !== undefined ? Math.max(0, now - basis) : undefined;
      const slo = RT_FRESHNESS_SLO_SEC[entry.source.feedType];
      const stale = ageSec === undefined ? true : ageSec > slo;
      return {
        ok: true,
        bytes: entry.bytes.slice(),
        stale,
        ageSec,
        summary: entry.summary,
        metrics,
      };
    },

    metrics: (sourceId) => {
      const e = entries.get(sourceId);
      return e ? { ...e.metrics } : undefined;
    },
    allMetrics: () => [...entries.values()].map((e) => ({ ...e.metrics })),
  };

  for (const source of initialSources) store.upsertSource(source);
  return store;
}
