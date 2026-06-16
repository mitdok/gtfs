import { describe, it, expect } from "vitest";
import { importEntries } from "../src/importer.js";
import { migrateToGtfsJpV4 } from "../src/migration.js";
import { exportToZip } from "../src/exporter.js";
import { getRows } from "../src/model.js";
import { SAMPLE_FILES } from "./fixtures.js";
import { strToU8 } from "fflate";

function feedFrom(files: Record<string, string>) {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, text] of Object.entries(files)) entries[name] = strToU8(text);
  return importEntries(entries).feed;
}

describe("v3→v4 移行", () => {
  it("既存 translations の追加列（field_value 等）を欠落させない", () => {
    const files = {
      ...SAMPLE_FILES,
      "translations.txt": [
        "table_name,field_name,language,translation,field_value",
        "agency,agency_name,en,Test Transit,テスト交通",
        "",
      ].join("\n"),
    };
    const migrated = migrateToGtfsJpV4(feedFrom(files));
    const table = migrated.feed.tables.get("translations")!;
    // 既存の field_value 列が保持されている
    expect(table.columns).toContain("field_value");
    const enRow = table.rows.find((r) => r["language"] === "en");
    expect(enRow?.["field_value"]).toBe("テスト交通");
    // 読み仮名（ja-Hrkt）行は追加されている
    expect(table.rows.some((r) => r["language"] === "ja-Hrkt")).toBe(true);
  });

  it("stop_name_kana 列があれば ja-Hrkt 読み仮名として取り込む", () => {
    const files = {
      ...SAMPLE_FILES,
      "stops.txt": [
        "stop_id,stop_name,stop_name_kana,stop_lat,stop_lon",
        "S1,駅前,エキマエ,34.769100,137.391600",
        "S2,市役所前,シヤクシヨマエ,34.766000,137.385000",
        "S3,中央病院,チユウオウビヨウイン,34.760000,137.380000",
        "",
      ].join("\n"),
    };
    const migrated = migrateToGtfsJpV4(feedFrom(files));
    const kana = getRows(migrated.feed, "translations").find(
      (r) => r["record_id"] === "S1" && r["language"] === "ja-Hrkt",
    );
    expect(kana?.["translation"]).toBe("エキマエ");
    // 実際の読み仮名が取れたので fallback 警告は出ない
    expect(migrated.warnings.some((w) => w.code === "fallback_stop_kana")).toBe(false);
  });

  it("referenceDate 指定で出力が決定的になる", () => {
    // calendar から日付が導けるサンプルでも、明示指定で決定性を担保できることを確認
    const a = migrateToGtfsJpV4(feedFrom(SAMPLE_FILES), { referenceDate: "20260601" });
    const b = migrateToGtfsJpV4(feedFrom(SAMPLE_FILES), { referenceDate: "20260601" });
    const za = exportToZip(a.feed);
    const zb = exportToZip(b.feed);
    expect(Buffer.from(za).equals(Buffer.from(zb))).toBe(true);
  });

  it("calendar が無くても referenceDate から feed_info を作れる", () => {
    const files = { ...SAMPLE_FILES };
    delete (files as Record<string, string>)["calendar.txt"];
    delete (files as Record<string, string>)["feed_info.txt"];
    const migrated = migrateToGtfsJpV4(feedFrom(files), { referenceDate: "20260601" });
    const feedInfo = getRows(migrated.feed, "feed_info")[0]!;
    expect(feedInfo["feed_start_date"]).toBe("20260601");
    expect(feedInfo["feed_end_date"]).toBe("20260601");
  });
});
