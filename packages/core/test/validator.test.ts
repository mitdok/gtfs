import { describe, it, expect } from "vitest";
import { importEntries } from "../src/importer.js";
import { validateFeed } from "../src/validator.js";
import { setTable, getRows } from "../src/model.js";
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

  it("GTFS-JP v4 の必須ファイルと読み仮名を検出する", () => {
    const report = validateFeed(feedFrom(SAMPLE_FILES), { profileId: "gtfs-jp-v4" });
    expect(
      report.issues.some((i) => i.code === "missing_required_file" && i.entity?.id === "translations"),
    ).toBe(true);
    expect(
      report.issues.some((i) => i.code === "missing_required_file" && i.entity?.id === "fare_attributes"),
    ).toBe(true);
    expect(
      report.issues.some((i) => i.code === "missing_required_field" && i.entity?.id === "feed_info.feed_version"),
    ).toBe(true);
  });

  it("GTFS-JP v4 の型・期間・翻訳ルールを検出する", () => {
    const files = {
      ...SAMPLE_FILES,
      "feed_info.txt": [
        "feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version",
        "テスト,https://example.com,en,20260401,20260405,20260401",
        "",
      ].join("\n"),
      "fare_attributes.txt": [
        "fare_id,price,currency_type,payment_method",
        "F1,-1,JPY,0",
        "",
      ].join("\n"),
      "translations.txt": [
        "table_name,field_name,language,translation,record_id",
        "stops,stop_name,en,Station,S1",
        "",
      ].join("\n"),
    };
    const report = validateFeed(feedFrom(files), { profileId: "gtfs-jp-v4" });
    expect(report.issues.some((i) => i.code === "jp_feed_lang_should_be_ja")).toBe(true);
    expect(report.issues.some((i) => i.code === "feed_period_too_short")).toBe(true);
    expect(report.issues.some((i) => i.code === "missing_japanese_kana_translation")).toBe(true);
    expect(report.issues.some((i) => i.code === "negative_fare_price")).toBe(true);
  });
});
