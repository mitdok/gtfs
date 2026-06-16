import { describe, it, expect } from "vitest";
import { strToU8 } from "fflate";
import { decodeText } from "../src/encoding.js";
import { importEntries } from "../src/importer.js";
import { getRows } from "../src/model.js";

/** ASCII 文字列をバイト配列へ（Shift_JIS でも ASCII 部は1バイトで同一）。 */
function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

// Shift_JIS のバイト列。東京=93 8C 8B 9E。ASCII 部と連結して SJIS の CSV を作る。
const TOKYO_SJIS = [0x93, 0x8c, 0x8b, 0x9e];

function sjisStopsCsv(): Uint8Array {
  return new Uint8Array([
    ...ascii("stop_id,stop_name,stop_lat,stop_lon\nS1,"),
    ...TOKYO_SJIS,
    ...ascii(",35.68,139.76\n"),
  ]);
}

describe("decodeText", () => {
  it("UTF-8 を自動判定する", () => {
    const r = decodeText(strToU8("駅前,35.68"));
    expect(r.encoding).toBe("utf-8");
    expect(r.text).toBe("駅前,35.68");
  });

  it("Shift_JIS を自動判定して UTF-8 文字列へ変換する", () => {
    const r = decodeText(new Uint8Array(TOKYO_SJIS));
    expect(r.encoding).toBe("shift_jis");
    expect(r.text).toBe("東京");
  });

  it("UTF-8 BOM 付きを UTF-8 と判定し BOM を除去する", () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...ascii("a,b")]);
    const r = decodeText(bom);
    expect(r.encoding).toBe("utf-8");
    expect(r.text).toBe("a,b");
  });

  it("forced 指定を尊重する", () => {
    const r = decodeText(new Uint8Array(TOKYO_SJIS), "shift_jis");
    expect(r.detected).toBe(false);
    expect(r.text).toBe("東京");
  });
});

describe("importEntries の文字コード対応", () => {
  it("Shift_JIS の stops.txt を取り込み、日本語を正しく復元する", () => {
    const result = importEntries({ "stops.txt": sjisStopsCsv() });
    const stops = getRows(result.feed, "stops");
    expect(stops[0]!.stop_name).toBe("東京");
    expect(result.warnings.some((w) => w.includes("Shift_JIS"))).toBe(true);
  });

  it("UTF-8 ファイルでは Shift_JIS 警告を出さない", () => {
    const result = importEntries({
      "stops.txt": strToU8("stop_id,stop_name,stop_lat,stop_lon\nS1,東京,35.68,139.76\n"),
    });
    expect(getRows(result.feed, "stops")[0]!.stop_name).toBe("東京");
    expect(result.warnings.some((w) => w.includes("Shift_JIS"))).toBe(false);
  });
});
