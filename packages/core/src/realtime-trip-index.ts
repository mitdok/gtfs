import { getRows, type Feed } from "./model.js";
import type { TripUpdateInput } from "./realtime.js";
import { hmsToSec } from "./time.js";

export interface StaticStopTime {
  tripId: string;
  stopSequence: number;
  stopId: string;
  arrivalTime?: string;
  departureTime?: string;
  arrivalSec?: number;
  departureSec?: number;
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

export interface RealtimeTripMatchInput {
  routeId: string;
  /** 指定時は該当service_idに限定する。 */
  serviceId?: string;
  /** 指定時は該当direction_idに限定する。 */
  directionId?: number;
  /** GTFS時刻（例: 07:05:00 / 25:05:00）またはサービス日からの秒。 */
  atTime: string | number;
  /** 指定時は、その停留所のstop_timeで時刻差を見る。 */
  atStopId?: string;
  /** 候補に含める最大時刻差。既定30分。 */
  maxTimeDiffSec?: number;
}

export interface RealtimeTripMatch {
  trip: StaticTripForRealtime;
  timeDiffSec: number;
  matchedTimeSec: number;
  matchedStopTime?: StaticStopTime;
}

export interface MatchedTripDelayInput extends RealtimeTripMatchInput {
  /** 秒単位の遅延。負値は早発/早着として扱う。 */
  delaySec: number;
  id?: string;
  timestamp?: number | Date | string;
  vehicleId?: string;
}

export interface RealtimeTripMatchProbe extends RealtimeTripMatchInput {
  /** 正解trip_idが分かっている評価データの場合に指定する。 */
  expectedTripId?: string;
}

export interface RealtimeTripMatchProbeResult {
  probe: RealtimeTripMatchProbe;
  candidates: RealtimeTripMatch[];
  bestTripId?: string;
  bestTimeDiffSec?: number;
  matchedExpected?: boolean;
  status: "miss" | "unique" | "ambiguous";
}

export interface RealtimeTripMatchEvaluation {
  total: number;
  miss: number;
  unique: number;
  ambiguous: number;
  expectedKnown: number;
  expectedMatched: number;
  expectedAccuracy: number | null;
  averageBestTimeDiffSec: number | null;
  maxBestTimeDiffSec: number | null;
  results: RealtimeTripMatchProbeResult[];
}

export interface StopProgressInput {
  tripId: string;
  /** GTFS時刻（例: 07:05:00 / 25:05:00）またはサービス日からの秒。 */
  atTime: string | number;
  /** 秒単位の遅延。指定時は静的時刻に加算して進捗判定する。 */
  delaySec?: number;
}

export interface StopProgressEstimate {
  trip: StaticTripForRealtime;
  status: "before_start" | "in_progress" | "after_end" | "no_stop_times";
  /** 直近で通過済み、または停車中とみなせる停留所。 */
  currentStopTime?: StaticStopTime;
  /** 次に到着予定の停留所。 */
  nextStopTime?: StaticStopTime;
  currentAdjustedTimeSec?: number;
  nextAdjustedTimeSec?: number;
  delaySec: number;
  /** current→next間の進捗。停留所間が判定できる時だけ0〜1で返す。 */
  progressRatio?: number;
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
      arrivalSec: parseGtfsTime(row["arrival_time"]),
      departureSec: parseGtfsTime(row["departure_time"]),
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
 * route_idと時刻から静的GTFS上の候補tripを近い順に返す。
 * 運用番号や車両位置による推定は含めず、GTFSのstop_timesだけを根拠にする。
 */
export function findRealtimeTripCandidates(
  index: RealtimeTripIndex,
  input: RealtimeTripMatchInput,
): RealtimeTripMatch[] {
  const routeId = input.routeId.trim();
  if (!routeId) throw new Error("routeId is required");
  const targetSec = parseMatchTime(input.atTime);
  const maxTimeDiffSec = input.maxTimeDiffSec ?? 30 * 60;
  if (!Number.isFinite(maxTimeDiffSec) || maxTimeDiffSec < 0) {
    throw new Error("maxTimeDiffSec must be a non-negative number of seconds");
  }

  const routeTrips = index.byRouteId.get(routeId) ?? [];
  const matches: RealtimeTripMatch[] = [];
  for (const trip of routeTrips) {
    if (input.serviceId && trip.serviceId !== input.serviceId) continue;
    if (input.directionId !== undefined && trip.directionId !== input.directionId) continue;
    for (const stopTime of comparableStopTimes(trip, input.atStopId)) {
      const matchedTimeSec = stopTime.departureSec ?? stopTime.arrivalSec;
      if (matchedTimeSec === undefined) continue;
      const timeDiffSec = Math.abs(matchedTimeSec - targetSec);
      if (timeDiffSec <= maxTimeDiffSec) {
        matches.push({ trip, matchedStopTime: stopTime, matchedTimeSec, timeDiffSec });
      }
    }
  }

  return matches.sort(
    (a, b) =>
      a.timeDiffSec - b.timeDiffSec ||
      (a.matchedStopTime?.stopSequence ?? 0) - (b.matchedStopTime?.stopSequence ?? 0) ||
      a.trip.tripId.localeCompare(b.trip.tripId),
  );
}

/**
 * route_id/時刻で最も近い静的tripを選び、遅延TripUpdateへ展開する。
 * 曖昧性をUIや運用で扱いたい場合は `findRealtimeTripCandidates` を直接使う。
 */
export function matchedTripDelayToTripUpdate(
  index: RealtimeTripIndex,
  input: MatchedTripDelayInput,
): TripUpdateInput {
  const match = findRealtimeTripCandidates(index, input)[0];
  if (!match) throw new Error(`no trip candidate found for route_id: ${input.routeId}`);
  return tripDelayToTripUpdate(index, {
    id: input.id ?? match.trip.tripId,
    tripId: match.trip.tripId,
    delaySec: input.delaySec,
    fromStopSequence: match.matchedStopTime?.stopSequence,
    timestamp: input.timestamp,
    vehicleId: input.vehicleId,
  });
}

/**
 * trip候補抽出の品質を評価する。
 * 実データログを `RealtimeTripMatchProbe` に変換して渡すと、候補なし・一意・曖昧・正解一致率を確認できる。
 */
export function evaluateRealtimeTripMatching(
  index: RealtimeTripIndex,
  probes: RealtimeTripMatchProbe[],
): RealtimeTripMatchEvaluation {
  const results = probes.map((probe) => {
    const candidates = findRealtimeTripCandidates(index, probe);
    const best = candidates[0];
    const matchedExpected =
      probe.expectedTripId === undefined ? undefined : best?.trip.tripId === probe.expectedTripId;
    const status: RealtimeTripMatchProbeResult["status"] =
      candidates.length === 0 ? "miss" : candidates.length === 1 ? "unique" : "ambiguous";
    return {
      probe,
      candidates,
      bestTripId: best?.trip.tripId,
      bestTimeDiffSec: best?.timeDiffSec,
      matchedExpected,
      status,
    };
  });

  const bestDiffs = results
    .map((result) => result.bestTimeDiffSec)
    .filter((value): value is number => value !== undefined);
  const expectedResults = results.filter((result) => result.matchedExpected !== undefined);
  const expectedMatched = expectedResults.filter((result) => result.matchedExpected).length;
  return {
    total: results.length,
    miss: results.filter((result) => result.status === "miss").length,
    unique: results.filter((result) => result.status === "unique").length,
    ambiguous: results.filter((result) => result.status === "ambiguous").length,
    expectedKnown: expectedResults.length,
    expectedMatched,
    expectedAccuracy: expectedResults.length === 0 ? null : expectedMatched / expectedResults.length,
    averageBestTimeDiffSec: bestDiffs.length === 0 ? null : average(bestDiffs),
    maxBestTimeDiffSec: bestDiffs.length === 0 ? null : Math.max(...bestDiffs),
    results,
  };
}

/**
 * 静的stop_timesと任意の遅延秒から、現在/次停留所を推定する。
 * GPSを使わないため実位置ではなく、サービス日内時刻に対するダイヤ上の進捗を返す。
 */
export function estimateStopProgress(
  index: RealtimeTripIndex,
  input: StopProgressInput,
): StopProgressEstimate {
  const trip = index.byTripId.get(input.tripId);
  if (!trip) throw new Error(`unknown trip_id: ${input.tripId}`);
  const atSec = parseMatchTime(input.atTime);
  const delaySec = input.delaySec ?? 0;
  if (!Number.isInteger(delaySec)) throw new Error("delaySec must be an integer number of seconds");

  const timedStops = trip.stopTimes
    .map((stop) => ({ stop, adjustedSec: representativeStopTimeSec(stop) }))
    .filter((item): item is { stop: StaticStopTime; adjustedSec: number } => item.adjustedSec !== undefined)
    .map((item) => ({ ...item, adjustedSec: item.adjustedSec + delaySec }));
  if (timedStops.length === 0) {
    return { trip, status: "no_stop_times", delaySec };
  }

  const next = timedStops.find((item) => item.adjustedSec > atSec);
  if (!next) {
    const last = timedStops[timedStops.length - 1]!;
    return {
      trip,
      status: "after_end",
      currentStopTime: last.stop,
      currentAdjustedTimeSec: last.adjustedSec,
      delaySec,
    };
  }

  const nextIndex = timedStops.indexOf(next);
  const current = nextIndex > 0 ? timedStops[nextIndex - 1] : undefined;
  if (!current) {
    return {
      trip,
      status: "before_start",
      nextStopTime: next.stop,
      nextAdjustedTimeSec: next.adjustedSec,
      delaySec,
    };
  }

  const span = next.adjustedSec - current.adjustedSec;
  return {
    trip,
    status: "in_progress",
    currentStopTime: current.stop,
    nextStopTime: next.stop,
    currentAdjustedTimeSec: current.adjustedSec,
    nextAdjustedTimeSec: next.adjustedSec,
    delaySec,
    progressRatio: span <= 0 ? undefined : clamp01((atSec - current.adjustedSec) / span),
  };
}

/**
 * 進捗推定からTripUpdateを作る。
 * 次停留所があれば次停留所以降、終端後なら最終停留所から遅延を反映する。
 */
export function tripProgressToTripUpdate(
  index: RealtimeTripIndex,
  input: StopProgressInput & { id?: string; timestamp?: number | Date | string; vehicleId?: string },
): TripUpdateInput {
  const progress = estimateStopProgress(index, input);
  const fromStopSequence =
    progress.nextStopTime?.stopSequence ?? progress.currentStopTime?.stopSequence;
  if (fromStopSequence === undefined) {
    throw new Error(`trip "${input.tripId}" has no timed stop_times for progress update`);
  }
  return tripDelayToTripUpdate(index, {
    id: input.id,
    tripId: input.tripId,
    delaySec: progress.delaySec,
    fromStopSequence,
    timestamp: input.timestamp,
    vehicleId: input.vehicleId,
  });
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

function comparableStopTimes(trip: StaticTripForRealtime, atStopId: string | undefined): StaticStopTime[] {
  if (atStopId) return trip.stopTimes.filter((stop) => stop.stopId === atStopId);
  const first = trip.stopTimes.find((stop) => stop.departureSec !== undefined || stop.arrivalSec !== undefined);
  return first ? [first] : [];
}

function representativeStopTimeSec(stop: StaticStopTime): number | undefined {
  return stop.departureSec ?? stop.arrivalSec;
}

function parseMatchTime(value: string | number): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw new Error("atTime must be a non-negative service-day second");
    return Math.floor(value);
  }
  const sec = hmsToSec(value);
  if (sec === null) throw new Error("atTime must be a GTFS HH:MM:SS time");
  return sec;
}

function parseGtfsTime(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return hmsToSec(trimmed) ?? undefined;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}
