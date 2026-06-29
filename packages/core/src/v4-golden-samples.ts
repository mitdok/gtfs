export interface V4GoldenSample {
  id: string;
  description: string;
  files: Record<string, string>;
}

export function v4MinimalFixedBusFiles(): Record<string, string> {
  return {
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
}

export function v4GoldenSamples(): V4GoldenSample[] {
  const minimal = v4MinimalFixedBusFiles();
  return [
    {
      id: "minimal-fixed-bus",
      description: "GTFS-JP v4 fixed-route bus minimal sample with normal and overnight trips",
      files: minimal,
    },
    {
      id: "overnight-bus",
      description: "24:00:00超のGTFS時刻を含むサンプル",
      files: minimal,
    },
    {
      id: "calendar-dates-only",
      description: "calendar.txtなし、calendar_dates.txtのみでservice参照を成立させるサンプル",
      files: withoutCalendarWithDates(minimal),
    },
    {
      id: "translations-kana",
      description: "translations.txtのja-Hrkt読み仮名を含むサンプル",
      files: minimal,
    },
    {
      id: "shape-basic",
      description: "trips.shape_idとshapes.txtを含むサンプル",
      files: withShape(minimal),
    },
  ];
}

function withoutCalendarWithDates(files: Record<string, string>): Record<string, string> {
  const out = { ...files };
  delete out["calendar.txt"];
  out["calendar_dates.txt"] = [
    "service_id,date,exception_type",
    "weekday,20260501,1",
    "weekday,20260502,1",
    "",
  ].join("\n");
  return out;
}

function withShape(files: Record<string, string>): Record<string, string> {
  return {
    ...files,
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
}
