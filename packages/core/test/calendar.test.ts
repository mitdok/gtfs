import { describe, it, expect } from "vitest";
import { importEntries } from "../src/importer.js";
import { validateFeed } from "../src/validator.js";
import { SAMPLE_FILES } from "./fixtures.js";
import { strToU8 } from "fflate";

function feedFrom(files: Record<string, string>) {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, text] of Object.entries(files)) entries[name] = strToU8(text);
  return importEntries(entries).feed;
}

describe("カレンダー検証", () => {
  it("全曜日0かつ追加日なしの service を service_empty として検出する", () => {
    const files = {
      ...SAMPLE_FILES,
      "calendar.txt": [
        "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date",
        "weekday,0,0,0,0,0,0,0,20260401,20261231",
        "",
      ].join("\n"),
    };
    const report = validateFeed(feedFrom(files));
    expect(report.issues.some((i) => i.code === "service_empty")).toBe(true);
  });

  it("全曜日0でも calendar_dates の追加日があれば service_empty にしない", () => {
    const files = {
      ...SAMPLE_FILES,
      "calendar.txt": [
        "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date",
        "weekday,0,0,0,0,0,0,0,20260401,20261231",
        "",
      ].join("\n"),
      "calendar_dates.txt": [
        "service_id,date,exception_type",
        "weekday,20260501,1",
        "",
      ].join("\n"),
    };
    const report = validateFeed(feedFrom(files));
    expect(report.issues.some((i) => i.code === "service_empty")).toBe(false);
  });

  it("YYYYMMDD でない日付を invalid_date_format として検出する", () => {
    const files = {
      ...SAMPLE_FILES,
      "calendar.txt": [
        "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date",
        "weekday,1,1,1,1,1,0,0,2026-04-01,20261231",
        "",
      ].join("\n"),
    };
    const report = validateFeed(feedFrom(files));
    expect(report.issues.some((i) => i.code === "invalid_date_format")).toBe(true);
  });

  it("end_date が start_date より前なら検出する", () => {
    const files = {
      ...SAMPLE_FILES,
      "calendar.txt": [
        "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date",
        "weekday,1,1,1,1,1,0,0,20261231,20260401",
        "",
      ].join("\n"),
    };
    const report = validateFeed(feedFrom(files));
    expect(report.issues.some((i) => i.code === "calendar_end_before_start")).toBe(true);
  });

  it("曜日フラグが0/1以外なら検出する", () => {
    const files = {
      ...SAMPLE_FILES,
      "calendar.txt": [
        "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date",
        "weekday,2,1,1,1,1,0,0,20260401,20261231",
        "",
      ].join("\n"),
    };
    const report = validateFeed(feedFrom(files));
    expect(report.issues.some((i) => i.code === "invalid_calendar_day_flag")).toBe(true);
  });

  it("exception_type が1/2以外なら検出する", () => {
    const files = {
      ...SAMPLE_FILES,
      "calendar_dates.txt": [
        "service_id,date,exception_type",
        "weekday,20260501,3",
        "",
      ].join("\n"),
    };
    const report = validateFeed(feedFrom(files));
    expect(report.issues.some((i) => i.code === "invalid_exception_type")).toBe(true);
  });

  it("正常なカレンダーはこれらのエラーを出さない", () => {
    const report = validateFeed(feedFrom(SAMPLE_FILES));
    const codes = report.issues.map((i) => i.code);
    expect(codes).not.toContain("service_empty");
    expect(codes).not.toContain("invalid_date_format");
    expect(codes).not.toContain("calendar_end_before_start");
  });
});
