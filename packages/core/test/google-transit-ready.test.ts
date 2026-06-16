import { describe, it, expect } from "vitest";
import { strToU8 } from "fflate";
import { importEntries } from "../src/importer.js";
import { validateFeed } from "../src/validator.js";
import { SAMPLE_FILES } from "./fixtures.js";

function feedFrom(files: Record<string, string>) {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, text] of Object.entries(files)) entries[name] = strToU8(text);
  return importEntries(entries).feed;
}

const V4_GOOGLE_BASE = {
  ...SAMPLE_FILES,
  "agency.txt": [
    "agency_id,agency_name,agency_url,agency_timezone,agency_lang,agency_email",
    "toyo,テスト交通,https://example.com,Asia/Tokyo,ja,info@example.com",
    "",
  ].join("\n"),
  "feed_info.txt": [
    "feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version,feed_contact_email",
    "テスト,https://example.com,ja,20260401,20261231,2026-04,info@example.com",
    "",
  ].join("\n"),
  "stops.txt": [
    "stop_id,stop_name,stop_lat,stop_lon,location_type",
    "S1,駅前,34.769100,137.391600,0",
    "S2,市役所前,34.766000,137.385000,0",
    "S3,中央病院,34.760000,137.380000,0",
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
};

describe("google-transit-ready 公開ゲート", () => {
  it("shape と headsign と問い合わせ先を Google 向け warning として検出する", () => {
    const report = validateFeed(
      feedFrom({
        ...V4_GOOGLE_BASE,
        "agency.txt": [
          "agency_id,agency_name,agency_url,agency_timezone,agency_lang",
          "toyo,テスト交通,https://example.com,Asia/Tokyo,ja",
          "",
        ].join("\n"),
        "feed_info.txt": [
          "feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version",
          "テスト,https://example.com,ja,20260401,20261231,2026-04",
          "",
        ].join("\n"),
        "trips.txt": [
          "route_id,service_id,trip_id,trip_headsign",
          "R1,weekday,T1,",
          "R1,weekday,T2,中央病院",
          "",
        ].join("\n"),
      }),
      { profileId: "google-transit-ready", validationDate: "20260616" },
    );
    expect(report.issues.some((i) => i.code === "missing_shape_recommended")).toBe(true);
    expect(report.issues.some((i) => i.code === "missing_trip_headsign")).toBe(true);
    expect(report.issues.some((i) => i.code === "missing_contact")).toBe(true);
  });

  it("feed の期限切れと期限間近を検出する", () => {
    const expired = validateFeed(feedFrom(V4_GOOGLE_BASE), {
      profileId: "google-transit-ready",
      validationDate: "20270101",
    });
    expect(expired.issues.some((i) => i.code === "feed_expired" && i.severity === "error")).toBe(true);

    const soon = validateFeed(feedFrom(V4_GOOGLE_BASE), {
      profileId: "google-transit-ready",
      validationDate: "20261210",
    });
    expect(soon.issues.some((i) => i.code === "feed_expired_soon" && i.severity === "warning")).toBe(true);
  });

  it("前版から公開IDが大量変更された場合に warning を出す", () => {
    const previous = feedFrom({
      ...V4_GOOGLE_BASE,
      "stops.txt": [
        "stop_id,stop_name,stop_lat,stop_lon,location_type",
        "S1,駅前,34.769100,137.391600,0",
        "S2,市役所前,34.766000,137.385000,0",
        "S3,中央病院,34.760000,137.380000,0",
        "S4,公園前,34.758000,137.378000,0",
        "S5,図書館前,34.757000,137.377000,0",
        "",
      ].join("\n"),
    });
    const current = feedFrom({
      ...V4_GOOGLE_BASE,
      "stops.txt": [
        "stop_id,stop_name,stop_lat,stop_lon,location_type",
        "N1,駅前,34.769100,137.391600,0",
        "N2,市役所前,34.766000,137.385000,0",
        "N3,中央病院,34.760000,137.380000,0",
        "N4,公園前,34.758000,137.378000,0",
        "N5,図書館前,34.757000,137.377000,0",
        "",
      ].join("\n"),
      "translations.txt": [
        "table_name,field_name,language,translation,record_id",
        "stops,stop_name,ja-Hrkt,エキマエ,N1",
        "stops,stop_name,ja-Hrkt,シヤクショマエ,N2",
        "stops,stop_name,ja-Hrkt,チュウオウビョウイン,N3",
        "stops,stop_name,ja-Hrkt,コウエンマエ,N4",
        "stops,stop_name,ja-Hrkt,トショカンマエ,N5",
        "",
      ].join("\n"),
    });
    const report = validateFeed(current, {
      profileId: "google-transit-ready",
      validationDate: "20260616",
      previousFeed: previous,
    });
    expect(report.issues.some((i) => i.code === "unstable_public_ids")).toBe(true);
  });
});
