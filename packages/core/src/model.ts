/**
 * 内部フィードモデル。
 *
 * MVP では取込/再出力の忠実性（ロスレス）を最優先するため、GTFS の各ファイルを
 * 「列順を保持した行配列」として保持する。これにより取込→出力のラウンドトリップで
 * 列・行の欠落や並び替えが起きない。
 *
 * 仕様書 03 章の「パターン中心モデル（編集用の正規化表現）」は、この上に載る
 * 派生・編集レイヤとして後続で追加する。両者は分離して扱う。
 */

/** GTFS の1ファイル（例: stops.txt）。columns は列順、rows は行順を保持。 */
export interface FeedTable {
  /** 拡張子なしのテーブル名（例: "stops"） */
  name: string;
  /** 列名（順序を保持） */
  columns: string[];
  /** 各行: 列名→値（文字列） */
  rows: Record<string, string>[];
}

/** フィード1つ分。tables はファイル名（拡張子なし）→テーブル。 */
export interface Feed {
  tables: Map<string, FeedTable>;
  /** CSV テーブル化しないファイル（例: locations.geojson）をロスレス保持。 */
  rawFiles: Map<string, Uint8Array>;
}

export function createFeed(): Feed {
  return { tables: new Map(), rawFiles: new Map() };
}

export function getTable(feed: Feed, name: string): FeedTable | undefined {
  return feed.tables.get(name);
}

export function getRows(feed: Feed, name: string): Record<string, string>[] {
  return feed.tables.get(name)?.rows ?? [];
}

/**
 * テーブルを追加/置換する。columns 未指定時は行から出現順に推定する。
 */
export function setTable(
  feed: Feed,
  name: string,
  rows: Record<string, string>[],
  columns?: string[],
): void {
  const cols = columns ?? inferColumns(rows);
  feed.tables.set(name, { name, columns: cols, rows });
}

/** 行配列から列順を推定（最初の出現順）。 */
export function inferColumns(rows: Record<string, string>[]): string[] {
  const seen = new Set<string>();
  const cols: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        cols.push(key);
      }
    }
  }
  return cols;
}
