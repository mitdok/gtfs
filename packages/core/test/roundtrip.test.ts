import { describe, it, expect } from "vitest";
import { importEntries, importGtfsZip } from "../src/importer.js";
import { exportToFiles, exportToZip } from "../src/exporter.js";
import { getRows } from "../src/model.js";
import { parseCsv } from "../src/csv.js";
import { sampleEntries } from "./fixtures.js";

describe("import → export ラウンドトリップ", () => {
  it("取り込んだ全テーブル・行を保持する", () => {
    const { feed, importedFiles } = importEntries(sampleEntries());
    expect(importedFiles.sort()).toEqual(
      ["agency", "calendar", "feed_info", "routes", "stop_times", "stops", "trips"].sort(),
    );
    expect(getRows(feed, "stops")).toHaveLength(3);
    expect(getRows(feed, "stop_times")).toHaveLength(6);
  });

  it("出力ファイルを再パースすると同じ内容になる", () => {
    const { feed } = importEntries(sampleEntries());
    const files = exportToFiles(feed);
    const reparsed = parseCsv(files["stops.txt"]!);
    expect(reparsed.columns).toEqual(["stop_id", "stop_name", "stop_lat", "stop_lon"]);
    expect(reparsed.rows[0]).toEqual({
      stop_id: "S1",
      stop_name: "駅前",
      stop_lat: "34.769100",
      stop_lon: "137.391600",
    });
  });

  it("zip 出力 → 再取込でデータが一致する", () => {
    const { feed } = importEntries(sampleEntries());
    const zip = exportToZip(feed);
    const reimported = importGtfsZip(zip);
    expect(getRows(reimported.feed, "stop_times")).toEqual(getRows(feed, "stop_times"));
  });

  it("zip 出力は決定的（同一入力→同一バイト列）", () => {
    const { feed } = importEntries(sampleEntries());
    const a = exportToZip(feed);
    const b = exportToZip(feed);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
