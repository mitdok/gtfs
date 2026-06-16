import { describe, expect, it } from "vitest";
import { createGtfsJpV4StarterFeed } from "../src/starter-feed.js";
import { exportToFiles } from "../src/exporter.js";
import { getRows } from "../src/model.js";
import { validateFeed } from "../src/validator.js";

describe("GTFS-JP v4 starter feed", () => {
  it("新規作成用の最小v4フィードを生成できる", () => {
    const feed = createGtfsJpV4StarterFeed({
      agencyName: "テスト交通",
      agencyUrl: "https://example.com",
      routeLongName: "テスト線",
      feedStartDate: "20260401",
      feedEndDate: "20261231",
      stops: [
        { stopName: "駅前", stopNameKana: "エキマエ", stopLat: "34.769100", stopLon: "137.391600" },
        { stopName: "市役所前", stopNameKana: "シヤクショマエ", stopLat: "34.766000", stopLon: "137.385000" },
      ],
    });

    expect(getRows(feed, "agency")).toHaveLength(1);
    expect(getRows(feed, "stops")).toHaveLength(2);
    expect(getRows(feed, "trips")).toHaveLength(1);
    expect(getRows(feed, "stop_times")).toHaveLength(2);
    expect(getRows(feed, "fare_attributes")).toHaveLength(1);
    expect(getRows(feed, "translations")).toHaveLength(2);
    expect(validateFeed(feed, { profileId: "gtfs-jp-v4" }).summary.errors).toBe(0);
    expect(exportToFiles(feed, { profileId: "gtfs-jp-v4" })["agency.txt"]).toBeDefined();
  });

  it("停留所が2件未満なら拒否する", () => {
    expect(() =>
      createGtfsJpV4StarterFeed({
        agencyName: "テスト交通",
        agencyUrl: "https://example.com",
        routeLongName: "テスト線",
        feedStartDate: "20260401",
        feedEndDate: "20261231",
        stops: [{ stopName: "駅前", stopLat: "34.769100", stopLon: "137.391600" }],
      }),
    ).toThrow(/at least two stops/);
  });
});
