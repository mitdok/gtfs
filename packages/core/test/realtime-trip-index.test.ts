import { describe, expect, it } from "vitest";
import { importEntries } from "../src/importer.js";
import {
  buildRealtimeTripIndex,
  estimateStopProgress,
  evaluateRealtimeTripMatching,
  findRealtimeTripCandidates,
  matchedTripDelayToTripUpdate,
  tripProgressToTripUpdate,
  tripDelayToTripUpdate,
} from "../src/realtime-trip-index.js";
import { decodeRealtimeFeed, encodeTripUpdatesFeed } from "../src/realtime.js";
import { sampleEntries } from "./fixtures.js";

function sampleFeed() {
  return importEntries(sampleEntries()).feed;
}

describe("GTFS-RT TripUpdates static index", () => {
  it("trips と stop_times からTripUpdates用indexを作る", () => {
    const index = buildRealtimeTripIndex(sampleFeed());

    expect(index.trips.map((trip) => trip.tripId)).toEqual(["T1", "T2"]);
    expect(index.byTripId.get("T1")?.routeId).toBe("R1");
    expect(index.byRouteId.get("R1")?.map((trip) => trip.tripId)).toEqual(["T1", "T2"]);
    expect(index.byTripId.get("T1")?.stopTimes.map((stop) => stop.stopSequence)).toEqual([1, 2, 3]);
  });

  it("trip_id基準の遅延をStopTimeUpdateへ展開しprotobuf化できる", () => {
    const index = buildRealtimeTripIndex(sampleFeed());
    const update = tripDelayToTripUpdate(index, {
      tripId: "T1",
      delaySec: 120,
      fromStopSequence: 2,
      timestamp: "2026-06-16T00:10:00Z",
      vehicleId: "bus-1",
    });

    expect(update.routeId).toBe("R1");
    expect(update.stopTimeUpdates.map((stop) => stop.stopSequence)).toEqual([2, 3]);
    expect(update.stopTimeUpdates[0]?.arrivalDelay).toBe(120);
    expect(update.stopTimeUpdates[0]?.departureDelay).toBe(120);

    const feed = decodeRealtimeFeed(encodeTripUpdatesFeed([update], { timestamp: "2026-06-16T00:10:05Z" }));
    expect(feed.entity[0]?.tripUpdate?.trip?.tripId).toBe("T1");
    expect(feed.entity[0]?.tripUpdate?.stopTimeUpdate?.[0]?.stopSequence).toBe(2);
    expect(feed.entity[0]?.tripUpdate?.stopTimeUpdate?.[0]?.arrival?.delay).toBe(120);
  });

  it("fromStopId以降の停留所だけに遅延を付ける", () => {
    const index = buildRealtimeTripIndex(sampleFeed());
    const update = tripDelayToTripUpdate(index, {
      tripId: "T2",
      delaySec: -60,
      fromStopId: "S2",
    });

    expect(update.stopTimeUpdates.map((stop) => stop.stopId)).toEqual(["S2", "S3"]);
    expect(update.stopTimeUpdates[0]?.arrivalDelay).toBe(-60);
  });

  it("route_id と時刻から近いtrip候補を返す", () => {
    const index = buildRealtimeTripIndex(sampleFeed());
    const matches = findRealtimeTripCandidates(index, {
      routeId: "R1",
      serviceId: "weekday",
      atTime: "07:04:30",
      atStopId: "S2",
      maxTimeDiffSec: 120,
    });

    expect(matches.map((match) => match.trip.tripId)).toEqual(["T1"]);
    expect(matches[0]?.matchedStopTime?.stopId).toBe("S2");
    expect(matches[0]?.timeDiffSec).toBe(30);
  });

  it("24時超のGTFS時刻で深夜便を候補にできる", () => {
    const index = buildRealtimeTripIndex(sampleFeed());
    const matches = findRealtimeTripCandidates(index, {
      routeId: "R1",
      atTime: "25:04:00",
      atStopId: "S2",
      maxTimeDiffSec: 120,
    });

    expect(matches.map((match) => match.trip.tripId)).toEqual(["T2"]);
  });

  it("最も近いtrip候補から遅延TripUpdateを作る", () => {
    const index = buildRealtimeTripIndex(sampleFeed());
    const update = matchedTripDelayToTripUpdate(index, {
      routeId: "R1",
      atTime: "07:05:30",
      atStopId: "S2",
      maxTimeDiffSec: 120,
      delaySec: 90,
      vehicleId: "bus-1",
    });

    expect(update.tripId).toBe("T1");
    expect(update.vehicleId).toBe("bus-1");
    expect(update.stopTimeUpdates.map((stop) => stop.stopId)).toEqual(["S2", "S3"]);
    expect(update.stopTimeUpdates[0]?.departureDelay).toBe(90);
  });

  it("trip候補抽出の品質を集計できる", () => {
    const index = buildRealtimeTripIndex(sampleFeed());
    const evaluation = evaluateRealtimeTripMatching(index, [
      {
        routeId: "R1",
        atTime: "07:05:30",
        atStopId: "S2",
        maxTimeDiffSec: 120,
        expectedTripId: "T1",
      },
      {
        routeId: "R1",
        atTime: "25:05:30",
        atStopId: "S2",
        maxTimeDiffSec: 120,
        expectedTripId: "T2",
      },
      {
        routeId: "R1",
        atTime: "12:00:00",
        maxTimeDiffSec: 60,
        expectedTripId: "T1",
      },
      {
        routeId: "R1",
        atTime: "07:04:30",
        maxTimeDiffSec: 24 * 3600,
      },
    ]);

    expect(evaluation.total).toBe(4);
    expect(evaluation.unique).toBe(2);
    expect(evaluation.miss).toBe(1);
    expect(evaluation.ambiguous).toBe(1);
    expect(evaluation.expectedKnown).toBe(3);
    expect(evaluation.expectedMatched).toBe(2);
    expect(evaluation.expectedAccuracy).toBeCloseTo(2 / 3);
    expect(evaluation.averageBestTimeDiffSec).toBeGreaterThan(0);
    expect(evaluation.maxBestTimeDiffSec).toBeGreaterThanOrEqual(evaluation.averageBestTimeDiffSec!);
  });

  it("静的時刻と遅延秒から現在/次停留所を推定できる", () => {
    const index = buildRealtimeTripIndex(sampleFeed());

    const before = estimateStopProgress(index, { tripId: "T1", atTime: "06:59:00" });
    expect(before.status).toBe("before_start");
    expect(before.nextStopTime?.stopId).toBe("S1");

    const progress = estimateStopProgress(index, { tripId: "T1", atTime: "07:06:00", delaySec: 60 });
    expect(progress.status).toBe("in_progress");
    expect(progress.currentStopTime?.stopId).toBe("S2");
    expect(progress.nextStopTime?.stopId).toBe("S3");
    expect(progress.currentAdjustedTimeSec).toBe(7 * 3600 + 6 * 60);
    expect(progress.progressRatio).toBe(0);

    const after = estimateStopProgress(index, { tripId: "T1", atTime: "07:30:00" });
    expect(after.status).toBe("after_end");
    expect(after.currentStopTime?.stopId).toBe("S3");
  });

  it("進捗推定から次停留所以降のTripUpdateを作れる", () => {
    const index = buildRealtimeTripIndex(sampleFeed());
    const update = tripProgressToTripUpdate(index, {
      tripId: "T1",
      atTime: "07:06:00",
      delaySec: 60,
      vehicleId: "bus-1",
    });

    expect(update.tripId).toBe("T1");
    expect(update.vehicleId).toBe("bus-1");
    expect(update.stopTimeUpdates.map((stop) => stop.stopId)).toEqual(["S3"]);
    expect(update.stopTimeUpdates[0]?.arrivalDelay).toBe(60);
  });

  it("未知tripや静的GTFSにない停留所を拒否する", () => {
    const index = buildRealtimeTripIndex(sampleFeed());

    expect(() => tripDelayToTripUpdate(index, { tripId: "NOPE", delaySec: 60 })).toThrow(/unknown trip_id/);
    expect(() => tripDelayToTripUpdate(index, { tripId: "T1", delaySec: 60.5 })).toThrow(/delaySec/);
    expect(() => tripDelayToTripUpdate(index, { tripId: "T1", delaySec: 60, fromStopId: "NOPE" })).toThrow(
      /stop_id/,
    );
    expect(() => findRealtimeTripCandidates(index, { routeId: "R1", atTime: "bad" })).toThrow(/atTime/);
    expect(() =>
      matchedTripDelayToTripUpdate(index, {
        routeId: "R1",
        atTime: "12:00:00",
        maxTimeDiffSec: 60,
        delaySec: 60,
      }),
    ).toThrow(/no trip candidate/);
    expect(() => estimateStopProgress(index, { tripId: "NOPE", atTime: "07:00:00" })).toThrow(/unknown trip_id/);
  });
});
