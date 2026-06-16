import { describe, it, expect } from "vitest";
import { parseCsv, writeCsv } from "../src/csv.js";

describe("parseCsv", () => {
  it("基本のヘッダ＋行をパースする", () => {
    const { columns, rows } = parseCsv("a,b,c\n1,2,3\n");
    expect(columns).toEqual(["a", "b", "c"]);
    expect(rows).toEqual([{ a: "1", b: "2", c: "3" }]);
  });

  it("引用符内のカンマ・改行・二重引用符を扱う", () => {
    const text = 'name,note\n"山田, 太郎","行は""折れる""\n二行目"\n';
    const { rows } = parseCsv(text);
    expect(rows[0]!.name).toBe("山田, 太郎");
    expect(rows[0]!.note).toBe('行は"折れる"\n二行目');
  });

  it("先頭BOMを除去する", () => {
    const { columns } = parseCsv("﻿a,b\n1,2\n");
    expect(columns).toEqual(["a", "b"]);
  });

  it("CRLF改行を受理する", () => {
    const { rows } = parseCsv("a,b\r\n1,2\r\n");
    expect(rows).toEqual([{ a: "1", b: "2" }]);
  });
});

describe("writeCsv", () => {
  it("必要時のみクォートし、LF・末尾改行で出力する", () => {
    const out = writeCsv(["a", "b"], [{ a: "x", b: "y,z" }]);
    expect(out).toBe('a,b\nx,"y,z"\n');
  });

  it("parse→write→parse でラウンドトリップする", () => {
    const original = 'a,b\n"1, one",2\n3,4\n';
    const parsed = parseCsv(original);
    const written = writeCsv(parsed.columns, parsed.rows);
    expect(parseCsv(written)).toEqual(parsed);
  });
});
