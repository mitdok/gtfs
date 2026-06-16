import { describe, it, expect } from "vitest";
import { importEntries } from "../src/importer.js";
import { applyExportProfile } from "../src/export-profile.js";
import { exportToFiles } from "../src/exporter.js";
import { SAMPLE_FILES } from "./fixtures.js";
import { strToU8 } from "fflate";

function feedFrom(files: Record<string, string>) {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, text] of Object.entries(files)) entries[name] = strToU8(text);
  return importEntries(entries).feed;
}

describe("出力プロファイル準拠フィルタ", () => {
  it("gtfs-jp-v4 出力で legacy *_jp.txt を除外する", () => {
    const files = {
      ...SAMPLE_FILES,
      "agency_jp.txt": ["agency_id,agency_official_name", "toyo,テスト交通株式会社", ""].join("\n"),
      "routes_jp.txt": ["route_id,route_update_date", "R1,20260401", ""].join("\n"),
    };
    const { feed, removed } = applyExportProfile(feedFrom(files), "gtfs-jp-v4");
    expect(feed.tables.has("agency_jp")).toBe(false);
    expect(feed.tables.has("routes_jp")).toBe(false);
    expect(feed.tables.has("agency")).toBe(true);
    expect(removed.map((r) => r.name).sort()).toEqual(["agency_jp", "routes_jp"]);
    // 実出力にも残らない
    const out = exportToFiles(feed);
    expect(out["agency_jp.txt"]).toBeUndefined();
    expect(out["agency.txt"]).toBeDefined();
  });

  it("exporter の profileId オプションでフィルタを適用する", () => {
    const src = feedFrom({
      ...SAMPLE_FILES,
      "agency_jp.txt": ["agency_id,agency_official_name", "toyo,テスト交通株式会社", ""].join("\n"),
      "transfers.txt": "from_stop_id,to_stop_id,transfer_type\n",
    });
    const out = exportToFiles(src, { profileId: "gtfs-jp-v4" });
    expect(out["agency_jp.txt"]).toBeUndefined();
    expect(out["transfers.txt"]).toBeUndefined();
    expect(out["agency.txt"]).toBeDefined();
  });

  it("gtfs-jp-v3-legacy では *_jp.txt を保持する", () => {
    const files = {
      ...SAMPLE_FILES,
      "agency_jp.txt": ["agency_id,agency_official_name", "toyo,テスト交通株式会社", ""].join("\n"),
    };
    const { feed, removed } = applyExportProfile(feedFrom(files), "gtfs-jp-v3-legacy");
    expect(feed.tables.has("agency_jp")).toBe(true);
    expect(removed).toHaveLength(0);
  });

  it("空の任意ファイルを省略する（必須ファイルは空でも残す）", () => {
    const files = {
      ...SAMPLE_FILES,
      // 任意ファイルだがヘッダのみ（0 行）
      "transfers.txt": "from_stop_id,to_stop_id,transfer_type\n",
      // 必須ファイルがヘッダのみ（0 行）でも省略しない
      "feed_info.txt": "feed_publisher_name,feed_publisher_url,feed_lang\n",
    };
    const { feed, removed } = applyExportProfile(feedFrom(files), "gtfs-jp-v4");
    expect(feed.tables.has("transfers")).toBe(false);
    expect(removed.some((r) => r.name === "transfers")).toBe(true);
    // feed_info は gtfs-jp-v4 で必須 → 空でも残す（検証側で empty_required_file を出す）
    expect(feed.tables.has("feed_info")).toBe(true);
  });

  it("入力 Feed を破壊しない", () => {
    const files = {
      ...SAMPLE_FILES,
      "agency_jp.txt": ["agency_id", "toyo", ""].join("\n"),
    };
    const src = feedFrom(files);
    applyExportProfile(src, "gtfs-jp-v4");
    expect(src.tables.has("agency_jp")).toBe(true);
  });
});
