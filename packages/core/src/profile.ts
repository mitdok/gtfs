/**
 * 出力/検証プロファイル。
 *
 * 仕様書の「項目定義は設定（バージョン定義）駆動」に従い、ファイル/項目の要否を
 * データとして持つ。MVP では国際標準GTFSの中核（gtfs-base）と、国土交通省
 * GTFS-JP 第4.0版PDFに基づく固定路線バス向けの gtfs-jp-v4 中核要件を実装する。
 */

export type FieldPresence = "required" | "recommended" | "optional" | "conditionallyRequired";

export interface FieldDef {
  name: string;
  required?: boolean;
  presence?: FieldPresence;
}

export interface FileDef {
  /** 拡張子なしのファイル名（例: "stops"） */
  name: string;
  /** 必須ファイルか */
  required?: boolean;
  presence?: "required" | "recommended" | "optional" | "conditionallyRequired" | "legacy";
  fields: FieldDef[];
}

export interface Profile {
  id: string;
  label: string;
  files: FileDef[];
  /**
   * calendar.txt と calendar_dates.txt は「いずれか必須」。
   * この特例を扱うためのフラグ。
   */
  serviceFilesEitherRequired: boolean;
}

/** 国際標準GTFSの中核プロファイル（MVP）。 */
export const GTFS_BASE: Profile = {
  id: "gtfs-base",
  label: "GTFS (base)",
  serviceFilesEitherRequired: true,
  files: [
    {
      name: "agency",
      required: true,
      fields: [
        { name: "agency_name", required: true },
        { name: "agency_url", required: true },
        { name: "agency_timezone", required: true },
      ],
    },
    {
      name: "stops",
      required: true,
      fields: [
        { name: "stop_id", required: true },
        { name: "stop_name", required: true },
        { name: "stop_lat", required: true },
        { name: "stop_lon", required: true },
      ],
    },
    {
      name: "routes",
      required: true,
      fields: [
        { name: "route_id", required: true },
        { name: "route_type", required: true },
      ],
    },
    {
      name: "trips",
      required: true,
      fields: [
        { name: "route_id", required: true },
        { name: "service_id", required: true },
        { name: "trip_id", required: true },
      ],
    },
    {
      name: "stop_times",
      required: true,
      fields: [
        { name: "trip_id", required: true },
        { name: "stop_id", required: true },
        { name: "stop_sequence", required: true },
      ],
    },
    {
      name: "calendar",
      fields: [
        { name: "service_id", required: true },
        { name: "monday", required: true },
        { name: "tuesday", required: true },
        { name: "wednesday", required: true },
        { name: "thursday", required: true },
        { name: "friday", required: true },
        { name: "saturday", required: true },
        { name: "sunday", required: true },
        { name: "start_date", required: true },
        { name: "end_date", required: true },
      ],
    },
    {
      name: "calendar_dates",
      fields: [
        { name: "service_id", required: true },
        { name: "date", required: true },
        { name: "exception_type", required: true },
      ],
    },
    { name: "feed_info", fields: [] },
  ],
};

/** GTFS-JP 第4.0版PDFに基づく、固定路線バスMVP向けプロファイル。 */
export const GTFS_JP_V4: Profile = {
  id: "gtfs-jp-v4",
  label: "GTFS-JP v4",
  serviceFilesEitherRequired: true,
  files: [
    {
      name: "feed_info",
      required: true,
      fields: [
        { name: "feed_publisher_name", required: true },
        { name: "feed_publisher_url", required: true },
        { name: "feed_lang", required: true },
        { name: "feed_start_date", required: true },
        { name: "feed_end_date", required: true },
        { name: "feed_version", required: true },
      ],
    },
    {
      name: "agency",
      required: true,
      fields: [
        { name: "agency_id", required: true },
        { name: "agency_name", required: true },
        { name: "agency_url", required: true },
        { name: "agency_timezone", required: true },
        { name: "agency_lang", required: true },
      ],
    },
    {
      name: "stops",
      required: true,
      fields: [
        { name: "stop_id", required: true },
        { name: "stop_name", required: true },
        { name: "stop_lat", required: true },
        { name: "stop_lon", required: true },
        { name: "location_type", required: true },
      ],
    },
    {
      name: "routes",
      required: true,
      fields: [
        { name: "route_id", required: true },
        { name: "agency_id", required: true },
        { name: "route_type", required: true },
      ],
    },
    {
      name: "trips",
      required: true,
      fields: [
        { name: "route_id", required: true },
        { name: "service_id", required: true },
        { name: "trip_id", required: true },
      ],
    },
    {
      name: "stop_times",
      required: true,
      fields: [
        { name: "trip_id", required: true },
        { name: "stop_id", required: true },
        { name: "stop_sequence", required: true },
      ],
    },
    {
      name: "calendar",
      fields: [
        { name: "service_id", required: true },
        { name: "monday", required: true },
        { name: "tuesday", required: true },
        { name: "wednesday", required: true },
        { name: "thursday", required: true },
        { name: "friday", required: true },
        { name: "saturday", required: true },
        { name: "sunday", required: true },
        { name: "start_date", required: true },
        { name: "end_date", required: true },
      ],
    },
    {
      name: "calendar_dates",
      fields: [
        { name: "service_id", required: true },
        { name: "date", required: true },
        { name: "exception_type", required: true },
      ],
    },
    {
      name: "fare_attributes",
      required: true,
      fields: [
        { name: "fare_id", required: true },
        { name: "price", required: true },
        { name: "currency_type", required: true },
        { name: "payment_method", required: true },
        { name: "transfers", required: true },
      ],
    },
    {
      name: "fare_rules",
      fields: [{ name: "fare_id", required: true }],
    },
    {
      name: "translations",
      required: true,
      fields: [
        { name: "table_name", required: true },
        { name: "field_name", required: true },
        { name: "language", required: true },
        { name: "translation", required: true },
      ],
    },
    {
      name: "shapes",
      fields: [
        { name: "shape_id", required: true },
        { name: "shape_pt_lat", required: true },
        { name: "shape_pt_lon", required: true },
        { name: "shape_pt_sequence", required: true },
      ],
    },
    {
      name: "attributions",
      presence: "recommended",
      fields: [{ name: "organization_name", required: true }],
    },
    {
      name: "transfers",
      presence: "recommended",
      fields: [{ name: "transfer_type", required: true }],
    },
    {
      name: "frequencies",
      fields: [
        { name: "trip_id", required: true },
        { name: "start_time", required: true },
        { name: "end_time", required: true },
        { name: "headway_secs", required: true },
      ],
    },
  ],
};

/** 旧GTFS-JP v3互換・取込保持用プロファイル。 */
export const GTFS_JP_V3_LEGACY: Profile = {
  ...GTFS_BASE,
  id: "gtfs-jp-v3-legacy",
  label: "GTFS-JP v3 legacy",
};

/** GTFS-JP v4にGoogle Maps申請向けの実務品質ゲートを重ねるプロファイル。 */
export const GOOGLE_TRANSIT_READY: Profile = {
  ...GTFS_JP_V4,
  id: "google-transit-ready",
  label: "Google Transit ready",
};

export const PROFILES: Record<string, Profile> = {
  [GTFS_BASE.id]: GTFS_BASE,
  [GTFS_JP_V4.id]: GTFS_JP_V4,
  [GTFS_JP_V3_LEGACY.id]: GTFS_JP_V3_LEGACY,
  [GOOGLE_TRANSIT_READY.id]: GOOGLE_TRANSIT_READY,
};

export function getProfile(id: string): Profile {
  const p = PROFILES[id];
  if (!p) throw new Error(`unknown profile: ${id}`);
  return p;
}
