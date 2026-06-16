/**
 * GTFS Realtime（GTFS-RT）最小builder。
 *
 * RT-1ではServiceAlertsを対象に、アプリ側の入力モデルから公式proto由来の
 * FeedMessageを生成する。HTTP配信層はこのUint8Arrayを `application/x-protobuf`
 * として返す想定。
 */
import gtfsRealtimeBindings from "gtfs-realtime-bindings";
import type { transit_realtime } from "gtfs-realtime-bindings";

const { transit_realtime: rt } = gtfsRealtimeBindings;

export type RealtimeAlertCause = keyof typeof rt.Alert.Cause;
export type RealtimeAlertEffect = keyof typeof rt.Alert.Effect;
export type RealtimeAlertSeverity = keyof typeof rt.Alert.SeverityLevel;

export interface RealtimeText {
  /** BCP 47言語コード（例: ja, en）。 */
  [language: string]: string;
}

export interface RealtimeActivePeriod {
  /** Unix秒、Date、または ISO 8601 文字列。 */
  start?: number | Date | string;
  /** Unix秒、Date、または ISO 8601 文字列。 */
  end?: number | Date | string;
}

export interface RealtimeInformedEntity {
  agencyId?: string;
  routeId?: string;
  routeType?: number;
  tripId?: string;
  routeIdForTrip?: string;
  startTime?: string;
  startDate?: string;
  stopId?: string;
  directionId?: number;
}

export interface ServiceAlertInput {
  id: string;
  activePeriods?: RealtimeActivePeriod[];
  informedEntities: RealtimeInformedEntity[];
  cause?: RealtimeAlertCause;
  effect?: RealtimeAlertEffect;
  severityLevel?: RealtimeAlertSeverity;
  headerText: RealtimeText;
  descriptionText?: RealtimeText;
  url?: RealtimeText;
}

export interface StoredServiceAlert extends ServiceAlertInput {
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RealtimeAlertStore {
  list(): StoredServiceAlert[];
  listActive(at?: number | Date | string): StoredServiceAlert[];
  get(id: string): StoredServiceAlert | undefined;
  upsert(alert: ServiceAlertInput & { enabled?: boolean }, now?: number | Date | string): StoredServiceAlert;
  remove(id: string): boolean;
  clear(): void;
  encode(options?: BuildServiceAlertsOptions & { activeAt?: number | Date | string }): Uint8Array;
}

export interface BuildServiceAlertsOptions {
  /** FeedHeader.timestamp。未指定時は実行時刻。 */
  timestamp?: number | Date | string;
  feedVersion?: string;
  gtfsRealtimeVersion?: string;
}

export function buildServiceAlertsFeed(
  alerts: ServiceAlertInput[],
  options: BuildServiceAlertsOptions = {},
): transit_realtime.IFeedMessage {
  const timestamp = toUnixSeconds(options.timestamp ?? new Date(), "timestamp");
  const entity = alerts.map((alert) => buildAlertEntity(alert));
  const feed: transit_realtime.IFeedMessage = {
    header: {
      gtfsRealtimeVersion: options.gtfsRealtimeVersion ?? "2.0",
      incrementality: rt.FeedHeader.Incrementality.FULL_DATASET,
      timestamp,
      ...(options.feedVersion ? { feedVersion: options.feedVersion } : {}),
    },
    entity,
  };
  const reason = rt.FeedMessage.verify(feed as unknown as Record<string, unknown>);
  if (reason) throw new Error(`invalid GTFS-RT FeedMessage: ${reason}`);
  return feed;
}

export function encodeServiceAlertsFeed(
  alerts: ServiceAlertInput[],
  options: BuildServiceAlertsOptions = {},
): Uint8Array {
  return rt.FeedMessage.encode(buildServiceAlertsFeed(alerts, options)).finish();
}

export function decodeRealtimeFeed(bytes: Uint8Array): transit_realtime.FeedMessage {
  return rt.FeedMessage.decode(bytes);
}

export function realtimeFeedToObject(feed: transit_realtime.FeedMessage): Record<string, unknown> {
  return rt.FeedMessage.toObject(feed, {
    longs: Number,
    enums: String,
    defaults: false,
    arrays: true,
  }) as Record<string, unknown>;
}

export function createRealtimeAlertStore(initialAlerts: ServiceAlertInput[] = []): RealtimeAlertStore {
  const alerts = new Map<string, StoredServiceAlert>();
  const store: RealtimeAlertStore = {
    list() {
      return [...alerts.values()].map(cloneStoredAlert).sort((a, b) => a.id.localeCompare(b.id));
    },
    listActive(at = new Date()) {
      const ts = toUnixSeconds(at, "activeAt");
      return this.list().filter((alert) => alert.enabled && isAlertActive(alert, ts));
    },
    get(id: string) {
      const alert = alerts.get(id);
      return alert ? cloneStoredAlert(alert) : undefined;
    },
    upsert(alert, now = new Date()) {
      // builder検証を通すことで、保存時点でprotobuf化できないAlertを拒否する。
      buildServiceAlertsFeed([alert], { timestamp: now });
      const timestamp = new Date(toUnixSeconds(now, "now") * 1000).toISOString();
      const current = alerts.get(alert.id);
      const stored: StoredServiceAlert = {
        ...cloneAlertInput(alert),
        enabled: alert.enabled ?? current?.enabled ?? true,
        createdAt: current?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      alerts.set(stored.id, stored);
      return cloneStoredAlert(stored);
    },
    remove(id: string) {
      return alerts.delete(id);
    },
    clear() {
      alerts.clear();
    },
    encode(options = {}) {
      return encodeServiceAlertsFeed(this.listActive(options.activeAt ?? options.timestamp ?? new Date()), options);
    },
  };
  for (const alert of initialAlerts) store.upsert(alert);
  return store;
}

function buildAlertEntity(alert: ServiceAlertInput): transit_realtime.IFeedEntity {
  if (alert.id.trim() === "") throw new Error("ServiceAlertInput.id is required");
  if (alert.informedEntities.length === 0) {
    throw new Error(`alert "${alert.id}" must include at least one informed entity`);
  }
  const headerText = translatedString(alert.headerText, `alert "${alert.id}" headerText`);
  const activePeriod = (alert.activePeriods ?? []).map((period) => {
    const out: transit_realtime.ITimeRange = {};
    if (period.start !== undefined) out.start = toUnixSeconds(period.start, "activePeriod.start");
    if (period.end !== undefined) out.end = toUnixSeconds(period.end, "activePeriod.end");
    if (out.start !== undefined && out.end !== undefined && Number(out.end) < Number(out.start)) {
      throw new Error(`alert "${alert.id}" activePeriod.end is before start`);
    }
    return out;
  });

  return {
    id: alert.id,
    alert: {
      ...(activePeriod.length > 0 ? { activePeriod } : {}),
      informedEntity: alert.informedEntities.map((entity) => informedEntity(entity)),
      cause: rt.Alert.Cause[alert.cause ?? "UNKNOWN_CAUSE"],
      effect: rt.Alert.Effect[alert.effect ?? "UNKNOWN_EFFECT"],
      severityLevel: rt.Alert.SeverityLevel[alert.severityLevel ?? "UNKNOWN_SEVERITY"],
      headerText,
      ...(alert.descriptionText ? { descriptionText: translatedString(alert.descriptionText, "descriptionText") } : {}),
      ...(alert.url ? { url: translatedString(alert.url, "url") } : {}),
    },
  };
}

function isAlertActive(alert: ServiceAlertInput, ts: number): boolean {
  const periods = alert.activePeriods ?? [];
  if (periods.length === 0) return true;
  return periods.some((period) => {
    const start = period.start === undefined ? Number.NEGATIVE_INFINITY : toUnixSeconds(period.start, "activePeriod.start");
    const end = period.end === undefined ? Number.POSITIVE_INFINITY : toUnixSeconds(period.end, "activePeriod.end");
    return start <= ts && ts <= end;
  });
}

function cloneStoredAlert(alert: StoredServiceAlert): StoredServiceAlert {
  return {
    ...cloneAlertInput(alert),
    enabled: alert.enabled,
    createdAt: alert.createdAt,
    updatedAt: alert.updatedAt,
  };
}

function cloneAlertInput(alert: ServiceAlertInput): ServiceAlertInput {
  return {
    id: alert.id,
    activePeriods: alert.activePeriods?.map((period) => ({ ...period })),
    informedEntities: alert.informedEntities.map((entity) => ({ ...entity })),
    cause: alert.cause,
    effect: alert.effect,
    severityLevel: alert.severityLevel,
    headerText: { ...alert.headerText },
    descriptionText: alert.descriptionText ? { ...alert.descriptionText } : undefined,
    url: alert.url ? { ...alert.url } : undefined,
  };
}

function informedEntity(entity: RealtimeInformedEntity): transit_realtime.IEntitySelector {
  const out: transit_realtime.IEntitySelector = {
    ...(entity.agencyId ? { agencyId: entity.agencyId } : {}),
    ...(entity.routeId ? { routeId: entity.routeId } : {}),
    ...(entity.routeType !== undefined ? { routeType: entity.routeType } : {}),
    ...(entity.stopId ? { stopId: entity.stopId } : {}),
    ...(entity.directionId !== undefined ? { directionId: entity.directionId } : {}),
  };
  if (entity.tripId || entity.routeIdForTrip || entity.startTime || entity.startDate) {
    out.trip = {
      ...(entity.tripId ? { tripId: entity.tripId } : {}),
      ...(entity.routeIdForTrip ? { routeId: entity.routeIdForTrip } : {}),
      ...(entity.startTime ? { startTime: entity.startTime } : {}),
      ...(entity.startDate ? { startDate: entity.startDate } : {}),
    };
  }
  if (Object.keys(out).length === 0) {
    throw new Error("informed entity must include agencyId, routeId, stopId, routeType, directionId, or trip");
  }
  return out;
}

function translatedString(text: RealtimeText, label: string): transit_realtime.ITranslatedString {
  const translation = Object.entries(text)
    .map(([language, value]) => ({ language, text: value.trim() }))
    .filter((item) => item.text !== "");
  if (translation.length === 0) throw new Error(`${label} must include at least one non-empty translation`);
  return { translation };
}

function toUnixSeconds(value: number | Date | string, label: string): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative Unix timestamp`);
    return Math.floor(value);
  }
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`${label} must be a valid Date or ISO 8601 string`);
  return Math.floor(ms / 1000);
}
