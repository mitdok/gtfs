import { describe, it, expect } from "vitest";
import { importEntries } from "../src/importer.js";
import { validateFeed } from "../src/validator.js";
import { setTable, getRows } from "../src/model.js";
import { migrateToGtfsJpV4 } from "../src/migration.js";
import { sampleEntries, SAMPLE_FILES } from "./fixtures.js";
import { strToU8 } from "fflate";

function feedFrom(files: Record<string, string>) {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, text] of Object.entries(files)) entries[name] = strToU8(text);
  return importEntries(entries).feed;
}

describe("validateFeed", () => {
  it("正常フィードはエラー0", () => {
    const { feed } = importEntries(sampleEntries());
    const report = validateFeed(feed);
    expect(report.summary.errors).toBe(0);
  });

  it("必須ファイル欠落を検出する", () => {
    const files = { ...SAMPLE_FILES };
    delete files["stops.txt"];
    const report = validateFeed(feedFrom(files));
    expect(report.issues.some((i) => i.code === "missing_required_file")).toBe(true);
  });

  it("参照切れ（stop_times.stop_id）を検出する", () => {
    const feed = feedFrom(SAMPLE_FILES);
    const rows = getRows(feed, "stop_times").map((r) => ({ ...r }));
    rows[0]!.stop_id = "NOPE";
    setTable(feed, "stop_times", rows, feed.tables.get("stop_times")!.columns);
    const report = validateFeed(feed);
    expect(report.issues.some((i) => i.code === "dangling_reference")).toBe(true);
  });

  it("時刻の逆転を検出する", () => {
    const feed = feedFrom(SAMPLE_FILES);
    const cols = feed.tables.get("stop_times")!.columns;
    const rows = getRows(feed, "stop_times").map((r) => ({ ...r }));
    // T1 の2番目を1番目より前の時刻にする
    rows[1]!.arrival_time = "06:50:00";
    rows[1]!.departure_time = "06:50:00";
    setTable(feed, "stop_times", rows, cols);
    const report = validateFeed(feed);
    expect(report.issues.some((i) => i.code === "stop_time_decreasing")).toBe(true);
  });

  it("不正な座標を検出する", () => {
    const feed = feedFrom(SAMPLE_FILES);
    const cols = feed.tables.get("stops")!.columns;
    const rows = getRows(feed, "stops").map((r) => ({ ...r }));
    rows[0]!.stop_lat = "999";
    setTable(feed, "stops", rows, cols);
    const report = validateFeed(feed);
    expect(report.issues.some((i) => i.code === "invalid_stop_lat")).toBe(true);
  });

  it("ID重複を検出する", () => {
    const feed = feedFrom(SAMPLE_FILES);
    const cols = feed.tables.get("stops")!.columns;
    const rows = getRows(feed, "stops").map((r) => ({ ...r }));
    rows[1]!.stop_id = "S1"; // S1 を重複させる
    setTable(feed, "stops", rows, cols);
    const report = validateFeed(feed);
    expect(report.issues.some((i) => i.code === "duplicate_id")).toBe(true);
  });

  it("GTFS-JP v4 は公式v4必須ファイル不足を検出する", () => {
    const report = validateFeed(feedFrom(SAMPLE_FILES), { profileId: "gtfs-jp-v4" });
    expect(report.issues.some((i) => i.code === "missing_required_file" && i.entity?.id === "fare_attributes")).toBe(true);
    expect(report.issues.some((i) => i.code === "missing_required_file" && i.entity?.id === "translations")).toBe(true);
  });

  it("最小GTFSをGTFS-JP v4候補へ移行できる", () => {
    const migrated = migrateToGtfsJpV4(feedFrom(SAMPLE_FILES));
    const report = validateFeed(migrated.feed, { profileId: "gtfs-jp-v4" });
    expect(report.summary.errors).toBe(0);
    expect(getRows(migrated.feed, "fare_attributes")).toHaveLength(1);
    expect(getRows(migrated.feed, "translations")).toHaveLength(3);
    expect(migrated.warnings.some((w) => w.code === "created_free_fare")).toBe(true);
  });

  it("GTFS-JP v4 ではv3由来のjp拡張ファイルを警告する", () => {
    const feed = feedFrom({
      ...SAMPLE_FILES,
      "agency_jp.txt": "agency_id,agency_official_name\ntoyo,テスト交通株式会社\n",
    });
    const migrated = migrateToGtfsJpV4(feed, { dropLegacyJpFiles: false });
    const report = validateFeed(migrated.feed, { profileId: "gtfs-jp-v4" });
    expect(report.issues.some((i) => i.code === "legacy_jp_file")).toBe(true);
  });
});
