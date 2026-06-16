/**
 * 内部フィードモデル → GTFS zip バイト列。
 * 仕様書 6.4: UTF-8(BOMなし)・LF・RFC4180。生成は決定的（同一データ→同一バイト列）。
 *
 * 決定性のため:
 * - ファイルはテーブル名の昇順で格納
 * - 各ファイルの列順・行順は内部モデルの保持順をそのまま使う
 * - zip のタイムスタンプ等は固定（mtime=0）
 */
import { zipSync, strToU8 } from "fflate";
import { writeCsv } from "./csv.js";
import type { Feed } from "./model.js";

export interface ExportOptions {
  /** 出力するファイルを限定する場合に指定（拡張子なし名）。既定は全テーブル。 */
  only?: string[];
}

/** 各 .txt の文字列を生成（テスト/プレビュー用）。 */
export function exportToFiles(feed: Feed, options: ExportOptions = {}): Record<string, string> {
  const names = [...feed.tables.keys()]
    .filter((n) => !options.only || options.only.includes(n))
    .sort();
  const out: Record<string, string> = {};
  for (const name of names) {
    const table = feed.tables.get(name)!;
    out[`${name}.txt`] = writeCsv(table.columns, table.rows);
  }
  return out;
}

/** GTFS zip バイト列を生成。 */
export function exportToZip(feed: Feed, options: ExportOptions = {}): Uint8Array {
  const files = exportToFiles(feed, options);
  const entries: Record<string, Uint8Array> = {};
  // キー昇順で投入（決定性）
  for (const name of Object.keys(files).sort()) {
    entries[name] = strToU8(files[name]!);
  }
  // 決定性のため mtime を固定。ZIP の有効範囲は 1980-2099 のため 1980-01-01 を使う。
  const FIXED_MTIME = Date.UTC(1980, 0, 1);
  return zipSync(entries, { level: 6, mtime: FIXED_MTIME });
}
