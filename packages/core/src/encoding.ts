/**
 * 取込時の文字コード判定（UTF-8 / Shift_JIS）。
 *
 * GTFS-JP v4 は UTF-8 を標準とするが、旧・西沢ツールや v3 系の実フィード・CSV には
 * Shift_JIS が残っている（仕様 02 章 F-2-5「文字コードの自動判定」）。
 * 内部・出力は常に UTF-8 のため、取込時にここで UTF-8 へ正規化する。
 *
 * 依存を増やさず、ブラウザでも Node でも使える `TextDecoder` のみで実装する。
 * 判定方針:
 *   1. UTF-8 BOM があれば UTF-8 確定。
 *   2. それ以外は UTF-8 として厳格デコード（fatal）を試し、成功すれば UTF-8。
 *   3. 失敗したら Shift_JIS とみなす。
 * 日本語は SJIS バイト列が UTF-8 として妥当になることがほぼ無いため、この順で安全に切り分く。
 */

export type GtfsEncoding = "utf-8" | "shift_jis";

export interface DecodeResult {
  text: string;
  encoding: GtfsEncoding;
  /** 自動判定の結果か（false は forced 指定） */
  detected: boolean;
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

/** 指定エンコーディングで UTF-16 文字列へ。`TextDecoder` は既定で BOM を除去する。 */
function decodeWith(bytes: Uint8Array, encoding: GtfsEncoding): string {
  return new TextDecoder(encoding).decode(bytes);
}

/**
 * バイト列を UTF-8 文字列へデコードする。`forced` 未指定時は UTF-8/Shift_JIS を自動判定する。
 */
export function decodeText(bytes: Uint8Array, forced?: GtfsEncoding): DecodeResult {
  if (forced) {
    return { text: decodeWith(bytes, forced), encoding: forced, detected: false };
  }
  if (hasUtf8Bom(bytes)) {
    return { text: decodeWith(bytes, "utf-8"), encoding: "utf-8", detected: true };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text, encoding: "utf-8", detected: true };
  } catch {
    return { text: decodeWith(bytes, "shift_jis"), encoding: "shift_jis", detected: true };
  }
}
