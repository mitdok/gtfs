/**
 * GTFS zip の取込: zip バイト列 → 内部フィードモデル。
 * - 文字コードは UTF-8 / Shift_JIS を自動判定し、内部は UTF-8 へ正規化（仕様 02 章 F-2-5）。
 *   `options.encoding` で明示指定も可能。
 * - zip 直下の *.txt を対象（サブフォルダ内も拡張子一致で拾う）。
 */
import { unzipSync } from "fflate";
import { parseCsv } from "./csv.js";
import { decodeText, type GtfsEncoding } from "./encoding.js";
import { createFeed, setTable, type Feed } from "./model.js";

export interface ImportOptions {
  /** 文字コードを明示指定する。未指定時は UTF-8/Shift_JIS を自動判定。 */
  encoding?: GtfsEncoding;
}

export interface ImportResult {
  feed: Feed;
  /** 取り込んだファイル名（拡張子なし）一覧 */
  importedFiles: string[];
  /** 警告（解析時の軽微な問題） */
  warnings: string[];
}

/** zip バイト列から取込。 */
export function importGtfsZip(zip: Uint8Array, options: ImportOptions = {}): ImportResult {
  const entries = unzipSync(zip);
  return importEntries(entries, options);
}

/** ファイル名→バイト列 のマップから取込（テスト/再利用用）。 */
export function importEntries(
  entries: Record<string, Uint8Array>,
  options: ImportOptions = {},
): ImportResult {
  const feed = createFeed();
  const importedFiles: string[] = [];
  const warnings: string[] = [];

  for (const [path, bytes] of Object.entries(entries)) {
    if (!path.toLowerCase().endsWith(".txt")) continue;
    // ディレクトリエントリ等を除外
    if (bytes.length === 0 && path.endsWith("/")) continue;

    const base = baseName(path);
    const decoded = decodeText(bytes, options.encoding);
    if (decoded.encoding === "shift_jis") {
      warnings.push(`${path}: Shift_JIS と判定し UTF-8 へ変換しました`);
    }
    const { columns, rows } = parseCsv(decoded.text);
    if (columns.length === 0) {
      warnings.push(`${path}: 空ファイルのためスキップ`);
      continue;
    }
    if (feed.tables.has(base)) {
      warnings.push(`${path}: テーブル "${base}" が重複。後勝ちで上書き`);
    }
    setTable(feed, base, rows, columns);
    importedFiles.push(base);
  }

  return { feed, importedFiles, warnings };
}

/** "path/to/stops.txt" -> "stops" */
function baseName(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.txt$/i, "");
}
