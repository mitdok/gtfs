import { describe, expect, it } from "vitest";
import { strToU8 } from "fflate";
import { exportToFiles } from "../src/exporter.js";
import { importEntries } from "../src/importer.js";
import { validateFeed } from "../src/validator.js";

function feedFrom(files: Record<string, string>) {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, text] of Object.entries(files)) entries[name] = strToU8(text);
  return importEntries(entries).feed;
}

function validateV4(files: Record<string, string>) {
  return validateFeed(feedFrom(files), { profileId: "gtfs-jp-v4" });
}

const V4_GOLDEN_FILES: Record<string, string> = {
  "agency.txt": [
    "agency_id,agency_name,agency_url,agency_timezone,agency_lang",
    "toyo,テスト交通,https://example.com,Asia/Tokyo,ja",
    "",
  ].join("\n"),
  "stops.txt": [
    "stop_id,stop_name,stop_lat,stop_lon,location_type",
    "S1,駅前,34.769100,137.391600,0",
    "S2,市役所前,34.766000,137.385000,0",
    "S3,中央病院,34.760000,137.380000,0",
    "",
  ].join("\n"),
  "routes.txt": [
    "route_id,agency_id,route_short_name,route_long_name,route_type",
    "R1,toyo,1,テスト線,3",
    "",
  ].join("\n"),
  "trips.txt": [
    "route_id,service_id,trip_id,trip_headsign",
    "R1,weekday,T1,中央病院",
    "R1,weekday,T2,中央病院",
    "",
  ].join("\n"),
  "stop_times.txt": [
    "trip_id,arrival_time,departure_time,stop_id,stop_sequence",
    "T1,07:00:00,07:00:00,S1,1",
    "T1,07:05:00,07:05:00,S2,2",
    "T1,07:12:00,07:12:00,S3,3",
    "T2,25:00:00,25:00:00,S1,1",
    "T2,25:05:00,25:05:00,S2,2",
    "T2,25:12:00,25:12:00,S3,3",
    "",
  ].join("\n"),
  "calendar.txt": [
    "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date",
    "weekday,1,1,1,1,1,0,0,20260401,20261231",
    "",
  ].join("\n"),
  "fare_attributes.txt": [
    "fare_id,price,currency_type,payment_method,transfers",
    "free,0,JPY,0,0",
    "",
  ].join("\n"),
  "translations.txt": [
    "table_name,field_name,language,translation,record_id",
    "stops,stop_name,ja-Hrkt,エキマエ,S1",
    "stops,stop_name,ja-Hrkt,シヤクショマエ,S2",
    "stops,stop_name,ja-Hrkt,チュウオウビョウイン,S3",
    "",
  ].join("\n"),
  "feed_info.txt": [
    "feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version",
    "テスト,https://example.com,ja,20260401,20261231,2026-v4-golden",
    "",
  ].join("\n"),
};

describe("GTFS-JP v4 golden samples", () => {
  it("minimal-fixed-bus は v4 error 0 で通る", () => {
    expect(validateV4(V4_GOLDEN_FILES).summary.errors).toBe(0);
  });

  it("overnight-bus は24時超時刻を正常に扱う", () => {
    const report = validateV4(V4_GOLDEN_FILES);
    expect(report.summary.errors).toBe(0);
    expect(report.issues.some((i) => i.code === "invalid_time_format")).toBe(false);
    expect(report.issues.some((i) => i.code === "stop_time_decreasing")).toBe(false);
  });

  it("calendar-dates-only は calendar なしでも service 参照が成立する", () => {
    const files = {
      ...V4_GOLDEN_FILES,
      "calendar_dates.txt": [
        "service_id,date,exception_type",
        "weekday,20260501,1",
        "weekday,20260502,1",
        "",
      ].join("\n"),
    };
    delete files["calendar.txt"];

    expect(validateV4(files).summary.errors).toBe(0);
  });

  it("translations-kana は record_id 方式の停留所読み仮名を認識する", () => {
    const report = validateV4(V4_GOLDEN_FILES);
    expect(report.issues.some((i) => i.code === "missing_stop_name_kana")).toBe(false);
  });

  it("shape-basic は trips.shape_id と shapes を含めて v4 error 0 で通る", () => {
    const files = {
      ...V4_GOLDEN_FILES,
      "trips.txt": [
        "route_id,service_id,trip_id,trip_headsign,shape_id",
        "R1,weekday,T1,中央病院,SH1",
        "R1,weekday,T2,中央病院,SH1",
        "",
      ].join("\n"),
      "shapes.txt": [
        "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence",
        "SH1,34.769100,137.391600,1",
        "SH1,34.766000,137.385000,2",
        "SH1,34.760000,137.380000,3",
        "",
      ].join("\n"),
    };

    expect(validateV4(files).summary.errors).toBe(0);
  });

  it("v4 golden feed は出力後も v4 error 0 を維持する", () => {
    const exported = exportToFiles(feedFrom(V4_GOLDEN_FILES), { profileId: "gtfs-jp-v4" });
    expect(validateV4(exported).summary.errors).toBe(0);
  });
});
