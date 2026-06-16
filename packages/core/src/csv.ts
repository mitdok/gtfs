/**
 * 最小・決定的な RFC 4180 準拠 CSV パーサ/ライタ。
 * GTFS は CSV(UTF-8) で構成されるため、外部依存を増やさず自前で持つ。
 * - 引用符内のカンマ・改行・二重引用符("")を正しく扱う
 * - 先頭 BOM を除去
 * - CRLF / LF いずれの改行も受理
 * 出力は常に LF・必要時のみクォートし、決定的（同一入力→同一バイト列）。
 */

const BOM = "﻿";

/** ヘッダ付き CSV をパースし、列名→値 のレコード配列を返す。 */
export function parseCsv(input: string): { columns: string[]; rows: Record<string, string>[] } {
  const text = input.startsWith(BOM) ? input.slice(BOM.length) : input;
  const records = parseRecords(text);
  if (records.length === 0) return { columns: [], rows: [] };

  const columns = (records[0] ?? []).map((c) => c.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < records.length; i++) {
    const fields = records[i]!;
    // 完全に空の行（末尾の空行など）はスキップ
    if (fields.length === 1 && fields[0] === "") continue;
    const row: Record<string, string> = {};
    for (let c = 0; c < columns.length; c++) {
      row[columns[c]!] = fields[c] ?? "";
    }
    rows.push(row);
  }
  return { columns, rows };
}

/** 生のセル行列へ分解する（ヘッダ解釈なし）。 */
function parseRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  while (i < n) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ",") {
        endField();
        i++;
      } else if (ch === "\r") {
        // CRLF / CR を行末として扱う
        endRecord();
        if (text[i + 1] === "\n") i += 2;
        else i++;
      } else if (ch === "\n") {
        endRecord();
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }
  // 末尾フィールド/レコードの取りこぼし防止
  if (field !== "" || record.length > 0) endRecord();
  return records;
}

/** 1セルを必要に応じてクォートする。 */
function quoteField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/**
 * 列順を固定して決定的に CSV 文字列を生成する。
 * 改行は LF、末尾に改行を1つ付与（POSIX テキスト慣行）。
 */
export function writeCsv(columns: string[], rows: Record<string, string>[]): string {
  const lines: string[] = [];
  lines.push(columns.map(quoteField).join(","));
  for (const row of rows) {
    lines.push(columns.map((c) => quoteField(row[c] ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}
