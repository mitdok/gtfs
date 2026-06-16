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

describe("stop_times の追加検証", () => {
  it("trip 内で stop_sequence が重複したら検出する", () => {
    const feed = feedFrom(SAMPLE_FILES);
    const cols = feed.tables.get("stop_times")!.columns;
    const rows = getRows(feed, "stop_times").map((r) => ({ ...r }));
    // T1 の3行目の stop_sequence を 2 にして重複させる
    rows[2]!.stop_sequence = "2";
    setTable(feed, "stop_times", rows, cols);
    const report = validateFeed(feed);
    expect(report.issues.some((i) => i.code === "duplicate_stop_sequence")).toBe(true);
  });

  it("次停留所の到着が直前停留所の発車より前なら検出する（停車時間考慮）", () => {
    const feed = feedFrom(SAMPLE_FILES);
    const cols = feed.tables.get("stop_times")!.columns;
    const rows = getRows(feed, "stop_times").map((r) => ({ ...r }));
    // T1 seq1: 到着07:00 / 発車07:10、seq2 到着07:05（発車より前）
    rows[0]!.arrival_time = "07:00:00";
    rows[0]!.departure_time = "07:10:00";
    rows[1]!.arrival_time = "07:05:00";
    rows[1]!.departure_time = "07:06:00";
    setTable(feed, "stop_times", rows, cols);
    const report = validateFeed(feed);
    expect(report.issues.some((i) => i.code === "stop_time_decreasing")).toBe(true);
  });
});

describe("推奨ファイル検証（gtfs-jp-v4）", () => {
  it("attributions/transfers がなければ warning を出す", () => {
    const report = validateFeed(feedFrom(SAMPLE_FILES), { profileId: "gtfs-jp-v4" });
    const recs = report.issues.filter((i) => i.code === "missing_recommended_file");
    const ids = recs.map((i) => i.entity?.id);
    expect(ids).toContain("attributions");
    expect(ids).toContain("transfers");
    expect(recs.every((i) => i.severity === "warning")).toBe(true);
  });

  it("gtfs-base では推奨ファイル warning を出さない", () => {
    const { feed } = importEntries(sampleEntries());
    const report = validateFeed(feed);
    expect(report.issues.some((i) => i.code === "missing_recommended_file")).toBe(false);
  });
});
