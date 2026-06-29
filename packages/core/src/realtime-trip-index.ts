import { getRows, type Feed } from "./model.js";
import type { TripUpdateInput } from "./realtime.js";

export interface StaticStopTime {
  tripId: string;
  stopSequence: number;
  stopId: string;
  arrivalTime?: string;
  departureTime?: string;
}

export interface StaticTripForRealtime {
  tripId: string;
  routeId: string;
  serviceId: string;
  tripHeadsign?: string;
  directionId?: number;
  shapeId?: string;
  stopTimes: StaticStopTime[];
}

export interface RealtimeTripIndex {
  trips: StaticTripForRealtime[];
  byTripId: Map<string, StaticTripForRealtime>;
  byRouteId: Map<string, StaticTripForRealtime[]>;
}

export interface StaticTripDelayInput {
  /** 省略時は `tripId` を使う。 */
  id?: string;
  tripId: string;
  /** 秒単位の遅延。負値は早発/早着として扱う。 */
  delaySec: number;
  /** 指定したstop_sequence以降だけに遅延を付ける。 */
  fromStopSequence?: number;
  /** 指定したstop_id以降だけに遅延を付ける。 */
  fromStopId?: string;
  timestamp?: number | Date | string;
  vehicleId?: string;
}

/**
 * 静的GTFSからTripUpdates生成に必要な trips/stop_times index を作る。
 * route/service/trip/stop_sequence を素直に引ける軽量な読み取り専用構造。
 */
export function buildRealtimeTripIndex(feed: Feed): RealtimeTripIndex {
  const stopTimesByTripId = new Map<string, StaticStopTime[]>();
  for (const row of getRows(feed, "stop_times")) {
    const tripId = (row["trip_id"] ?? "").trim();
    const stopSequence = parsePositiveInteger(row["stop_sequence"]);
    const stopId = (row["stop_id"] ?? "").trim();
    if (!tripId || stopSequence === undefined || !stopId) continue;
    const stopTime: StaticStopTime = {
      tripId,
      stopSequence,
      stopId,
      arrivalTime: nonEmpty(row["arrival_time"]),
      departureTime: nonEmpty(row["departure_time"]),
    };
    const list = stopTimesByTripId.get(tripId) ?? [];
    list.push(stopTime);
    stopTimesByTripId.set(tripId, list);
  }

  const trips: StaticTripForRealtime[] = [];
  const byTripId = new Map<string, StaticTripForRealtime>();
  const byRouteId = new Map<string, StaticTripForRealtime[]>();

  for (const row of getRows(feed, "trips")) {
    const tripId = (row["trip_id"] ?? "").trim();
    const routeId = (row["route_id"] ?? "").trim();
    const serviceId = (row["service_id"] ?? "").trim();
    if (!tripId || !routeId || !serviceId) continue;

    const stopTimes = [...(stopTimesByTripId.get(tripId) ?? [])].sort(
      (a, b) => a.stopSequence - b.stopSequence,
    );
    const trip: StaticTripForRealtime = {
      tripId,
      routeId,
      serviceId,
      tripHeadsign: nonEmpty(row["trip_headsign"]),
      directionId: parseNonNegativeInteger(row["direction_id"]),
      shapeId: nonEmpty(row["shape_id"]),
      stopTimes,
    };
    trips.push(trip);
    byTripId.set(tripId, trip);
    const routeTrips = byRouteId.get(routeId) ?? [];
    routeTrips.push(trip);
    byRouteId.set(routeId, routeTrips);
  }

  for (const routeTrips of byRouteId.values()) {
    routeTrips.sort((a, b) => a.tripId.localeCompare(b.tripId));
  }
  trips.sort((a, b) => a.tripId.localeCompare(b.tripId));

  return { trips, byTripId, byRouteId };
}

/**
 * trip_id が特定済みの遅延情報を、GTFS-RT TripUpdateInputへ展開する。
 * 位置・運用番号からのtrip推定は別レイヤで行い、この関数は静的GTFSとの整合を保証する。
 */
export function tripDelayToTripUpdate(
  index: RealtimeTripIndex,
  input: StaticTripDelayInput,
): TripUpdateInput {
  const trip = index.byTripId.get(input.tripId);
  if (!trip) throw new Error(`unknown trip_id: ${input.tripId}`);
  if (!Number.isInteger(input.delaySec)) throw new Error("delaySec must be an integer number of seconds");

  const stopTimes = selectDelayedStops(trip, input);
  if (stopTimes.length === 0) {
    throw new Error(`trip "${input.tripId}" has no matching stop_times for delay input`);
  }

  return {
    id: input.id ?? input.tripId,
    tripId: trip.tripId,
    routeId: trip.routeId,
    timestamp: input.timestamp,
    vehicleId: input.vehicleId,
    stopTimeUpdates: stopTimes.map((stop) => ({
      stopSequence: stop.stopSequence,
      stopId: stop.stopId,
      arrivalDelay: stop.arrivalTime ? input.delaySec : undefined,
      departureDelay: stop.departureTime ? input.delaySec : undefined,
    })),
  };
}

function selectDelayedStops(trip: StaticTripForRealtime, input: StaticTripDelayInput): StaticStopTime[] {
  let fromSequence = input.fromStopSequence;
  if (fromSequence === undefined && input.fromStopId) {
    fromSequence = trip.stopTimes.find((stop) => stop.stopId === input.fromStopId)?.stopSequence;
    if (fromSequence === undefined) throw new Error(`trip "${trip.tripId}" does not include stop_id: ${input.fromStopId}`);
  }
  if (fromSequence === undefined) return trip.stopTimes;
  if (!Number.isInteger(fromSequence) || fromSequence <= 0) {
    throw new Error("fromStopSequence must be a positive integer");
  }
  return trip.stopTimes.filter((stop) => stop.stopSequence >= fromSequence);
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  const n = parseNonNegativeInteger(value);
  return n !== undefined && n > 0 ? n : undefined;
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}
