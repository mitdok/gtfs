import { describe, expect, it } from "vitest";
import { importEntries } from "../src/importer.js";
import { buildRealtimeTripIndex, tripDelayToTripUpdate } from "../src/realtime-trip-index.js";
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

  it("未知tripや静的GTFSにない停留所を拒否する", () => {
    const index = buildRealtimeTripIndex(sampleFeed());

    expect(() => tripDelayToTripUpdate(index, { tripId: "NOPE", delaySec: 60 })).toThrow(/unknown trip_id/);
    expect(() => tripDelayToTripUpdate(index, { tripId: "T1", delaySec: 60.5 })).toThrow(/delaySec/);
    expect(() => tripDelayToTripUpdate(index, { tripId: "T1", delaySec: 60, fromStopId: "NOPE" })).toThrow(
      /stop_id/,
    );
  });
});
