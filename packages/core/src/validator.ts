/**
 * 構造・整合性バリデーション（仕様書 06 章の層1・層2の中核サブセット）。
 *
 * MVP の狙いは「取り込んだ実データを編集して再出力したものが、最低限の整合性を
 * 満たすことを保証する」こと。標準バリデータ（層3）はこの後段に置く想定で、
 * ここでは編集UIに即時フィードバックできる軽量・自前ルールを実装する。
 */
import { getRows, type Feed } from "./model.js";
import { getProfile, type FieldDef, type Profile } from "./profile.js";
import { isValidGtfsTime, hmsToSec } from "./time.js";

export type Severity = "error" | "warning" | "info";

export interface ValidationIssue {
  severity: Severity;
  code: string;
  message: string;
  entity?: { type: string; id?: string; [k: string]: unknown };
}

export interface ValidationReport {
  issues: ValidationIssue[];
  summary: { errors: number; warnings: number; infos: number };
}

export interface ValidateOptions {
  profileId?: string;
}

export function validateFeed(feed: Feed, options: ValidateOptions = {}): ValidationReport {
  const profile = getProfile(options.profileId ?? "gtfs-base");
  const issues: ValidationIssue[] = [];

  checkRequiredFiles(feed, profile, issues);
  checkRequiredFields(feed, profile, issues);
  checkFieldValues(feed, profile, issues);
  checkUniqueIds(feed, issues);
  checkReferences(feed, issues);
  checkCoordinates(feed, issues);
  checkStopTimes(feed, issues);
  checkGtfsJpV4Rules(feed, profile, issues);

  return { issues, summary: summarize(issues) };
}

function summarize(issues: ValidationIssue[]) {
  let errors = 0,
    warnings = 0,
    infos = 0;
  for (const i of issues) {
    if (i.severity === "error") errors++;
    else if (i.severity === "warning") warnings++;
    else infos++;
  }
  return { errors, warnings, infos };
}

// --- 必須ファイル ---------------------------------------------------------
function checkRequiredFiles(feed: Feed, profile: Profile, issues: ValidationIssue[]) {
  for (const file of profile.files) {
    if (file.required && !feed.tables.has(file.name)) {
      issues.push({
        severity: "error",
        code: "missing_required_file",
        message: `必須ファイル ${file.name}.txt がありません`,
        entity: { type: "file", id: file.name },
      });
    }
  }
  for (const file of profile.files) {
    if (file.recommended && !feed.tables.has(file.name)) {
      issues.push({
        severity: "info",
        code: "missing_recommended_file",
        message: `推奨ファイル ${file.name}.txt がありません`,
        entity: { type: "file", id: file.name },
      });
    }
  }
  if (profile.serviceFilesEitherRequired) {
    if (!feed.tables.has("calendar") && !feed.tables.has("calendar_dates")) {
      issues.push({
        severity: "error",
        code: "missing_service_file",
        message: "calendar.txt または calendar_dates.txt の少なくとも一方が必要です",
        entity: { type: "file" },
      });
    }
  }
}

// --- 必須項目 -------------------------------------------------------------
function checkRequiredFields(feed: Feed, profile: Profile, issues: ValidationIssue[]) {
  for (const file of profile.files) {
    const table = feed.tables.get(file.name);
    if (!table) continue;
    const requiredFields = file.fields.filter((f) => f.required);
    for (const field of requiredFields) {
      if (!table.columns.includes(field.name)) {
        issues.push({
          severity: "error",
          code: "missing_required_field",
          message: `${file.name}.txt に必須列 ${field.name} がありません`,
          entity: { type: "field", id: `${file.name}.${field.name}` },
        });
        continue;
      }
      // 値の空欄チェック（最初の数件のみ報告して洪水を避ける）
      let emptyCount = 0;
      for (const row of table.rows) {
        if ((row[field.name] ?? "").trim() === "") emptyCount++;
      }
      if (emptyCount > 0) {
        issues.push({
          severity: "error",
          code: "empty_required_value",
          message: `${file.name}.txt の必須列 ${field.name} に空欄が ${emptyCount} 件あります`,
          entity: { type: "field", id: `${file.name}.${field.name}`, count: emptyCount },
        });
      }
    }
  }
}

// --- 値の型・列挙 ---------------------------------------------------------
function checkFieldValues(feed: Feed, profile: Profile, issues: ValidationIssue[]) {
  for (const file of profile.files) {
    const table = feed.tables.get(file.name);
    if (!table) continue;
    for (const field of file.fields) {
      if (!table.columns.includes(field.name)) continue;
      for (const row of table.rows) {
        const value = (row[field.name] ?? "").trim();
        if (value === "") continue;
        if (!isValidFieldValue(field, value)) {
          issues.push({
            severity: "error",
            code: "invalid_field_value",
            message: `${file.name}.txt の ${field.name} が不正です: "${value}"`,
            entity: {
              type: file.name,
              id: row[primaryKeyFor(file.name)] ?? row["trip_id"] ?? "",
              field: field.name,
              value,
            },
          });
        }
      }
    }
  }
}

function isValidFieldValue(field: FieldDef, value: string): boolean {
  if (field.type === "enum") return field.enumValues?.includes(value) ?? true;
  if (field.type === "date") return isValidDate(value);
  if (field.type === "url") return /^https?:\/\/\S+$/i.test(value);
  if (field.type === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (field.type === "integer") return /^-?\d+$/.test(value);
  if (field.type === "float") return Number.isFinite(Number(value));
  if (field.type === "currency") return /^[A-Z]{3}$/.test(value);
  if (field.type === "language") return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value);
  if (field.type === "timezone") return /^[A-Za-z]+\/[A-Za-z0-9_+\-]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(value);
  return true;
}

function isValidDate(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false;
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(4, 6));
  const d = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

function dateToDayNumber(value: string): number | null {
  if (!isValidDate(value)) return null;
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(4, 6));
  const d = Number(value.slice(6, 8));
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

// --- 主キー一意性 ---------------------------------------------------------
const PRIMARY_KEYS: { table: string; key: string }[] = [
  { table: "agency", key: "agency_id" },
  { table: "stops", key: "stop_id" },
  { table: "routes", key: "route_id" },
  { table: "trips", key: "trip_id" },
  { table: "calendar", key: "service_id" },
  { table: "fare_attributes", key: "fare_id" },
  { table: "levels", key: "level_id" },
  { table: "fare_media", key: "fare_media_id" },
  { table: "fare_products", key: "fare_product_id" },
  { table: "areas", key: "area_id" },
  { table: "networks", key: "network_id" },
];

function checkUniqueIds(feed: Feed, issues: ValidationIssue[]) {
  for (const { table, key } of PRIMARY_KEYS) {
    const t = feed.tables.get(table);
    if (!t || !t.columns.includes(key)) continue;
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const row of t.rows) {
      const id = (row[key] ?? "").trim();
      if (id === "") continue;
      if (seen.has(id)) dup.add(id);
      else seen.add(id);
    }
    for (const id of dup) {
      issues.push({
        severity: "error",
        code: "duplicate_id",
        message: `${table}.txt の ${key}="${id}" が重複しています`,
        entity: { type: table, id },
      });
    }
  }
}

// --- 参照整合 -------------------------------------------------------------
function checkReferences(feed: Feed, issues: ValidationIssue[]) {
  const stopIds = idSet(feed, "stops", "stop_id");
  const routeIds = idSet(feed, "routes", "route_id");
  const tripIds = idSet(feed, "trips", "trip_id");
  const agencyIds = idSet(feed, "agency", "agency_id");
  const fareIds = idSet(feed, "fare_attributes", "fare_id");
  const shapeIds = idSet(feed, "shapes", "shape_id");
  const serviceIds = new Set<string>([
    ...idSet(feed, "calendar", "service_id"),
    ...idSet(feed, "calendar_dates", "service_id"),
  ]);

  // routes.agency_id -> agency （列がありかつ値が非空のときのみ）
  for (const row of getRows(feed, "routes")) {
    const aid = (row["agency_id"] ?? "").trim();
    if (aid !== "" && agencyIds.size > 0 && !agencyIds.has(aid)) {
      issues.push(ref("routes", "route_id", row, "agency_id", aid, "agency"));
    }
  }
  // trips.route_id -> routes, trips.service_id -> service
  for (const row of getRows(feed, "trips")) {
    const rid = (row["route_id"] ?? "").trim();
    if (rid !== "" && !routeIds.has(rid)) {
      issues.push(ref("trips", "trip_id", row, "route_id", rid, "routes"));
    }
    const sid = (row["service_id"] ?? "").trim();
    if (sid !== "" && !serviceIds.has(sid)) {
      issues.push(ref("trips", "trip_id", row, "service_id", sid, "calendar/calendar_dates"));
    }
    const shapeId = (row["shape_id"] ?? "").trim();
    if (shapeId !== "" && !shapeIds.has(shapeId)) {
      issues.push(ref("trips", "trip_id", row, "shape_id", shapeId, "shapes"));
    }
  }
  // stop_times.trip_id -> trips, stop_times.stop_id -> stops
  for (const row of getRows(feed, "stop_times")) {
    const tid = (row["trip_id"] ?? "").trim();
    if (tid !== "" && !tripIds.has(tid)) {
      issues.push(ref("stop_times", "trip_id", row, "trip_id", tid, "trips"));
    }
    const sid = (row["stop_id"] ?? "").trim();
    if (sid !== "" && !stopIds.has(sid)) {
      issues.push(ref("stop_times", "trip_id", row, "stop_id", sid, "stops"));
    }
  }
  // stops.parent_station -> stops（任意）
  for (const row of getRows(feed, "stops")) {
    const ps = (row["parent_station"] ?? "").trim();
    if (ps !== "" && !stopIds.has(ps)) {
      issues.push(ref("stops", "stop_id", row, "parent_station", ps, "stops"));
    }
  }
  // fare_rules.fare_id -> fare_attributes, fare_rules.route_id -> routes
  for (const row of getRows(feed, "fare_rules")) {
    const fareId = (row["fare_id"] ?? "").trim();
    if (fareId !== "" && !fareIds.has(fareId)) {
      issues.push(ref("fare_rules", "fare_id", row, "fare_id", fareId, "fare_attributes"));
    }
    const routeId = (row["route_id"] ?? "").trim();
    if (routeId !== "" && !routeIds.has(routeId)) {
      issues.push(ref("fare_rules", "fare_id", row, "route_id", routeId, "routes"));
    }
  }
}

function ref(
  table: string,
  idKey: string,
  row: Record<string, string>,
  field: string,
  value: string,
  target: string,
): ValidationIssue {
  return {
    severity: "error",
    code: "dangling_reference",
    message: `${table}.txt の ${field}="${value}" が ${target} に存在しません`,
    entity: { type: table, id: (row[idKey] ?? "").trim(), field, value },
  };
}

// --- 座標 -----------------------------------------------------------------
function checkCoordinates(feed: Feed, issues: ValidationIssue[]) {
  for (const row of getRows(feed, "stops")) {
    // location_type が 0/1/空 のみ座標必須。停留所(0)・駅(1)を主対象とする。
    const lat = (row["stop_lat"] ?? "").trim();
    const lon = (row["stop_lon"] ?? "").trim();
    const id = (row["stop_id"] ?? "").trim();
    const latN = Number(lat);
    const lonN = Number(lon);
    if (lat === "" || Number.isNaN(latN) || latN < -90 || latN > 90) {
      issues.push({
        severity: "error",
        code: "invalid_stop_lat",
        message: `stops.txt stop_id="${id}" の stop_lat が不正です: "${lat}"`,
        entity: { type: "stops", id },
      });
    }
    if (lon === "" || Number.isNaN(lonN) || lonN < -180 || lonN > 180) {
      issues.push({
        severity: "error",
        code: "invalid_stop_lon",
        message: `stops.txt stop_id="${id}" の stop_lon が不正です: "${lon}"`,
        entity: { type: "stops", id },
      });
    }
  }
}

// --- 通過時刻 -------------------------------------------------------------
function checkStopTimes(feed: Feed, issues: ValidationIssue[]) {
  const rows = getRows(feed, "stop_times");
  if (rows.length === 0) return;

  // 時刻形式チェック
  for (const row of rows) {
    for (const key of ["arrival_time", "departure_time"]) {
      const v = (row[key] ?? "").trim();
      if (v !== "" && !isValidGtfsTime(v)) {
        issues.push({
          severity: "error",
          code: "invalid_time_format",
          message: `stop_times.txt trip_id="${row["trip_id"] ?? ""}" の ${key} が不正です: "${v}"`,
          entity: { type: "stop_times", id: (row["trip_id"] ?? "").trim(), field: key },
        });
      }
    }
  }

  // 便ごとに stop_sequence 昇順で時刻の単調性を検証
  const byTrip = new Map<string, Record<string, string>[]>();
  for (const row of rows) {
    const tid = (row["trip_id"] ?? "").trim();
    if (tid === "") continue;
    const arr = byTrip.get(tid) ?? [];
    arr.push(row);
    byTrip.set(tid, arr);
  }

  for (const [tid, list] of byTrip) {
    const sorted = [...list].sort(
      (a, b) => Number(a["stop_sequence"] ?? 0) - Number(b["stop_sequence"] ?? 0),
    );
    let prev = -1;
    for (const row of sorted) {
      const arr = (row["arrival_time"] ?? "").trim();
      const dep = (row["departure_time"] ?? "").trim();
      const arrSec = arr !== "" ? hmsToSec(arr) : null;
      const depSec = dep !== "" ? hmsToSec(dep) : null;
      if (arrSec !== null && depSec !== null && depSec < arrSec) {
        issues.push({
          severity: "error",
          code: "departure_before_arrival",
          message: `stop_times.txt trip_id="${tid}" stop_sequence=${row["stop_sequence"]} で発車が到着より前です`,
          entity: { type: "stop_times", id: tid, stop_sequence: row["stop_sequence"] },
        });
      }
      const cur = arrSec ?? depSec;
      if (cur !== null) {
        if (prev >= 0 && cur < prev) {
          issues.push({
            severity: "error",
            code: "stop_time_decreasing",
            message: `stop_times.txt trip_id="${tid}" stop_sequence=${row["stop_sequence"]} の時刻が前の停留所より前に戻っています`,
            entity: { type: "stop_times", id: tid, stop_sequence: row["stop_sequence"] },
          });
        }
        prev = Math.max(prev, cur);
      }
    }
  }
}

// --- GTFS-JP v4 固有の軽量検査 ------------------------------------------
function checkGtfsJpV4Rules(feed: Feed, profile: Profile, issues: ValidationIssue[]) {
  if (profile.id !== "gtfs-jp-v4") return;

  for (const row of getRows(feed, "feed_info")) {
    const lang = (row["feed_lang"] ?? "").trim();
    if (lang !== "" && lang !== "ja") {
      issues.push({
        severity: "warning",
        code: "jp_feed_lang_should_be_ja",
        message: `GTFS-JP v4 では feed_info.txt の feed_lang は "ja" を設定します: "${lang}"`,
        entity: { type: "feed_info", field: "feed_lang" },
      });
    }

    const start = dateToDayNumber((row["feed_start_date"] ?? "").trim());
    const end = dateToDayNumber((row["feed_end_date"] ?? "").trim());
    if (start !== null && end !== null) {
      if (end < start) {
        issues.push({
          severity: "error",
          code: "feed_period_reversed",
          message: "feed_info.txt の feed_end_date が feed_start_date より前です",
          entity: { type: "feed_info", field: "feed_end_date" },
        });
      } else {
        const days = end - start + 1;
        if (days <= 7) {
          issues.push({
            severity: "warning",
            code: "feed_period_too_short",
            message: `GTFS-JP v4 では有効期間が7日以下のデータセットは作成しないこととされています: ${days}日`,
            entity: { type: "feed_info", field: "feed_end_date", days },
          });
        } else if (days < 30) {
          issues.push({
            severity: "info",
            code: "feed_period_short",
            message: `GTFS-JP v4 では可能であれば有効期間30日以上が望ましいです: ${days}日`,
            entity: { type: "feed_info", field: "feed_end_date", days },
          });
        }
      }
    }
  }

  if (feed.tables.has("translations")) {
    const hasKana = getRows(feed, "translations").some(
      (row) => (row["language"] ?? "").trim() === "ja-Hrkt",
    );
    if (!hasKana) {
      issues.push({
        severity: "error",
        code: "missing_japanese_kana_translation",
        message: "GTFS-JP v4 では translations.txt に読み仮名（language=ja-Hrkt）の設定が必須です",
        entity: { type: "translations", field: "language" },
      });
    }
  }

  for (const row of getRows(feed, "fare_attributes")) {
    const price = Number((row["price"] ?? "").trim());
    if (Number.isFinite(price) && price < 0) {
      issues.push({
        severity: "error",
        code: "negative_fare_price",
        message: `fare_attributes.txt の price は0以上である必要があります: ${row["price"]}`,
        entity: { type: "fare_attributes", id: row["fare_id"] ?? "", field: "price" },
      });
    }
  }
}

// --- helpers --------------------------------------------------------------
function idSet(feed: Feed, table: string, key: string): Set<string> {
  const set = new Set<string>();
  for (const row of getRows(feed, table)) {
    const v = (row[key] ?? "").trim();
    if (v !== "") set.add(v);
  }
  return set;
}

function primaryKeyFor(table: string): string {
  return PRIMARY_KEYS.find((pk) => pk.table === table)?.key ?? `${table}_id`;
}
