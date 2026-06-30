import { describe, it, expect } from "vitest";
import gtfsRealtimeBindings from "gtfs-realtime-bindings";
import {
  checkRealtimeStaticCompatibility,
  createRtRelayStore,
  encodeServiceAlertsFeed,
  validateRealtimeFeed,
  RT_FRESHNESS_SLO_SEC,
} from "../src/realtime.js";
import { importEntries } from "../src/importer.js";
import { sampleEntries } from "./fixtures.js";

const { transit_realtime: rt } = gtfsRealtimeBindings;

/** 車両位置 Feed を protobuf バイト列で作る（FeedHeader.timestamp 指定）。 */
function vehicleFeed(feedTs: number, lat: number, lon: number): Uint8Array {
  const msg = {
    header: { gtfsRealtimeVersion: "2.0", incrementality: 0, timestamp: feedTs },
    entity: [
      {
        id: "v1",
        vehicle: {
          vehicle: { id: "BUS-1" },
          trip: { tripId: "T1", routeId: "R1" },
          position: { latitude: lat, longitude: lon },
          timestamp: feedTs,
        },
      },
    ],
  };
  return rt.FeedMessage.encode(rt.FeedMessage.create(msg)).finish();
}

describe("RT-2 外部GTFS-RT中継・正規化", () => {
  it("VehiclePositions Feed を decode・正規化し参照IDを抽出する", () => {
    const { summary } = validateRealtimeFeed(vehicleFeed(1_000, 34.76, 137.38));
    expect(summary.feedTimestamp).toBe(1_000);
    expect(summary.counts.vehiclePosition).toBe(1);
    expect(summary.referencedTripIds).toEqual(["T1"]);
    expect(summary.referencedRouteIds).toEqual(["R1"]);
    expect(summary.issues).toEqual([]);
  });

  it("座標範囲外・timestamp欠落を issue として検出する", () => {
    const bad = rt.FeedMessage.encode(
      rt.FeedMessage.create({
        header: { gtfsRealtimeVersion: "2.0" },
        entity: [{ id: "v1", vehicle: { vehicle: { id: "B" }, position: { latitude: 200, longitude: 0 } } }],
      }),
    ).finish();
    const { summary } = validateRealtimeFeed(bad);
    expect(summary.issues.some((i) => i.includes("timestamp"))).toBe(true);
    expect(summary.issues.some((i) => i.includes("座標"))).toBe(true);
  });

  it("ServiceAlerts Feed も中継対象として正規化できる", () => {
    const bytes = encodeServiceAlertsFeed(
      [{ id: "a1", informedEntities: [{ stopId: "S1" }], headerText: { ja: "運休" } }],
      { timestamp: 2_000 },
    );
    const { summary } = validateRealtimeFeed(bytes);
    expect(summary.counts.alert).toBe(1);
    expect(summary.referencedStopIds).toEqual(["S1"]);
  });

  it("RT参照IDと静的GTFSの整合を確認できる", () => {
    const staticFeed = importEntries(sampleEntries()).feed;
    const okSummary = validateRealtimeFeed(vehicleFeed(1_000, 34.76, 137.38)).summary;
    expect(checkRealtimeStaticCompatibility(staticFeed, okSummary).ok).toBe(true);

    const missingSummary = validateRealtimeFeed(
      rt.FeedMessage.encode(
        rt.FeedMessage.create({
          header: { gtfsRealtimeVersion: "2.0", incrementality: 0, timestamp: 1_000 },
          entity: [
            {
              id: "v-missing",
              vehicle: {
                vehicle: { id: "BUS-X" },
                trip: { tripId: "NO_TRIP", routeId: "NO_ROUTE" },
                position: { latitude: 34.76, longitude: 137.38 },
              },
            },
          ],
        }),
      ).finish(),
    ).summary;
    const report = checkRealtimeStaticCompatibility(staticFeed, missingSummary);
    expect(report.ok).toBe(false);
    expect(report.missing.tripIds).toEqual(["NO_TRIP"]);
    expect(report.missing.routeIds).toEqual(["NO_ROUTE"]);
  });

  it("ingest→serve で最新成功Feedを再配信し、鮮度SLO超過で stale", () => {
    const store = createRtRelayStore([
      { id: "src1", url: "http://example/vp.pb", feedType: "vehicle_positions", pollIntervalSec: 15 },
    ]);
    store.ingest("src1", vehicleFeed(1_000, 34.76, 137.38), 1_000, 200);

    // 取得直後は fresh
    const fresh = store.serve("src1", 1_030);
    expect(fresh.ok).toBe(true);
    expect(fresh.stale).toBe(false);
    expect(fresh.ageSec).toBe(30);
    expect(fresh.bytes).toBeInstanceOf(Uint8Array);

    // SLO(90s)超過で stale
    const stale = store.serve("src1", 1_000 + RT_FRESHNESS_SLO_SEC.vehicle_positions + 1);
    expect(stale.stale).toBe(true);
  });

  it("取得失敗を記録し、未取得sourceは stale で配信不可", () => {
    const store = createRtRelayStore([
      { id: "src1", url: "http://x", feedType: "trip_updates", pollIntervalSec: 30 },
    ]);
    const empty = store.serve("src1", 100);
    expect(empty.ok).toBe(false);
    expect(empty.stale).toBe(true);

    store.recordFailure("src1", "HTTP 504", 200, 504);
    store.recordFailure("src1", "timeout", 230);
    const m = store.metrics("src1")!;
    expect(m.consecutiveFailures).toBe(2);
    expect(m.lastError).toBe("timeout");

    // 成功後は連続失敗がリセットされる
    store.ingest("src1", vehicleFeed(300, 34.7, 137.3), 300);
    expect(store.metrics("src1")!.consecutiveFailures).toBe(0);
  });

  it("source CRUD と不正値の拒否", () => {
    const store = createRtRelayStore();
    store.upsertSource({ id: "s", url: "http://x", feedType: "mixed", pollIntervalSec: 20 });
    expect(store.sources()).toHaveLength(1);
    expect(() => store.upsertSource({ id: "s2", url: "http://x", feedType: "mixed", pollIntervalSec: 0 })).toThrow();
    expect(store.removeSource("s")).toBe(true);
    expect(store.sources()).toHaveLength(0);
  });
});
