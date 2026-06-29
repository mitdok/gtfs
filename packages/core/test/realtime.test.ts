import { describe, expect, it } from "vitest";
import {
  buildServiceAlertsFeed,
  buildTripUpdatesFeed,
  buildVehiclePositionsFeed,
  createRealtimeAlertStore,
  createRealtimeTripUpdateStore,
  createRealtimeVehicleStore,
  decodeRealtimeFeed,
  encodeServiceAlertsFeed,
  encodeTripUpdatesFeed,
  encodeVehiclePositionsFeed,
  realtimeFeedToObject,
} from "../src/realtime.js";

describe("GTFS-RT ServiceAlerts", () => {
  it("Alert入力からFeedMessage protobufを生成してdecodeできる", () => {
    const bytes = encodeServiceAlertsFeed(
      [
        {
          id: "alert-20260616-1",
          activePeriods: [
            {
              start: "2026-06-16T09:00:00+09:00",
              end: "2026-06-16T18:00:00+09:00",
            },
          ],
          informedEntities: [{ routeId: "R1" }, { stopId: "S10" }],
          cause: "CONSTRUCTION",
          effect: "DETOUR",
          severityLevel: "WARNING",
          headerText: { ja: "工事による迂回運行", en: "Detour due to construction" },
          descriptionText: { ja: "市役所前停留所は終日休止します。" },
          url: { ja: "https://example.com/alerts/20260616" },
        },
      ],
      { timestamp: "2026-06-16T00:00:30Z", feedVersion: "rt-test-1" },
    );

    expect(bytes.length).toBeGreaterThan(0);
    const feed = decodeRealtimeFeed(bytes);
    expect(feed.header.gtfsRealtimeVersion).toBe("2.0");
    expect(Number(feed.header.timestamp)).toBe(1781568030);
    expect(feed.header.feedVersion).toBe("rt-test-1");
    expect(feed.entity).toHaveLength(1);
    expect(feed.entity[0]?.id).toBe("alert-20260616-1");
    expect(feed.entity[0]?.alert?.informedEntity).toHaveLength(2);
    expect(feed.entity[0]?.alert?.headerText?.translation?.map((t) => t.language)).toEqual([
      "ja",
      "en",
    ]);
  });

  it("trip向けinformed_entityも生成できる", () => {
    const feed = buildServiceAlertsFeed([
      {
        id: "trip-alert",
        informedEntities: [
          {
            tripId: "T1",
            routeIdForTrip: "R1",
            startDate: "20260616",
            startTime: "07:00:00",
          },
        ],
        effect: "SIGNIFICANT_DELAYS",
        headerText: { ja: "遅延が発生しています" },
      },
    ]);
    expect(feed.entity[0]?.alert?.informedEntity?.[0]?.trip?.tripId).toBe("T1");
    expect(feed.entity[0]?.alert?.effect).toBe(3);
  });

  it("debug用objectへ変換できる", () => {
    const bytes = encodeServiceAlertsFeed([
      {
        id: "alert-json",
        informedEntities: [{ agencyId: "toyo" }],
        cause: "OTHER_CAUSE",
        effect: "OTHER_EFFECT",
        headerText: { ja: "お知らせ" },
      },
    ]);
    const object = realtimeFeedToObject(decodeRealtimeFeed(bytes));
    expect(object.header).toMatchObject({ gtfsRealtimeVersion: "2.0" });
    expect(object.entity).toBeInstanceOf(Array);
  });

  it("対象entityがないAlertは拒否する", () => {
    expect(() =>
      encodeServiceAlertsFeed([
        {
          id: "bad",
          informedEntities: [],
          headerText: { ja: "不正" },
        },
      ]),
    ).toThrow(/informed entity/);
  });

  it("Alertストアで複数Alertを保持し、有効期間内のものだけFeed化できる", () => {
    const store = createRealtimeAlertStore();
    store.upsert(
      {
        id: "active-alert",
        activePeriods: [{ start: "2026-06-16T09:00:00+09:00", end: "2026-06-16T18:00:00+09:00" }],
        informedEntities: [{ routeId: "R1" }],
        effect: "DETOUR",
        headerText: { ja: "迂回運行" },
      },
      "2026-06-16T00:00:00Z",
    );
    store.upsert(
      {
        id: "expired-alert",
        activePeriods: [{ start: "2026-06-15T09:00:00+09:00", end: "2026-06-15T18:00:00+09:00" }],
        informedEntities: [{ routeId: "R2" }],
        effect: "NO_SERVICE",
        headerText: { ja: "運休" },
      },
      "2026-06-16T00:00:00Z",
    );

    expect(store.list()).toHaveLength(2);
    expect(store.listActive("2026-06-16T10:00:00+09:00").map((a) => a.id)).toEqual(["active-alert"]);
    const feed = decodeRealtimeFeed(
      store.encode({
        timestamp: "2026-06-16T10:00:00+09:00",
        activeAt: "2026-06-16T10:00:00+09:00",
      }),
    );
    expect(feed.entity.map((entity) => entity.id)).toEqual(["active-alert"]);
  });

  it("Alertストアは保存時に不正Alertを拒否する", () => {
    const store = createRealtimeAlertStore();
    expect(() =>
      store.upsert({
        id: "invalid",
        informedEntities: [],
        headerText: { ja: "不正" },
      }),
    ).toThrow(/informed entity/);
    expect(store.list()).toHaveLength(0);
  });
});

describe("GTFS-RT VehiclePositions", () => {
  it("車両位置入力からFeedMessage protobufを生成してdecodeできる", () => {
    const bytes = encodeVehiclePositionsFeed(
      [
        {
          id: "veh-entity-1",
          vehicleId: "bus-101",
          label: "101号車",
          latitude: 34.7691,
          longitude: 137.3916,
          bearing: 120,
          speed: 8.5,
          timestamp: "2026-06-16T00:00:45Z",
          tripId: "T1",
          routeId: "R1",
        },
      ],
      { timestamp: "2026-06-16T00:01:00Z", feedVersion: "vp-test-1" },
    );

    const feed = decodeRealtimeFeed(bytes);
    expect(feed.header.gtfsRealtimeVersion).toBe("2.0");
    expect(feed.header.feedVersion).toBe("vp-test-1");
    expect(feed.entity[0]?.vehicle?.vehicle?.id).toBe("bus-101");
    expect(feed.entity[0]?.vehicle?.trip?.tripId).toBe("T1");
    expect(feed.entity[0]?.vehicle?.position?.latitude).toBeCloseTo(34.7691);
    expect(Number(feed.entity[0]?.vehicle?.timestamp)).toBe(1781568045);
  });

  it("車両ID・座標・方位の不正値を拒否する", () => {
    expect(() =>
      buildVehiclePositionsFeed([
        { id: "bad", vehicleId: "", latitude: 34.7, longitude: 137.3 },
      ]),
    ).toThrow(/vehicleId/);
    expect(() =>
      buildVehiclePositionsFeed([
        { id: "bad", vehicleId: "v1", latitude: 0, longitude: 0 },
      ]),
    ).toThrow(/latitude\/longitude/);
    expect(() =>
      buildVehiclePositionsFeed([
        { id: "bad", vehicleId: "v1", latitude: 34.7, longitude: 137.3, bearing: 361 },
      ]),
    ).toThrow(/bearing/);
  });

  it("VehiclePositionストアで最新位置を保持しFeed化できる", () => {
    const store = createRealtimeVehicleStore();
    store.upsert(
      {
        id: "veh-1",
        vehicleId: "bus-1",
        latitude: 34.7691,
        longitude: 137.3916,
        timestamp: "2026-06-16T00:00:30Z",
        routeId: "R1",
      },
      "2026-06-16T00:00:40Z",
    );
    store.upsert(
      {
        id: "veh-2",
        vehicleId: "bus-2",
        latitude: 34.76,
        longitude: 137.38,
      },
      "2026-06-16T00:01:00Z",
    );

    expect(store.list().map((v) => v.id)).toEqual(["veh-1", "veh-2"]);
    expect(store.get("veh-1")?.updatedAt).toBe("2026-06-16T00:00:30.000Z");
    const feed = decodeRealtimeFeed(store.encode({ timestamp: "2026-06-16T00:01:00Z" }));
    expect(feed.entity.map((entity) => entity.vehicle?.vehicle?.id)).toEqual(["bus-1", "bus-2"]);
  });
});

describe("GTFS-RT TripUpdates", () => {
  it("TripUpdate入力からFeedMessage protobufを生成してdecodeできる", () => {
    const bytes = encodeTripUpdatesFeed(
      [
        {
          id: "tu-entity-1",
          tripId: "T1",
          routeId: "R1",
          startDate: "20260616",
          vehicleId: "bus-101",
          timestamp: "2026-06-16T00:01:00Z",
          stopTimeUpdates: [
            { stopSequence: 1, stopId: "S1", departureDelay: 60 },
            { stopSequence: 2, stopId: "S2", arrivalTime: "2026-06-16T00:06:00Z" },
          ],
        },
      ],
      { timestamp: "2026-06-16T00:01:10Z", feedVersion: "tu-test-1" },
    );

    const feed = decodeRealtimeFeed(bytes);
    expect(feed.header.gtfsRealtimeVersion).toBe("2.0");
    expect(feed.header.feedVersion).toBe("tu-test-1");
    expect(feed.entity[0]?.tripUpdate?.trip?.tripId).toBe("T1");
    expect(feed.entity[0]?.tripUpdate?.vehicle?.id).toBe("bus-101");
    expect(feed.entity[0]?.tripUpdate?.stopTimeUpdate?.[0]?.departure?.delay).toBe(60);
    expect(Number(feed.entity[0]?.tripUpdate?.stopTimeUpdate?.[1]?.arrival?.time)).toBe(1781568360);
    expect(Number(feed.entity[0]?.tripUpdate?.timestamp)).toBe(1781568060);
  });

  it("trip_id と stop_time_update の不正値を拒否する", () => {
    expect(() =>
      buildTripUpdatesFeed([{ id: "bad", tripId: "", stopTimeUpdates: [{ stopSequence: 1 }] }]),
    ).toThrow(/tripId/);
    expect(() => buildTripUpdatesFeed([{ id: "bad", tripId: "T1", stopTimeUpdates: [] }])).toThrow(
      /stopTimeUpdate/,
    );
    expect(() =>
      buildTripUpdatesFeed([{ id: "bad", tripId: "T1", stopTimeUpdates: [{ stopSequence: 0 }] }]),
    ).toThrow(/stopSequence/);
    expect(() =>
      buildTripUpdatesFeed([{ id: "bad", tripId: "T1", stopTimeUpdates: [{ departureDelay: 30 }] }]),
    ).toThrow(/stopSequence or stopId/);
  });

  it("TripUpdateストアで最新遅延を保持しFeed化できる", () => {
    const store = createRealtimeTripUpdateStore();
    store.upsert(
      {
        id: "tu-1",
        tripId: "T1",
        routeId: "R1",
        timestamp: "2026-06-16T00:01:00Z",
        stopTimeUpdates: [{ stopSequence: 1, stopId: "S1", departureDelay: 90 }],
      },
      "2026-06-16T00:01:10Z",
    );
    store.upsert(
      {
        id: "tu-2",
        tripId: "T2",
        routeId: "R1",
        stopTimeUpdates: [{ stopSequence: 1, stopId: "S1", scheduleRelationship: "SKIPPED" }],
      },
      "2026-06-16T00:02:00Z",
    );

    expect(store.list().map((update) => update.id)).toEqual(["tu-1", "tu-2"]);
    expect(store.get("tu-1")?.updatedAt).toBe("2026-06-16T00:01:00.000Z");
    const feed = decodeRealtimeFeed(store.encode({ timestamp: "2026-06-16T00:02:00Z" }));
    expect(feed.entity.map((entity) => entity.tripUpdate?.trip?.tripId)).toEqual(["T1", "T2"]);
    expect(feed.entity[1]?.tripUpdate?.stopTimeUpdate?.[0]?.scheduleRelationship).toBe(1);
  });
});
