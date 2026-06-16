/**
 * 構造・整合性バリデーション（仕様書 06 章の層1・層2の中核サブセット）。
 *
 * MVP の狙いは「取り込んだ実データを編集して再出力したものが、最低限の整合性を
 * 満たすことを保証する」こと。標準バリデータ（層3）はこの後段に置く想定で、
 * ここでは編集UIに即時フィードバックできる軽量・自前ルールを実装する。
 */
import { getRows, type Feed } from "./model.js";
import { getProfile, type Profile } from "./profile.js";
import { isValidGtfsTime, isValidGtfsDate, hmsToSec } from "./time.js";

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
  const profileId = options.profileId ?? "gtfs-base";
  const profile = getProfile(profileId);
  const issues: ValidationIssue[] = [];

  checkRequiredFiles(feed, profile, issues);
  checkRecommendedFiles(feed, profile, issues);
  checkRequiredFields(feed, profile, issues);
  checkUniqueIds(feed, issues);
  checkReferences(feed, issues);
  checkCoordinates(feed, issues);
  checkStopTimes(feed, issues);
  checkCalendar(feed, issues);
  checkConditionalGtfsRules(feed, issues);
  if (profileId === "gtfs-jp-v4") checkGtfsJpV4(feed, issues);

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
    } else if (file.required && feed.tables.get(file.name)?.rows.length === 0) {
      issues.push({
        severity: "error",
        code: "empty_required_file",
        message: `必須ファイル ${file.name}.txt にデータ行がありません`,
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

// --- 推奨ファイル ---------------------------------------------------------
// プロファイルの presence="recommended" は今まで未使用だった。欠落を warning にする。
function checkRecommendedFiles(feed: Feed, profile: Profile, issues: ValidationIssue[]) {
  for (const file of profile.files) {
    if (file.presence === "recommended" && !feed.tables.has(file.name)) {
      issues.push({
        severity: "warning",
        code: "missing_recommended_file",
        message: `推奨ファイル ${file.name}.txt がありません`,
        entity: { type: "file", id: file.name },
      });
    }
  }
}

function checkConditionalGtfsRules(feed: Feed, issues: ValidationIssue[]) {
  // GTFS: routes.route_short_name と route_long_name は少なくとも一方が必要。
  for (const row of getRows(feed, "routes")) {
    const id = (row["route_id"] ?? "").trim();
    const shortName = (row["route_short_name"] ?? "").trim();
    const longName = (row["route_long_name"] ?? "").trim();
    if (shortName === "" && longName === "") {
      issues.push({
        severity: "error",
        code: "missing_route_name",
        message: `routes.txt route_id="${id}" は route_short_name または route_long_name の少なくとも一方が必要です`,
        entity: { type: "routes", id },
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

// --- 主キー一意性 ---------------------------------------------------------
const PRIMARY_KEYS: { table: string; key: string }[] = [
  { table: "agency", key: "agency_id" },
  { table: "stops", key: "stop_id" },
  { table: "routes", key: "route_id" },
  { table: "trips", key: "trip_id" },
  { table: "calendar", key: "service_id" },
  { table: "fare_attributes", key: "fare_id" },
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
  const serviceIds = new Set<string>([
    ...idSet(feed, "calendar", "service_id"),
    ...idSet(feed, "calendar_dates", "service_id"),
  ]);
  const fareIds = idSet(feed, "fare_attributes", "fare_id");

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
  // fare_rules.fare_id -> fare_attributes
  for (const row of getRows(feed, "fare_rules")) {
    const fid = (row["fare_id"] ?? "").trim();
    if (fid !== "" && !fareIds.has(fid)) {
      issues.push(ref("fare_rules", "fare_id", row, "fare_id", fid, "fare_attributes"));
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

    // stop_sequence は trip 内で一意（GTFS 仕様）。重複を検出する。
    const seenSeq = new Set<string>();
    const dupSeq = new Set<string>();
    for (const row of sorted) {
      const seq = (row["stop_sequence"] ?? "").trim();
      if (seq === "") continue;
      if (seenSeq.has(seq)) dupSeq.add(seq);
      else seenSeq.add(seq);
    }
    for (const seq of dupSeq) {
      issues.push({
        severity: "error",
        code: "duplicate_stop_sequence",
        message: `stop_times.txt trip_id="${tid}" で stop_sequence=${seq} が重複しています`,
        entity: { type: "stop_times", id: tid, stop_sequence: seq },
      });
    }

    // 時刻の単調性。次停留所の到着は直前停留所の「発車」以降であること（停車時間考慮）。
    let prevDep = -1;
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
        if (prevDep >= 0 && cur < prevDep) {
          issues.push({
            severity: "error",
            code: "stop_time_decreasing",
            message: `stop_times.txt trip_id="${tid}" stop_sequence=${row["stop_sequence"]} の時刻が前の停留所より前に戻っています`,
            entity: { type: "stop_times", id: tid, stop_sequence: row["stop_sequence"] },
          });
        }
        prevDep = Math.max(prevDep, depSec ?? cur);
      }
    }
  }
}

// --- カレンダー（運行区分） -------------------------------------------------
const CALENDAR_DAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

function checkCalendar(feed: Feed, issues: ValidationIssue[]) {
  // calendar_dates の追加日（exception_type=1）を持つ service を把握しておく。
  // 全曜日0の calendar でも、追加日があれば「空サービス」ではない。
  const additiveServices = new Set<string>();
  for (const row of getRows(feed, "calendar_dates")) {
    if ((row["exception_type"] ?? "").trim() === "1") {
      const sid = (row["service_id"] ?? "").trim();
      if (sid !== "") additiveServices.add(sid);
    }
  }

  const calendar = feed.tables.get("calendar");
  if (calendar) {
    for (const row of calendar.rows) {
      const sid = (row["service_id"] ?? "").trim();

      for (const key of ["start_date", "end_date"] as const) {
        const v = (row[key] ?? "").trim();
        if (v !== "" && !isValidGtfsDate(v)) {
          issues.push({
            severity: "error",
            code: "invalid_date_format",
            message: `calendar.txt service_id="${sid}" の ${key} が YYYYMMDD ではありません: "${v}"`,
            entity: { type: "calendar", id: sid, field: key },
          });
        }
      }
      const start = (row["start_date"] ?? "").trim();
      const end = (row["end_date"] ?? "").trim();
      if (isValidGtfsDate(start) && isValidGtfsDate(end) && end < start) {
        issues.push({
          severity: "error",
          code: "calendar_end_before_start",
          message: `calendar.txt service_id="${sid}" の end_date が start_date より前です`,
          entity: { type: "calendar", id: sid },
        });
      }

      let allZero = true;
      for (const day of CALENDAR_DAY_KEYS) {
        const v = (row[day] ?? "").trim();
        if (v !== "" && v !== "0" && v !== "1") {
          issues.push({
            severity: "error",
            code: "invalid_calendar_day_flag",
            message: `calendar.txt service_id="${sid}" の ${day} は 0 か 1 で指定してください: "${v}"`,
            entity: { type: "calendar", id: sid, field: day },
          });
        }
        if (v !== "0") allZero = false;
      }
      // 全曜日0かつ追加日もない service は、どの日にも運行しない空サービス（仕様 6.5）。
      if (allZero && !additiveServices.has(sid)) {
        issues.push({
          severity: "error",
          code: "service_empty",
          message: `calendar.txt service_id="${sid}" は全曜日0かつ calendar_dates の追加日もありません（どの日も運行しません）`,
          entity: { type: "calendar", id: sid },
        });
      }
    }
  }

  for (const row of getRows(feed, "calendar_dates")) {
    const sid = (row["service_id"] ?? "").trim();
    const date = (row["date"] ?? "").trim();
    if (date !== "" && !isValidGtfsDate(date)) {
      issues.push({
        severity: "error",
        code: "invalid_date_format",
        message: `calendar_dates.txt service_id="${sid}" の date が YYYYMMDD ではありません: "${date}"`,
        entity: { type: "calendar_dates", id: sid, field: "date" },
      });
    }
    const et = (row["exception_type"] ?? "").trim();
    if (et !== "" && et !== "1" && et !== "2") {
      issues.push({
        severity: "error",
        code: "invalid_exception_type",
        message: `calendar_dates.txt service_id="${sid}" の exception_type は 1（追加）か 2（削除）です: "${et}"`,
        entity: { type: "calendar_dates", id: sid, field: "exception_type" },
      });
    }
  }
}

function checkGtfsJpV4(feed: Feed, issues: ValidationIssue[]) {
  checkLegacyJpFiles(feed, issues);
  checkGtfsJpTranslations(feed, issues);
  checkGtfsJpFareAttributes(feed, issues);
  checkFeedInfoDates(feed, issues);
}

const LEGACY_JP_FILES = ["agency_jp", "office_jp", "pattern_jp", "routes_jp"];

function checkLegacyJpFiles(feed: Feed, issues: ValidationIssue[]) {
  for (const name of LEGACY_JP_FILES) {
    if (!feed.tables.has(name)) continue;
    issues.push({
      severity: "warning",
      code: "legacy_jp_file",
      message: `${name}.txt はGTFS-JP v4本体仕様ではなく、v3互換・参考扱いです`,
      entity: { type: "file", id: name },
    });
  }
}

function checkGtfsJpTranslations(feed: Feed, issues: ValidationIssue[]) {
  const translations = getRows(feed, "translations");
  if (translations.length === 0) return;

  const stopKanaIds = new Set<string>();
  for (const row of translations) {
    if (
      (row["table_name"] ?? "").trim() === "stops" &&
      (row["field_name"] ?? "").trim() === "stop_name" &&
      (row["language"] ?? "").trim() === "ja-Hrkt"
    ) {
      const id = (row["record_id"] ?? "").trim();
      if (id !== "") stopKanaIds.add(id);
    }
  }

  const missing: string[] = [];
  for (const row of getRows(feed, "stops")) {
    const id = (row["stop_id"] ?? "").trim();
    if (id !== "" && !stopKanaIds.has(id)) missing.push(id);
  }
  if (missing.length > 0) {
    issues.push({
      severity: "error",
      code: "missing_stop_name_kana",
      message: `translations.txt に停留所名の読み仮名（language=ja-Hrkt）がない停留所が ${missing.length} 件あります`,
      entity: { type: "translations", count: missing.length, sample: missing.slice(0, 5) },
    });
  }
}

function checkGtfsJpFareAttributes(feed: Feed, issues: ValidationIssue[]) {
  for (const row of getRows(feed, "fare_attributes")) {
    const id = (row["fare_id"] ?? "").trim();
    const price = Number((row["price"] ?? "").trim());
    if (!Number.isFinite(price) || price < 0) {
      issues.push({
        severity: "error",
        code: "invalid_fare_price",
        message: `fare_attributes.txt fare_id="${id}" の price が不正です`,
        entity: { type: "fare_attributes", id, field: "price" },
      });
    }
    const currency = (row["currency_type"] ?? "").trim();
    if (currency !== "JPY") {
      issues.push({
        severity: "warning",
        code: "non_jpy_fare_currency",
        message: `fare_attributes.txt fare_id="${id}" の currency_type が JPY ではありません`,
        entity: { type: "fare_attributes", id, field: "currency_type" },
      });
    }
  }
}

function checkFeedInfoDates(feed: Feed, issues: ValidationIssue[]) {
  for (const row of getRows(feed, "feed_info")) {
    const start = (row["feed_start_date"] ?? "").trim();
    const end = (row["feed_end_date"] ?? "").trim();
    for (const [key, v] of [
      ["feed_start_date", start],
      ["feed_end_date", end],
    ] as const) {
      if (v !== "" && !isValidGtfsDate(v)) {
        issues.push({
          severity: "error",
          code: "invalid_date_format",
          message: `feed_info.txt の ${key} が YYYYMMDD ではありません: "${v}"`,
          entity: { type: "feed_info", field: key },
        });
      }
    }
    if (isValidGtfsDate(start) && isValidGtfsDate(end) && end < start) {
      issues.push({
        severity: "error",
        code: "feed_info_date_range",
        message: "feed_info.txt の feed_end_date が feed_start_date より前です",
        entity: { type: "feed_info" },
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
