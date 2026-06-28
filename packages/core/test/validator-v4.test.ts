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

const V4_REQUIRED_FILES = {
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

describe("GTFS-JP v4 条件付きルール", () => {
  it("固定路線MVPで禁止するFlex/Network系フィールドを検出する", () => {
    const report = validateFeed(
      feedFrom({
        ...SAMPLE_FILES,
        ...V4_REQUIRED_FILES,
        "routes.txt": [
          "route_id,agency_id,route_short_name,route_long_name,route_type,continuous_pickup,network_id",
          "R1,toyo,1,テスト線,3,1,N1",
          "",
        ].join("\n"),
        "stop_times.txt": [
          "trip_id,arrival_time,departure_time,stop_id,stop_sequence,location_id,continuous_drop_off",
          "T1,07:00:00,07:00:00,S1,1,L1,1",
          "T1,07:05:00,07:05:00,S2,2,,",
          "T1,07:12:00,07:12:00,S3,3,,",
          "T2,25:00:00,25:00:00,S1,1,,",
          "T2,25:05:00,25:05:00,S2,2,,",
          "T2,25:12:00,25:12:00,S3,3,,",
          "",
        ].join("\n"),
      }),
      { profileId: "gtfs-jp-v4" },
    );
    expect(report.issues.filter((i) => i.code === "forbidden_v4_fixed_route_field")).toHaveLength(4);
  });

  it("shapes 出力時に trips.shape_id と shape 座標・sequence を検証する", () => {
    const report = validateFeed(
      feedFrom({
        ...SAMPLE_FILES,
        ...V4_REQUIRED_FILES,
        "trips.txt": [
          "route_id,service_id,trip_id,trip_headsign,shape_id",
          "R1,weekday,T1,中央病院,SH1",
          "R1,weekday,T2,中央病院,",
          "",
        ].join("\n"),
        "shapes.txt": [
          "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence",
          "SH1,34.769100,137.391600,1",
          "SH1,999,137.385000,2",
          "SH1,34.760000,200,2",
          "",
        ].join("\n"),
      }),
      { profileId: "gtfs-jp-v4" },
    );
    expect(report.issues.some((i) => i.code === "missing_trip_shape_id")).toBe(true);
    expect(report.issues.some((i) => i.code === "invalid_shape_pt_lat")).toBe(true);
    expect(report.issues.some((i) => i.code === "invalid_shape_pt_lon")).toBe(true);
    expect(report.issues.some((i) => i.code === "duplicate_shape_pt_sequence")).toBe(true);
  });

  it("translations は record_id または field_value の対象キーを必須にし、field_value 方式の読み仮名も認識する", () => {
    const report = validateFeed(
      feedFrom({
        ...SAMPLE_FILES,
        "fare_attributes.txt": V4_REQUIRED_FILES["fare_attributes.txt"],
        "translations.txt": [
          "table_name,field_name,language,translation,field_value",
          "stops,stop_name,ja-Hrkt,エキマエ,駅前",
          "stops,stop_name,ja-Hrkt,シヤクショマエ,市役所前",
          "stops,stop_name,ja-Hrkt,チュウオウビョウイン,中央病院",
          "routes,route_long_name,en,Test Line,",
          "",
        ].join("\n"),
      }),
      { profileId: "gtfs-jp-v4" },
    );
    expect(report.issues.some((i) => i.code === "missing_stop_name_kana")).toBe(false);
    expect(report.issues.some((i) => i.code === "missing_translation_record_key")).toBe(true);
  });

  it("運賃・帰属表示・乗換の実務入力ミスを検出する", () => {
    const report = validateFeed(
      feedFrom({
        ...SAMPLE_FILES,
        "fare_attributes.txt": [
          "fare_id,price,currency_type,payment_method,transfers",
          "adult,210,JPY,9,7",
          "",
        ].join("\n"),
        "translations.txt": V4_REQUIRED_FILES["translations.txt"],
        "attributions.txt": [
          "organization_name,is_producer,is_operator,is_authority",
          "テスト交通,0,0,0",
          "",
        ].join("\n"),
        "transfers.txt": [
          "from_stop_id,to_stop_id,transfer_type",
          ",,9",
          "",
        ].join("\n"),
      }),
      { profileId: "gtfs-jp-v4" },
    );
    expect(report.issues.some((i) => i.code === "invalid_fare_payment_method")).toBe(true);
    expect(report.issues.some((i) => i.code === "invalid_fare_transfers")).toBe(true);
    expect(report.issues.some((i) => i.code === "missing_attribution_role")).toBe(true);
    expect(report.issues.some((i) => i.code === "missing_transfer_endpoint")).toBe(true);
    expect(report.issues.some((i) => i.code === "invalid_transfer_type")).toBe(true);
  });

  it("URL・タイムゾーン・言語タグ・色・enumの不正値を検出する", () => {
    const report = validateFeed(
      feedFrom({
        ...SAMPLE_FILES,
        ...V4_REQUIRED_FILES,
        "agency.txt": [
          "agency_id,agency_name,agency_url,agency_timezone,agency_lang",
          "toyo,テスト交通,ftp://example.com,Japan/Local,not a lang",
          "",
        ].join("\n"),
        "feed_info.txt": [
          "feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version",
          "テスト,example.com,ja,20260401,20261231,v1",
          "",
        ].join("\n"),
        "stops.txt": [
          "stop_id,stop_name,stop_lat,stop_lon,location_type,wheelchair_boarding",
          "S1,駅前,34.769100,137.391600,9,9",
          "S2,市役所前,34.766000,137.385000,0,0",
          "S3,中央病院,34.760000,137.380000,0,0",
          "",
        ].join("\n"),
        "routes.txt": [
          "route_id,agency_id,route_short_name,route_long_name,route_type,route_color",
          "R1,toyo,1,テスト線,99,#336699",
          "",
        ].join("\n"),
        "trips.txt": [
          "route_id,service_id,trip_id,trip_headsign,wheelchair_accessible",
          "R1,weekday,T1,中央病院,9",
          "R1,weekday,T2,中央病院,0",
          "",
        ].join("\n"),
        "stop_times.txt": [
          "trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type,timepoint",
          "T1,07:00:00,07:00:00,S1,1,9,0,1",
          "T1,07:05:00,07:05:00,S2,2,0,9,1",
          "T1,07:12:00,07:12:00,S3,3,0,0,9",
          "T2,25:00:00,25:00:00,S1,1,0,0,1",
          "T2,25:05:00,25:05:00,S2,2,0,0,1",
          "T2,25:12:00,25:12:00,S3,3,0,0,1",
          "",
        ].join("\n"),
      }),
      { profileId: "gtfs-jp-v4" },
    );

    expect(report.issues.some((i) => i.code === "invalid_url" && i.entity?.field === "agency_url")).toBe(true);
    expect(report.issues.some((i) => i.code === "invalid_timezone")).toBe(true);
    expect(report.issues.some((i) => i.code === "invalid_language")).toBe(true);
    expect(report.issues.some((i) => i.code === "invalid_enum" && i.entity?.field === "location_type")).toBe(true);
    expect(report.issues.some((i) => i.code === "invalid_enum" && i.entity?.field === "route_type")).toBe(true);
    expect(report.issues.some((i) => i.code === "invalid_enum" && i.entity?.field === "pickup_type")).toBe(true);
    expect(report.issues.some((i) => i.code === "invalid_enum" && i.entity?.field === "timepoint")).toBe(true);
    expect(report.issues.some((i) => i.code === "invalid_color")).toBe(true);
  });

  it("親子停留所とfare_rulesのzone参照を検証する", () => {
    const report = validateFeed(
      feedFrom({
        ...SAMPLE_FILES,
        ...V4_REQUIRED_FILES,
        "stops.txt": [
          "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station,zone_id",
          "S1,駅前,34.769100,137.391600,0,S2,Z1",
          "S2,市役所前,34.766000,137.385000,0,,Z2",
          "S3,中央病院,34.760000,137.380000,1,S3,",
          "",
        ].join("\n"),
        "fare_attributes.txt": [
          "fare_id,price,currency_type,payment_method,transfers",
          "F1,210,JPY,0,",
          "",
        ].join("\n"),
        "fare_rules.txt": [
          "fare_id,route_id,origin_id,destination_id,contains_id",
          "F1,R1,Z1,Z9,Z3",
          "",
        ].join("\n"),
      }),
      { profileId: "gtfs-jp-v4" },
    );

    expect(report.issues.some((i) => i.code === "invalid_parent_station_type")).toBe(true);
    expect(report.issues.some((i) => i.code === "invalid_parent_station")).toBe(true);
    expect(report.issues.some((i) => i.code === "missing_fare_zone" && i.entity?.field === "destination_id")).toBe(true);
    expect(report.issues.some((i) => i.code === "missing_fare_zone" && i.entity?.field === "contains_id")).toBe(true);
  });
});
