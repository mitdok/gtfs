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
  /** 日付依存の公開ゲート検証に使う基準日（YYYYMMDD）。既定は実行日。 */
  validationDate?: string;
  /** 公開IDの大量変更を検出するための前版フィード。 */
  previousFeed?: Feed;
}

export function validateFeed(feed: Feed, options: ValidateOptions = {}): ValidationReport {
  const profileId = options.profileId ?? "gtfs-base";
  const profile = getProfile(profileId);
  const issues: ValidationIssue[] = [];

  checkRequiredFiles(feed, profile, issues);
  checkRecommendedFiles(feed, profile, issues);
  checkRequiredFields(feed, profile, issues);
  checkFieldTypes(feed, profile, issues);
  checkUniqueIds(feed, issues);
  checkReferences(feed, issues);
  checkCoordinates(feed, issues);
  checkStopTimes(feed, issues);
  checkCalendar(feed, issues);
  checkConditionalGtfsRules(feed, issues);
  if (profileId === "gtfs-jp-v4" || profileId === "google-transit-ready") {
    checkGtfsJpV4(feed, issues);
  }
  if (profileId === "google-transit-ready") {
    checkGoogleTransitReady(feed, issues, options);
  }

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

function checkFieldTypes(feed: Feed, profile: Profile, issues: ValidationIssue[]) {
  for (const file of profile.files) {
    const table = feed.tables.get(file.name);
    if (!table) continue;
    for (const field of file.fields) {
      if (!field.type || !table.columns.includes(field.name)) continue;
      for (const row of table.rows) {
        const value = (row[field.name] ?? "").trim();
        if (value === "") continue;
        const issue = validateTypedField(file.name, field.name, field.type, value, row);
        if (issue) issues.push(issue);
      }
    }
  }
}

function validateTypedField(
  table: string,
  field: string,
  type: string,
  value: string,
  row: Record<string, string>,
): ValidationIssue | undefined {
  if (type === "url" && !isHttpUrl(value)) {
    return invalidValue(table, rowId(row), field, value, "invalid_url", "http/https URLではありません");
  }
  if (type === "timezone" && !isValidTimeZone(value)) {
    return invalidValue(table, rowId(row), field, value, "invalid_timezone", "IANAタイムゾーンではありません");
  }
  if (type === "language" && !isValidLanguageTag(value)) {
    return invalidValue(table, rowId(row), field, value, "invalid_language", "言語タグではありません");
  }
  if (type === "integer" && !/^\d+$/.test(value)) {
    return invalidValue(table, rowId(row), field, value, "invalid_integer", "整数ではありません");
  }
  if (type === "latitude" && !isNumberInRange(value, -90, 90)) {
    return invalidValue(table, rowId(row), field, value, "invalid_latitude", "緯度の範囲外です");
  }
  if (type === "longitude" && !isNumberInRange(value, -180, 180)) {
    return invalidValue(table, rowId(row), field, value, "invalid_longitude", "経度の範囲外です");
  }
  if (type === "date" && !isValidGtfsDate(value)) {
    return invalidValue(table, rowId(row), field, value, "invalid_date_format", "YYYYMMDDではありません");
  }
  if (type === "enum") {
    return validateKnownEnum(table, field, value, row);
  }
  return undefined;
}

function validateKnownEnum(
  table: string,
  field: string,
  value: string,
  row: Record<string, string>,
): ValidationIssue | undefined {
  const allowed = enumValuesFor(table, field);
  if (!allowed) return /^\d+$/.test(value) ? undefined : invalidValue(table, rowId(row), field, value, "invalid_enum", "数値enumではありません");
  if (allowed.includes(value)) return undefined;
  return invalidValue(table, rowId(row), field, value, "invalid_enum", `許容値（${allowed.join(",")}）ではありません`);
}

function enumValuesFor(table: string, field: string): string[] | undefined {
  if (table === "stops" && field === "location_type") return ["0", "1", "2", "3", "4"];
  if (table === "routes" && field === "route_type") return ["0", "1", "2", "3", "4", "5", "6", "7", "11", "12"];
  return undefined;
}

function invalidValue(
  table: string,
  id: string,
  field: string,
  value: string,
  code: string,
  reason: string,
): ValidationIssue {
  return {
    severity: "error",
    code,
    message: `${table}.txt ${id ? `id="${id}" ` : ""}の ${field}="${value}" は不正です（${reason}）`,
    entity: { type: table, id, field, value },
  };
}

function rowId(row: Record<string, string>): string {
  return (
    row["agency_id"] ??
    row["stop_id"] ??
    row["route_id"] ??
    row["trip_id"] ??
    row["service_id"] ??
    row["fare_id"] ??
    ""
  ).trim();
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function isValidLanguageTag(value: string): boolean {
  try {
    Intl.getCanonicalLocales(value);
    return true;
  } catch {
    return false;
  }
}

function isNumberInRange(value: string, min: number, max: number): boolean {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max;
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
  const shapeIds = idSet(feed, "shapes", "shape_id");
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
    const shapeId = (row["shape_id"] ?? "").trim();
    if (shapeId !== "" && shapeIds.size > 0 && !shapeIds.has(shapeId)) {
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
  checkGtfsJpV4ForbiddenFields(feed, issues);
  checkGtfsJpV4Shapes(feed, issues);
  checkGtfsJpTranslations(feed, issues);
  checkGtfsJpFareAttributes(feed, issues);
  checkGtfsJpAttributions(feed, issues);
  checkGtfsJpTransfers(feed, issues);
  checkGtfsJpOptionalValueFormats(feed, issues);
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

function checkGtfsJpV4ForbiddenFields(feed: Feed, issues: ValidationIssue[]) {
  for (const { table, fields } of [
    {
      table: "routes",
      fields: ["continuous_pickup", "continuous_drop_off", "network_id"],
    },
    {
      table: "stop_times",
      fields: ["location_group_id", "location_id", "continuous_pickup", "continuous_drop_off"],
    },
  ]) {
    for (const row of getRows(feed, table)) {
      const id = row["route_id"] ?? row["trip_id"] ?? "";
      for (const field of fields) {
        const value = (row[field] ?? "").trim();
        if (value === "") continue;
        issues.push({
          severity: "error",
          code: "forbidden_v4_fixed_route_field",
          message: `${table}.txt の ${field} はGTFS-JP v4固定路線MVPでは使用できません`,
          entity: { type: table, id: id.trim(), field, value },
        });
      }
    }
  }

  const hasRouteNetworkId = getRows(feed, "routes").some(
    (row) => (row["network_id"] ?? "").trim() !== "",
  );
  if (!hasRouteNetworkId) return;
  for (const name of ["networks", "route_networks"]) {
    if (!feed.tables.has(name)) continue;
    issues.push({
      severity: "error",
      code: "forbidden_v4_network_file",
      message: `routes.network_id を使う場合、GTFS-JP v4では ${name}.txt を含められません`,
      entity: { type: "file", id: name },
    });
  }
}

function checkGtfsJpV4Shapes(feed: Feed, issues: ValidationIssue[]) {
  const shapes = feed.tables.get("shapes");
  if (!shapes || shapes.rows.length === 0) return;

  for (const row of getRows(feed, "trips")) {
    if ((row["shape_id"] ?? "").trim() !== "") continue;
    issues.push({
      severity: "error",
      code: "missing_trip_shape_id",
      message: `shapes.txt を出力する場合、trips.txt trip_id="${row["trip_id"] ?? ""}" の shape_id が必要です`,
      entity: { type: "trips", id: (row["trip_id"] ?? "").trim(), field: "shape_id" },
    });
  }

  const byShape = new Map<string, Set<string>>();
  for (const row of shapes.rows) {
    const id = (row["shape_id"] ?? "").trim();
    const seq = (row["shape_pt_sequence"] ?? "").trim();
    const lat = (row["shape_pt_lat"] ?? "").trim();
    const lon = (row["shape_pt_lon"] ?? "").trim();
    const latN = Number(lat);
    const lonN = Number(lon);
    if (lat === "" || Number.isNaN(latN) || latN < -90 || latN > 90) {
      issues.push({
        severity: "error",
        code: "invalid_shape_pt_lat",
        message: `shapes.txt shape_id="${id}" の shape_pt_lat が不正です: "${lat}"`,
        entity: { type: "shapes", id, field: "shape_pt_lat", sequence: seq },
      });
    }
    if (lon === "" || Number.isNaN(lonN) || lonN < -180 || lonN > 180) {
      issues.push({
        severity: "error",
        code: "invalid_shape_pt_lon",
        message: `shapes.txt shape_id="${id}" の shape_pt_lon が不正です: "${lon}"`,
        entity: { type: "shapes", id, field: "shape_pt_lon", sequence: seq },
      });
    }
    const seen = byShape.get(id) ?? new Set<string>();
    if (seq !== "" && seen.has(seq)) {
      issues.push({
        severity: "error",
        code: "duplicate_shape_pt_sequence",
        message: `shapes.txt shape_id="${id}" で shape_pt_sequence=${seq} が重複しています`,
        entity: { type: "shapes", id, sequence: seq },
      });
    }
    if (seq !== "") seen.add(seq);
    byShape.set(id, seen);
  }
}

function checkGtfsJpTranslations(feed: Feed, issues: ValidationIssue[]) {
  const translations = getRows(feed, "translations");
  if (translations.length === 0) return;

  const stopKanaIds = new Set<string>();
  const stopKanaFieldValues = new Set<string>();
  for (const row of translations) {
    const recordId = (row["record_id"] ?? "").trim();
    const fieldValue = (row["field_value"] ?? "").trim();
    if (recordId === "" && fieldValue === "") {
      issues.push({
        severity: "error",
        code: "missing_translation_record_key",
        message: "translations.txt は record_id または field_value のどちらかで対象レコードを指定してください",
        entity: { type: "translations", table_name: row["table_name"], field_name: row["field_name"] },
      });
    }
    if (
      (row["table_name"] ?? "").trim() === "stops" &&
      (row["field_name"] ?? "").trim() === "stop_name" &&
      (row["language"] ?? "").trim() === "ja-Hrkt"
    ) {
      if (recordId !== "") stopKanaIds.add(recordId);
      if (fieldValue !== "") stopKanaFieldValues.add(fieldValue);
    }
  }

  const missing: string[] = [];
  for (const row of getRows(feed, "stops")) {
    const id = (row["stop_id"] ?? "").trim();
    const name = (row["stop_name"] ?? "").trim();
    if (id !== "" && !stopKanaIds.has(id) && !stopKanaFieldValues.has(name)) missing.push(id);
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
    const paymentMethod = (row["payment_method"] ?? "").trim();
    if (paymentMethod !== "" && paymentMethod !== "0" && paymentMethod !== "1") {
      issues.push({
        severity: "error",
        code: "invalid_fare_payment_method",
        message: `fare_attributes.txt fare_id="${id}" の payment_method は 0 か 1 です`,
        entity: { type: "fare_attributes", id, field: "payment_method" },
      });
    }
    const transfers = (row["transfers"] ?? "").trim();
    if (transfers !== "" && transfers !== "0" && transfers !== "1" && transfers !== "2") {
      issues.push({
        severity: "error",
        code: "invalid_fare_transfers",
        message: `fare_attributes.txt fare_id="${id}" の transfers は 0、1、2、または空欄です`,
        entity: { type: "fare_attributes", id, field: "transfers" },
      });
    }
  }
}

function checkGtfsJpAttributions(feed: Feed, issues: ValidationIssue[]) {
  for (const row of getRows(feed, "attributions")) {
    const hasRole = ["is_producer", "is_operator", "is_authority"].some(
      (key) => (row[key] ?? "").trim() === "1",
    );
    if (hasRole) continue;
    issues.push({
      severity: "error",
      code: "missing_attribution_role",
      message: "attributions.txt は is_producer / is_operator / is_authority のいずれかで役割を指定してください",
      entity: { type: "attributions", id: (row["attribution_id"] ?? row["organization_name"] ?? "").trim() },
    });
  }
}

function checkGtfsJpTransfers(feed: Feed, issues: ValidationIssue[]) {
  for (const row of getRows(feed, "transfers")) {
    const stopPair =
      (row["from_stop_id"] ?? "").trim() !== "" && (row["to_stop_id"] ?? "").trim() !== "";
    const tripPair =
      (row["from_trip_id"] ?? "").trim() !== "" && (row["to_trip_id"] ?? "").trim() !== "";
    if (!stopPair && !tripPair) {
      issues.push({
        severity: "error",
        code: "missing_transfer_endpoint",
        message: "transfers.txt は from/to の stop または trip の組を指定してください",
        entity: { type: "transfers", id: (row["from_stop_id"] ?? row["from_trip_id"] ?? "").trim() },
      });
    }
    const type = (row["transfer_type"] ?? "").trim();
    if (type !== "" && !["0", "1", "2", "3", "4", "5"].includes(type)) {
      issues.push({
        severity: "error",
        code: "invalid_transfer_type",
        message: `transfers.txt の transfer_type が不正です: "${type}"`,
        entity: { type: "transfers", field: "transfer_type", value: type },
      });
    }
  }
}

function checkGtfsJpOptionalValueFormats(feed: Feed, issues: ValidationIssue[]) {
  for (const row of getRows(feed, "routes")) {
    const id = (row["route_id"] ?? "").trim();
    for (const field of ["route_color", "route_text_color"] as const) {
      const value = (row[field] ?? "").trim();
      if (value !== "" && !/^[0-9A-Fa-f]{6}$/.test(value)) {
        issues.push(invalidValue("routes", id, field, value, "invalid_color", "6桁hex（#なし）ではありません"));
      }
    }
  }

  checkOptionalEnum(feed, issues, "stops", "stop_id", "wheelchair_boarding", ["0", "1", "2"]);
  checkOptionalEnum(feed, issues, "trips", "trip_id", "wheelchair_accessible", ["0", "1", "2"]);
  checkOptionalEnum(feed, issues, "stop_times", "trip_id", "pickup_type", ["0", "1", "2", "3"]);
  checkOptionalEnum(feed, issues, "stop_times", "trip_id", "drop_off_type", ["0", "1", "2", "3"]);
  checkOptionalEnum(feed, issues, "stop_times", "trip_id", "timepoint", ["0", "1"]);
}

function checkOptionalEnum(
  feed: Feed,
  issues: ValidationIssue[],
  table: string,
  idField: string,
  field: string,
  allowed: string[],
) {
  for (const row of getRows(feed, table)) {
    const value = (row[field] ?? "").trim();
    if (value === "" || allowed.includes(value)) continue;
    issues.push(invalidValue(table, (row[idField] ?? "").trim(), field, value, "invalid_enum", `許容値（${allowed.join(",")}）ではありません`));
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

const GOOGLE_EXPIRY_SOON_DAYS = 30;

function checkGoogleTransitReady(
  feed: Feed,
  issues: ValidationIssue[],
  options: ValidateOptions,
) {
  checkGoogleShapes(feed, issues);
  checkGoogleTripHeadsigns(feed, issues);
  checkGoogleFeedExpiry(feed, issues, options.validationDate ?? todayLikeDate());
  checkGoogleContact(feed, issues);
  if (options.previousFeed) checkStablePublicIds(options.previousFeed, feed, issues);
}

function checkGoogleShapes(feed: Feed, issues: ValidationIssue[]) {
  const hasBusRoute = getRows(feed, "routes").some((row) => (row["route_type"] ?? "").trim() === "3");
  const hasShapes = (feed.tables.get("shapes")?.rows.length ?? 0) > 0;
  if (!hasBusRoute || hasShapes) return;
  issues.push({
    severity: "warning",
    code: "missing_shape_recommended",
    message: "Google申請向けにはバス路線の shapes.txt 設定を推奨します",
    entity: { type: "file", id: "shapes" },
  });
}

function checkGoogleTripHeadsigns(feed: Feed, issues: ValidationIssue[]) {
  const missing = getRows(feed, "trips").filter((row) => (row["trip_headsign"] ?? "").trim() === "");
  if (missing.length === 0) return;
  issues.push({
    severity: "warning",
    code: "missing_trip_headsign",
    message: `trip_headsign がない便が ${missing.length} 件あります`,
    entity: { type: "trips", count: missing.length, sample: missing.slice(0, 5).map((r) => r["trip_id"]) },
  });
}

function checkGoogleFeedExpiry(feed: Feed, issues: ValidationIssue[], validationDate: string) {
  if (!isValidGtfsDate(validationDate)) return;
  const end = effectiveFeedEndDate(feed);
  if (!end) return;
  if (end < validationDate) {
    issues.push({
      severity: "error",
      code: "feed_expired",
      message: `サービス期間が終了しています（最終日: ${end}）`,
      entity: { type: "feed", field: "feed_end_date", value: end },
    });
    return;
  }
  if (end <= addDays(validationDate, GOOGLE_EXPIRY_SOON_DAYS)) {
    issues.push({
      severity: "warning",
      code: "feed_expired_soon",
      message: `サービス期間の終了が近いです（最終日: ${end}）`,
      entity: { type: "feed", field: "feed_end_date", value: end },
    });
  }
}

function effectiveFeedEndDate(feed: Feed): string | undefined {
  const dates: string[] = [];
  for (const row of getRows(feed, "feed_info")) {
    const v = (row["feed_end_date"] ?? "").trim();
    if (isValidGtfsDate(v)) dates.push(v);
  }
  for (const row of getRows(feed, "calendar")) {
    const v = (row["end_date"] ?? "").trim();
    if (isValidGtfsDate(v)) dates.push(v);
  }
  return dates.length > 0 ? dates.sort()[0] : undefined;
}

function checkGoogleContact(feed: Feed, issues: ValidationIssue[]) {
  const hasAgencyContact = getRows(feed, "agency").some(
    (row) =>
      (row["agency_phone"] ?? "").trim() !== "" ||
      (row["agency_email"] ?? "").trim() !== "" ||
      (row["agency_fare_url"] ?? "").trim() !== "",
  );
  const hasFeedContact = getRows(feed, "feed_info").some(
    (row) =>
      (row["feed_contact_email"] ?? "").trim() !== "" ||
      (row["feed_contact_url"] ?? "").trim() !== "",
  );
  if (hasAgencyContact || hasFeedContact) return;
  issues.push({
    severity: "warning",
    code: "missing_contact",
    message: "Google申請向けには agency または feed_info に問い合わせ先を設定してください",
    entity: { type: "feed_info" },
  });
}

function checkStablePublicIds(previous: Feed, current: Feed, issues: ValidationIssue[]) {
  for (const { table, key } of [
    { table: "agency", key: "agency_id" },
    { table: "routes", key: "route_id" },
    { table: "stops", key: "stop_id" },
  ]) {
    const before = idSet(previous, table, key);
    const after = idSet(current, table, key);
    if (before.size < 5 || after.size === 0) continue;
    let retained = 0;
    for (const id of after) if (before.has(id)) retained++;
    const retainedRatio = retained / after.size;
    if (retainedRatio >= 0.8) continue;
    issues.push({
      severity: "warning",
      code: "unstable_public_ids",
      message: `${table}.txt の公開ID継続率が低いです（${retained}/${after.size}件）。利用者アプリ側の履歴追跡に影響します`,
      entity: { type: table, field: key, retained, current: after.size },
    });
  }
}

function addDays(date: string, days: number): string {
  const d = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8))));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function todayLikeDate(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
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
