import { strToU8 } from "fflate";

/**
 * 小規模コミュニティバスを模した最小の正常 GTFS フィクスチャ。
 * 深夜便（25:00 台）も含め、24時超の取り扱いを検証できるようにしている。
 */
export const SAMPLE_FILES: Record<string, string> = {
  "agency.txt": [
    "agency_id,agency_name,agency_url,agency_timezone",
    "toyo,テスト交通,https://example.com,Asia/Tokyo",
    "",
  ].join("\n"),

  "stops.txt": [
    "stop_id,stop_name,stop_lat,stop_lon",
    "S1,駅前,34.769100,137.391600",
    "S2,市役所前,34.766000,137.385000",
    "S3,中央病院,34.760000,137.380000",
    "",
  ].join("\n"),

  "routes.txt": [
    "route_id,agency_id,route_short_name,route_long_name,route_type",
    "R1,toyo,1,テスト線,3",
    "",
  ].join("\n"),

  "trips.txt": [
    "route_id,service_id,trip_id,trip_headsign,block_id",
    "R1,weekday,T1,中央病院,B1",
    "R1,weekday,T2,中央病院,B2",
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

  "feed_info.txt": [
    "feed_publisher_name,feed_publisher_url,feed_lang",
    "テスト,https://example.com,ja",
    "",
  ].join("\n"),
};

/** フィクスチャを fflate 取込用の Uint8Array マップに変換。 */
export function sampleEntries(): Record<string, Uint8Array> {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, text] of Object.entries(SAMPLE_FILES)) {
    entries[name] = strToU8(text);
  }
  return entries;
}
