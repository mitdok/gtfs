import { describe, expect, it } from "vitest";
import {
  buildServiceAlertsFeed,
  decodeRealtimeFeed,
  encodeServiceAlertsFeed,
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
});
