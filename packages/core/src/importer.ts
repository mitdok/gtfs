/**
 * GTFS zip の取込: zip バイト列 → 内部フィードモデル。
 * - UTF-8 / Shift_JIS（BOM/コード）の差はまず UTF-8 を前提（Shift_JIS 対応は後続）。
 * - *.txt は CSV テーブル化し、v4 の locations.geojson 等は rawFiles として保持する。
 */
import { unzipSync, strFromU8 } from "fflate";
import { parseCsv } from "./csv.js";
import { createFeed, setTable, type Feed } from "./model.js";

export interface ImportResult {
  feed: Feed;
  /** 取り込んだファイル名（拡張子なし）一覧 */
  importedFiles: string[];
  /** 警告（解析時の軽微な問題） */
  warnings: string[];
}

/** zip バイト列から取込。 */
export function importGtfsZip(zip: Uint8Array): ImportResult {
  const entries = unzipSync(zip);
  return importEntries(entries);
}

/** ファイル名→バイト列 のマップから取込（テスト/再利用用）。 */
export function importEntries(entries: Record<string, Uint8Array>): ImportResult {
  const feed = createFeed();
  const importedFiles: string[] = [];
  const warnings: string[] = [];

  for (const [path, bytes] of Object.entries(entries)) {
    // ディレクトリエントリ等を除外
    if (bytes.length === 0 && path.endsWith("/")) continue;
    if (!path.toLowerCase().endsWith(".txt")) {
      if (path.toLowerCase().endsWith(".geojson") || path.toLowerCase().endsWith(".json")) {
        feed.rawFiles.set(path, bytes);
        importedFiles.push(path);
      }
      continue;
    }

    const base = baseName(path);
    const text = strFromU8(bytes);
    const { columns, rows } = parseCsv(text);
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
