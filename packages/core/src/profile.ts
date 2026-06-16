/**
 * 出力/検証プロファイル。
 *
 * 仕様書の「項目定義は設定（バージョン定義）駆動」に従い、ファイル/項目の要否を
 * データとして持つ。MVP では国際標準GTFSの中核（gtfs-base）を実装し、
 * gtfs-jp-v4 はこの上に必須区分・拡張ファイルを重ねる前提でプレースホルダを置く。
 */

export interface FieldDef {
  name: string;
  required?: boolean;
  recommended?: boolean;
  type?:
    | "currency"
    | "date"
    | "email"
    | "enum"
    | "float"
    | "integer"
    | "language"
    | "phone"
    | "timezone"
    | "url";
  enumValues?: string[];
}

export interface FileDef {
  /** 拡張子なしのファイル名（例: "stops"） */
  name: string;
  /** 必須ファイルか */
  required?: boolean;
  /** 推奨ファイルか */
  recommended?: boolean;
  /** 条件により必須となるファイルか */
  conditionallyRequired?: boolean;
  fields: FieldDef[];
}

export interface Profile {
  id: string;
  label: string;
  completeness: number;
  notes: string[];
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
  completeness: 45,
  notes: [
    "GTFS Schedule の中核ファイルと軽量な整合性検査を実装済み",
    "運賃、翻訳、Pathways、Flex、Fares V2、Realtime/GBFS は段階実装",
  ],
  serviceFilesEitherRequired: true,
  files: [
    {
      name: "agency",
      required: true,
      fields: [
        { name: "agency_name", required: true },
        { name: "agency_url", required: true, type: "url" },
        { name: "agency_timezone", required: true, type: "timezone" },
        { name: "agency_lang", type: "language" },
        { name: "agency_phone", type: "phone" },
        { name: "agency_fare_url", type: "url" },
        { name: "agency_email", type: "email" },
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
        { name: "agency_id" },
        { name: "route_short_name" },
        { name: "route_long_name" },
        { name: "route_type", required: true, type: "enum", enumValues: ["0", "1", "2", "3", "4", "5", "6", "7", "11", "12"] },
        { name: "route_url", type: "url" },
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
        { name: "stop_sequence", required: true, type: "integer" },
      ],
    },
    {
      name: "calendar",
      fields: [
        { name: "service_id", required: true },
        { name: "monday", required: true, type: "enum", enumValues: ["0", "1"] },
        { name: "tuesday", required: true, type: "enum", enumValues: ["0", "1"] },
        { name: "wednesday", required: true, type: "enum", enumValues: ["0", "1"] },
        { name: "thursday", required: true, type: "enum", enumValues: ["0", "1"] },
        { name: "friday", required: true, type: "enum", enumValues: ["0", "1"] },
        { name: "saturday", required: true, type: "enum", enumValues: ["0", "1"] },
        { name: "sunday", required: true, type: "enum", enumValues: ["0", "1"] },
        { name: "start_date", required: true, type: "date" },
        { name: "end_date", required: true, type: "date" },
      ],
    },
    {
      name: "calendar_dates",
      fields: [
        { name: "service_id", required: true },
        { name: "date", required: true, type: "date" },
        { name: "exception_type", required: true, type: "enum", enumValues: ["1", "2"] },
      ],
    },
    {
      name: "feed_info",
      fields: [
        { name: "feed_publisher_name", required: true },
        { name: "feed_publisher_url", required: true, type: "url" },
        { name: "feed_lang", required: true, type: "language" },
        { name: "feed_start_date", type: "date" },
        { name: "feed_end_date", type: "date" },
        { name: "feed_version" },
        { name: "feed_contact_email", type: "email" },
        { name: "feed_contact_url", type: "url" },
      ],
    },
  ],
};

/**
 * GTFS-JP v4 プロファイル（プレースホルダ）。
 * v4 仕様書（国交省公開）の必須区分・拡張ファイル（agency_jp 等）・読み仮名
 * （translations の ja-Hrkt）等を、実装時にここへ取り込む。現状は base を継承。
 */
export const GTFS_JP_V4: Profile = {
  ...GTFS_BASE,
  id: "gtfs-jp-v4",
  label: "GTFS-JP v4",
  completeness: 58,
  notes: [
    "2026年3月公開の GTFS-JP v4 Schedule 必須区分を core profile に反映中",
    "Realtime と GBFS は仕様上 v4 の対象だが、このパッケージでは未実装",
    "条件付必須や高度な値設定方法は軽量検査から順次追加",
  ],
  files: [
    ...GTFS_BASE.files.map((file) => {
      if (file.name === "feed_info") {
        return {
          ...file,
          required: true,
          fields: file.fields.map((field) =>
            ["feed_start_date", "feed_end_date", "feed_version"].includes(field.name)
              ? { ...field, required: true }
              : field,
          ),
        };
      }
      return file;
    }),
    {
      name: "fare_attributes",
      required: true,
      fields: [
        { name: "fare_id", required: true },
        { name: "price", required: true, type: "float" },
        { name: "currency_type", required: true, type: "currency" },
        { name: "payment_method", required: true, type: "enum", enumValues: ["0", "1"] },
        { name: "transfers", type: "enum", enumValues: ["0", "1", "2"] },
        { name: "agency_id" },
        { name: "transfer_duration", type: "integer" },
      ],
    },
    {
      name: "fare_rules",
      conditionallyRequired: true,
      fields: [
        { name: "fare_id", required: true },
        { name: "route_id" },
        { name: "origin_id" },
        { name: "destination_id" },
        { name: "contains_id" },
      ],
    },
    {
      name: "translations",
      required: true,
      fields: [
        { name: "table_name", required: true },
        { name: "field_name", required: true },
        { name: "language", required: true, type: "language" },
        { name: "translation", required: true },
        { name: "record_id" },
        { name: "record_sub_id" },
        { name: "field_value" },
      ],
    },
    {
      name: "shapes",
      conditionallyRequired: true,
      fields: [
        { name: "shape_id", required: true },
        { name: "shape_pt_lat", required: true, type: "float" },
        { name: "shape_pt_lon", required: true, type: "float" },
        { name: "shape_pt_sequence", required: true, type: "integer" },
        { name: "shape_dist_traveled", type: "float" },
      ],
    },
    { name: "attributions", recommended: true, fields: [] },
    { name: "transfers", recommended: true, fields: [] },
    { name: "frequencies", fields: [] },
    { name: "pathways", fields: [] },
    { name: "levels", conditionallyRequired: true, fields: [] },
    { name: "location_groups", fields: [] },
    { name: "location_group_stops", fields: [] },
    { name: "booking_rules", fields: [] },
    { name: "timeframes", fields: [] },
    { name: "rider_categories", fields: [] },
    { name: "fare_media", fields: [] },
    { name: "fare_products", fields: [] },
    { name: "fare_leg_rules", fields: [] },
    { name: "fare_leg_join_rules", fields: [] },
    { name: "fare_transfer_rules", fields: [] },
    { name: "areas", fields: [] },
    { name: "stop_areas", fields: [] },
    { name: "networks", fields: [] },
    { name: "route_networks", fields: [] },
  ],
};

export const PROFILES: Record<string, Profile> = {
  [GTFS_BASE.id]: GTFS_BASE,
  [GTFS_JP_V4.id]: GTFS_JP_V4,
};

export function getProfile(id: string): Profile {
  const p = PROFILES[id];
  if (!p) throw new Error(`unknown profile: ${id}`);
  return p;
}
