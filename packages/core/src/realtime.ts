/**
 * GTFS Realtime（GTFS-RT）最小builder。
 *
 * RT-1ではServiceAlertsを対象に、アプリ側の入力モデルから公式proto由来の
 * FeedMessageを生成する。HTTP配信層はこのUint8Arrayを `application/x-protobuf`
 * として返す想定。
 */
import gtfsRealtimeBindings from "gtfs-realtime-bindings";
import type { transit_realtime } from "gtfs-realtime-bindings";

// RT-2 外部中継・正規化を同じ `@gtfs-studio/core/realtime` サブパスで公開する。
export * from "./realtime-relay.js";

const { transit_realtime: rt } = gtfsRealtimeBindings;

export type RealtimeAlertCause = keyof typeof rt.Alert.Cause;
export type RealtimeAlertEffect = keyof typeof rt.Alert.Effect;
export type RealtimeAlertSeverity = keyof typeof rt.Alert.SeverityLevel;
export type TripScheduleRelationship = keyof typeof rt.TripDescriptor.ScheduleRelationship;
export type StopTimeScheduleRelationship = keyof typeof rt.TripUpdate.StopTimeUpdate.ScheduleRelationship;

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

export interface VehiclePositionInput {
  id: string;
  vehicleId: string;
  label?: string;
  licensePlate?: string;
  latitude: number;
  longitude: number;
  bearing?: number;
  odometer?: number;
  speed?: number;
  timestamp?: number | Date | string;
  tripId?: string;
  routeId?: string;
  startTime?: string;
  startDate?: string;
  directionId?: number;
}

export interface StoredVehiclePosition extends VehiclePositionInput {
  updatedAt: string;
  receivedAt: string;
}

export interface RealtimeVehicleStore {
  list(): StoredVehiclePosition[];
  get(id: string): StoredVehiclePosition | undefined;
  upsert(vehicle: VehiclePositionInput, now?: number | Date | string): StoredVehiclePosition;
  remove(id: string): boolean;
  clear(): void;
  encode(options?: BuildVehiclePositionsOptions): Uint8Array;
}

export interface BuildVehiclePositionsOptions {
  timestamp?: number | Date | string;
  feedVersion?: string;
  gtfsRealtimeVersion?: string;
}

export interface StopTimeUpdateInput {
  stopSequence?: number;
  stopId?: string;
  arrivalDelay?: number;
  arrivalTime?: number | Date | string;
  departureDelay?: number;
  departureTime?: number | Date | string;
  scheduleRelationship?: StopTimeScheduleRelationship;
}

export interface TripUpdateInput {
  id: string;
  tripId: string;
  routeId?: string;
  startTime?: string;
  startDate?: string;
  scheduleRelationship?: TripScheduleRelationship;
  vehicleId?: string;
  vehicleLabel?: string;
  vehicleLicensePlate?: string;
  timestamp?: number | Date | string;
  stopTimeUpdates: StopTimeUpdateInput[];
}

export interface StoredTripUpdate extends TripUpdateInput {
  updatedAt: string;
  receivedAt: string;
}

export interface RealtimeTripUpdateStore {
  list(): StoredTripUpdate[];
  get(id: string): StoredTripUpdate | undefined;
  upsert(update: TripUpdateInput, now?: number | Date | string): StoredTripUpdate;
  remove(id: string): boolean;
  clear(): void;
  encode(options?: BuildTripUpdatesOptions): Uint8Array;
}

export interface BuildTripUpdatesOptions {
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

export function buildVehiclePositionsFeed(
  vehicles: VehiclePositionInput[],
  options: BuildVehiclePositionsOptions = {},
): transit_realtime.IFeedMessage {
  const timestamp = toUnixSeconds(options.timestamp ?? new Date(), "timestamp");
  const feed: transit_realtime.IFeedMessage = {
    header: {
      gtfsRealtimeVersion: options.gtfsRealtimeVersion ?? "2.0",
      incrementality: rt.FeedHeader.Incrementality.FULL_DATASET,
      timestamp,
      ...(options.feedVersion ? { feedVersion: options.feedVersion } : {}),
    },
    entity: vehicles.map((vehicle) => buildVehicleEntity(vehicle, timestamp)),
  };
  const reason = rt.FeedMessage.verify(feed as unknown as Record<string, unknown>);
  if (reason) throw new Error(`invalid GTFS-RT FeedMessage: ${reason}`);
  return feed;
}

export function encodeVehiclePositionsFeed(
  vehicles: VehiclePositionInput[],
  options: BuildVehiclePositionsOptions = {},
): Uint8Array {
  return rt.FeedMessage.encode(buildVehiclePositionsFeed(vehicles, options)).finish();
}

export function buildTripUpdatesFeed(
  updates: TripUpdateInput[],
  options: BuildTripUpdatesOptions = {},
): transit_realtime.IFeedMessage {
  const timestamp = toUnixSeconds(options.timestamp ?? new Date(), "timestamp");
  const feed: transit_realtime.IFeedMessage = {
    header: {
      gtfsRealtimeVersion: options.gtfsRealtimeVersion ?? "2.0",
      incrementality: rt.FeedHeader.Incrementality.FULL_DATASET,
      timestamp,
      ...(options.feedVersion ? { feedVersion: options.feedVersion } : {}),
    },
    entity: updates.map((update) => buildTripUpdateEntity(update, timestamp)),
  };
  const reason = rt.FeedMessage.verify(feed as unknown as Record<string, unknown>);
  if (reason) throw new Error(`invalid GTFS-RT FeedMessage: ${reason}`);
  return feed;
}

export function encodeTripUpdatesFeed(
  updates: TripUpdateInput[],
  options: BuildTripUpdatesOptions = {},
): Uint8Array {
  return rt.FeedMessage.encode(buildTripUpdatesFeed(updates, options)).finish();
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

export function createRealtimeVehicleStore(initialVehicles: VehiclePositionInput[] = []): RealtimeVehicleStore {
  const vehicles = new Map<string, StoredVehiclePosition>();
  const store: RealtimeVehicleStore = {
    list() {
      return [...vehicles.values()].map(cloneStoredVehicle).sort((a, b) => a.id.localeCompare(b.id));
    },
    get(id: string) {
      const vehicle = vehicles.get(id);
      return vehicle ? cloneStoredVehicle(vehicle) : undefined;
    },
    upsert(vehicle, now = new Date()) {
      buildVehiclePositionsFeed([vehicle], { timestamp: now });
      const receivedAt = new Date(toUnixSeconds(now, "now") * 1000).toISOString();
      const updatedAt = new Date(
        toUnixSeconds(vehicle.timestamp ?? now, "vehicle.timestamp") * 1000,
      ).toISOString();
      const stored: StoredVehiclePosition = {
        ...cloneVehicleInput(vehicle),
        receivedAt,
        updatedAt,
      };
      vehicles.set(stored.id, stored);
      return cloneStoredVehicle(stored);
    },
    remove(id: string) {
      return vehicles.delete(id);
    },
    clear() {
      vehicles.clear();
    },
    encode(options = {}) {
      return encodeVehiclePositionsFeed(this.list(), options);
    },
  };
  for (const vehicle of initialVehicles) store.upsert(vehicle);
  return store;
}

export function createRealtimeTripUpdateStore(initialUpdates: TripUpdateInput[] = []): RealtimeTripUpdateStore {
  const updates = new Map<string, StoredTripUpdate>();
  const store: RealtimeTripUpdateStore = {
    list() {
      return [...updates.values()].map(cloneStoredTripUpdate).sort((a, b) => a.id.localeCompare(b.id));
    },
    get(id: string) {
      const update = updates.get(id);
      return update ? cloneStoredTripUpdate(update) : undefined;
    },
    upsert(update, now = new Date()) {
      buildTripUpdatesFeed([update], { timestamp: now });
      const receivedAt = new Date(toUnixSeconds(now, "now") * 1000).toISOString();
      const updatedAt = new Date(toUnixSeconds(update.timestamp ?? now, "tripUpdate.timestamp") * 1000).toISOString();
      const stored: StoredTripUpdate = {
        ...cloneTripUpdateInput(update),
        receivedAt,
        updatedAt,
      };
      updates.set(stored.id, stored);
      return cloneStoredTripUpdate(stored);
    },
    remove(id: string) {
      return updates.delete(id);
    },
    clear() {
      updates.clear();
    },
    encode(options = {}) {
      return encodeTripUpdatesFeed(this.list(), options);
    },
  };
  for (const update of initialUpdates) store.upsert(update);
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

function buildVehicleEntity(vehicle: VehiclePositionInput, feedTimestamp: number): transit_realtime.IFeedEntity {
  const id = vehicle.id.trim();
  if (id === "") throw new Error("VehiclePositionInput.id is required");
  const vehicleId = vehicle.vehicleId.trim();
  if (vehicleId === "") throw new Error(`vehicle "${id}" vehicleId is required`);
  if (!isValidPosition(vehicle.latitude, vehicle.longitude)) {
    throw new Error(`vehicle "${id}" latitude/longitude is out of range`);
  }
  if (vehicle.bearing !== undefined && (vehicle.bearing < 0 || vehicle.bearing > 360)) {
    throw new Error(`vehicle "${id}" bearing must be between 0 and 360`);
  }
  if (vehicle.speed !== undefined && vehicle.speed < 0) {
    throw new Error(`vehicle "${id}" speed must be >= 0`);
  }
  if (vehicle.odometer !== undefined && vehicle.odometer < 0) {
    throw new Error(`vehicle "${id}" odometer must be >= 0`);
  }
  const timestamp =
    vehicle.timestamp === undefined ? feedTimestamp : toUnixSeconds(vehicle.timestamp, "vehicle.timestamp");
  return {
    id,
    vehicle: {
      ...(vehicle.tripId || vehicle.routeId || vehicle.startTime || vehicle.startDate || vehicle.directionId !== undefined
        ? {
            trip: {
              ...(vehicle.tripId ? { tripId: vehicle.tripId } : {}),
              ...(vehicle.routeId ? { routeId: vehicle.routeId } : {}),
              ...(vehicle.startTime ? { startTime: vehicle.startTime } : {}),
              ...(vehicle.startDate ? { startDate: vehicle.startDate } : {}),
              ...(vehicle.directionId !== undefined ? { directionId: vehicle.directionId } : {}),
            },
          }
        : {}),
      vehicle: {
        id: vehicleId,
        ...(vehicle.label ? { label: vehicle.label } : {}),
        ...(vehicle.licensePlate ? { licensePlate: vehicle.licensePlate } : {}),
      },
      position: {
        latitude: vehicle.latitude,
        longitude: vehicle.longitude,
        ...(vehicle.bearing !== undefined ? { bearing: vehicle.bearing } : {}),
        ...(vehicle.odometer !== undefined ? { odometer: vehicle.odometer } : {}),
        ...(vehicle.speed !== undefined ? { speed: vehicle.speed } : {}),
      },
      timestamp,
    },
  };
}

function buildTripUpdateEntity(update: TripUpdateInput, feedTimestamp: number): transit_realtime.IFeedEntity {
  const id = update.id.trim();
  if (id === "") throw new Error("TripUpdateInput.id is required");
  const tripId = update.tripId.trim();
  if (tripId === "") throw new Error(`trip update "${id}" tripId is required`);
  if (update.stopTimeUpdates.length === 0) {
    throw new Error(`trip update "${id}" must include at least one stopTimeUpdate`);
  }
  const timestamp =
    update.timestamp === undefined ? feedTimestamp : toUnixSeconds(update.timestamp, "tripUpdate.timestamp");
  return {
    id,
    tripUpdate: {
      trip: {
        tripId,
        ...(update.routeId ? { routeId: update.routeId } : {}),
        ...(update.startTime ? { startTime: update.startTime } : {}),
        ...(update.startDate ? { startDate: update.startDate } : {}),
        scheduleRelationship: rt.TripDescriptor.ScheduleRelationship[update.scheduleRelationship ?? "SCHEDULED"],
      },
      ...(update.vehicleId
        ? {
            vehicle: {
              id: update.vehicleId,
              ...(update.vehicleLabel ? { label: update.vehicleLabel } : {}),
              ...(update.vehicleLicensePlate ? { licensePlate: update.vehicleLicensePlate } : {}),
            },
          }
        : {}),
      stopTimeUpdate: update.stopTimeUpdates.map((stop, index) => buildStopTimeUpdate(id, stop, index)),
      timestamp,
    },
  };
}

function buildStopTimeUpdate(
  tripUpdateId: string,
  stop: StopTimeUpdateInput,
  index: number,
): transit_realtime.TripUpdate.IStopTimeUpdate {
  if (stop.stopSequence === undefined && !stop.stopId) {
    throw new Error(`trip update "${tripUpdateId}" stopTimeUpdate[${index}] needs stopSequence or stopId`);
  }
  if (stop.stopSequence !== undefined && (!Number.isInteger(stop.stopSequence) || stop.stopSequence <= 0)) {
    throw new Error(`trip update "${tripUpdateId}" stopSequence must be a positive integer`);
  }
  const out: transit_realtime.TripUpdate.IStopTimeUpdate = {
    ...(stop.stopSequence !== undefined ? { stopSequence: stop.stopSequence } : {}),
    ...(stop.stopId ? { stopId: stop.stopId } : {}),
    scheduleRelationship:
      rt.TripUpdate.StopTimeUpdate.ScheduleRelationship[stop.scheduleRelationship ?? "SCHEDULED"],
  };
  const arrival = stopEvent(stop.arrivalDelay, stop.arrivalTime, "arrival");
  if (arrival) out.arrival = arrival;
  const departure = stopEvent(stop.departureDelay, stop.departureTime, "departure");
  if (departure) out.departure = departure;
  return out;
}

function stopEvent(
  delay: number | undefined,
  time: number | Date | string | undefined,
  label: string,
): transit_realtime.TripUpdate.IStopTimeEvent | undefined {
  if (delay === undefined && time === undefined) return undefined;
  if (delay !== undefined && (!Number.isFinite(delay) || !Number.isInteger(delay))) {
    throw new Error(`${label}.delay must be an integer number of seconds`);
  }
  return {
    ...(delay !== undefined ? { delay } : {}),
    ...(time !== undefined ? { time: toUnixSeconds(time, `${label}.time`) } : {}),
  };
}

function isValidPosition(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180 &&
    !(lat === 0 && lon === 0)
  );
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

function cloneStoredVehicle(vehicle: StoredVehiclePosition): StoredVehiclePosition {
  return {
    ...cloneVehicleInput(vehicle),
    updatedAt: vehicle.updatedAt,
    receivedAt: vehicle.receivedAt,
  };
}

function cloneVehicleInput(vehicle: VehiclePositionInput): VehiclePositionInput {
  return {
    id: vehicle.id,
    vehicleId: vehicle.vehicleId,
    label: vehicle.label,
    licensePlate: vehicle.licensePlate,
    latitude: vehicle.latitude,
    longitude: vehicle.longitude,
    bearing: vehicle.bearing,
    odometer: vehicle.odometer,
    speed: vehicle.speed,
    timestamp: vehicle.timestamp,
    tripId: vehicle.tripId,
    routeId: vehicle.routeId,
    startTime: vehicle.startTime,
    startDate: vehicle.startDate,
    directionId: vehicle.directionId,
  };
}

function cloneStoredTripUpdate(update: StoredTripUpdate): StoredTripUpdate {
  return {
    ...cloneTripUpdateInput(update),
    updatedAt: update.updatedAt,
    receivedAt: update.receivedAt,
  };
}

function cloneTripUpdateInput(update: TripUpdateInput): TripUpdateInput {
  return {
    id: update.id,
    tripId: update.tripId,
    routeId: update.routeId,
    startTime: update.startTime,
    startDate: update.startDate,
    scheduleRelationship: update.scheduleRelationship,
    vehicleId: update.vehicleId,
    vehicleLabel: update.vehicleLabel,
    vehicleLicensePlate: update.vehicleLicensePlate,
    timestamp: update.timestamp,
    stopTimeUpdates: update.stopTimeUpdates.map((stop) => ({ ...stop })),
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
