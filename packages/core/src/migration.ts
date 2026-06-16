import { createFeed, setTable, type Feed, type FeedTable } from "./model.js";

export interface MigrationWarning {
  code: string;
  message: string;
  entity?: { type: string; id?: string; [k: string]: unknown };
}

export interface MigrationResult {
  feed: Feed;
  warnings: MigrationWarning[];
}

export interface MigrateToGtfsJpV4Options {
  /** v3由来の *_jp.txt をv4出力候補から除外する。既定は true。 */
  dropLegacyJpFiles?: boolean;
  /** 読み仮名がない停留所に stop_name を仮設定する。既定は true。 */
  fallbackKanaToStopName?: boolean;
  /**
   * feed_info の日付を calendar から導けない場合に使う基準日（`YYYYMMDD`）。
   * 未指定時は実行時の現在日付を使う。決定的な出力が必要な場合に指定する。
   */
  referenceDate?: string;
}

const LEGACY_JP_TABLES = ["agency_jp", "office_jp", "pattern_jp", "routes_jp"];

/**
 * 既存GTFS/GTFS-JP v3系フィードを、GTFS-JP v4固定路線バスMVPの検証に
 * かけられる形へ寄せる。意味的に推測できない値は警告を返す。
 */
export function migrateToGtfsJpV4(
  input: Feed,
  options: MigrateToGtfsJpV4Options = {},
): MigrationResult {
  const dropLegacy = options.dropLegacyJpFiles ?? true;
  const fallbackKana = options.fallbackKanaToStopName ?? true;
  const referenceDate = options.referenceDate ?? todayLikeDate();
  const feed = cloneFeed(input);
  const warnings: MigrationWarning[] = [];

  if (dropLegacy) dropLegacyJpTables(feed, warnings);

  normalizeAgency(feed, warnings);
  normalizeStops(feed, warnings);
  normalizeRoutes(feed, warnings);
  normalizeFeedInfo(feed, warnings, referenceDate);
  normalizeFareAttributes(feed, warnings);
  normalizeTranslations(feed, warnings, fallbackKana);

  return { feed, warnings };
}

function cloneFeed(input: Feed): Feed {
  const feed = createFeed();
  for (const [name, table] of input.tables) {
    setTable(
      feed,
      name,
      table.rows.map((r) => ({ ...r })),
      [...table.columns],
    );
  }
  return feed;
}

function dropLegacyJpTables(feed: Feed, warnings: MigrationWarning[]) {
  for (const name of LEGACY_JP_TABLES) {
    if (!feed.tables.has(name)) continue;
    feed.tables.delete(name);
    warnings.push({
      code: "dropped_legacy_jp_file",
      message: `${name}.txt はGTFS-JP v4本体仕様ではないため、v4出力候補から除外しました`,
      entity: { type: "file", id: name },
    });
  }
}

function normalizeAgency(feed: Feed, warnings: MigrationWarning[]) {
  const table = feed.tables.get("agency");
  if (!table) return;
  ensureColumns(table, ["agency_id", "agency_lang"]);
  table.rows.forEach((row, idx) => {
    if ((row["agency_id"] ?? "").trim() === "") {
      row["agency_id"] = table.rows.length === 1 ? "agency" : `agency_${idx + 1}`;
      warnings.push({
        code: "filled_agency_id",
        message: "agency_id が空だったため、自動IDを補完しました",
        entity: { type: "agency", id: row["agency_id"] },
      });
    }
    if ((row["agency_lang"] ?? "").trim() === "") row["agency_lang"] = "ja";
  });
}

function normalizeStops(feed: Feed, warnings: MigrationWarning[]) {
  const table = feed.tables.get("stops");
  if (!table) return;
  ensureColumns(table, ["location_type"]);
  for (const row of table.rows) {
    if ((row["location_type"] ?? "").trim() === "") row["location_type"] = "0";
    const stopId = (row["stop_id"] ?? "").trim();
    if ((row["stop_name"] ?? "").trim() === "") {
      warnings.push({
        code: "missing_stop_name",
        message: "stop_name が空の停留所があります。手動補正が必要です",
        entity: { type: "stops", id: stopId },
      });
    }
  }
}

function normalizeRoutes(feed: Feed, warnings: MigrationWarning[]) {
  const table = feed.tables.get("routes");
  if (!table) return;
  const agencyIds = feed.tables
    .get("agency")
    ?.rows.map((r) => (r["agency_id"] ?? "").trim())
    .filter((id) => id !== "");
  ensureColumns(table, ["agency_id"]);
  for (const row of table.rows) {
    if ((row["agency_id"] ?? "").trim() === "" && agencyIds?.length === 1) {
      row["agency_id"] = agencyIds[0]!;
      warnings.push({
        code: "filled_route_agency_id",
        message: "routes.agency_id が空だったため、単一agencyのIDを補完しました",
        entity: { type: "routes", id: row["route_id"] },
      });
    }
  }
}

function normalizeFeedInfo(feed: Feed, warnings: MigrationWarning[], referenceDate: string) {
  const calendarRows = feed.tables.get("calendar")?.rows ?? [];
  const startDate = minNonEmpty(calendarRows.map((r) => r["start_date"])) ?? referenceDate;
  const endDate = maxNonEmpty(calendarRows.map((r) => r["end_date"])) ?? startDate;

  const agency = feed.tables.get("agency")?.rows[0];
  const defaultRow = {
    feed_publisher_name: agency?.["agency_name"] ?? "unknown",
    feed_publisher_url: agency?.["agency_url"] ?? "https://example.com",
    feed_lang: "ja",
    feed_start_date: startDate,
    feed_end_date: endDate,
    feed_version: "v4-migrated",
  };

  const table = feed.tables.get("feed_info");
  if (!table) {
    setTable(feed, "feed_info", [defaultRow], Object.keys(defaultRow));
    warnings.push({
      code: "created_feed_info",
      message: "feed_info.txt がなかったため、agency/calendar から最小行を作成しました",
      entity: { type: "feed_info" },
    });
    return;
  }

  ensureColumns(table, Object.keys(defaultRow));
  if (table.rows.length === 0) table.rows.push({});
  for (const row of table.rows) {
    for (const [key, value] of Object.entries(defaultRow)) {
      if ((row[key] ?? "").trim() === "") row[key] = value;
    }
  }
}

function normalizeFareAttributes(feed: Feed, warnings: MigrationWarning[]) {
  const table = feed.tables.get("fare_attributes");
  if (table && table.rows.length > 0) return;

  setTable(
    feed,
    "fare_attributes",
    [
      {
        fare_id: "free",
        price: "0",
        currency_type: "JPY",
        payment_method: "0",
        transfers: "0",
      },
    ],
    ["fare_id", "price", "currency_type", "payment_method", "transfers"],
  );
  warnings.push({
    code: "created_free_fare",
    message: "fare_attributes.txt がなかったため、無償交通として最小運賃を作成しました。実運賃がある場合は修正してください",
    entity: { type: "fare_attributes", id: "free" },
  });
}

function normalizeTranslations(feed: Feed, warnings: MigrationWarning[], fallbackKana: boolean) {
  const stops = feed.tables.get("stops");
  if (!stops) return;

  const table = feed.tables.get("translations");
  const rows = table?.rows.map((r) => ({ ...r })) ?? [];
  const existing = new Set(
    rows
      .filter(
        (r) =>
          r["table_name"] === "stops" &&
          r["field_name"] === "stop_name" &&
          r["language"] === "ja-Hrkt",
      )
      .map((r) => r["record_id"] ?? ""),
  );

  for (const stop of stops.rows) {
    const stopId = (stop["stop_id"] ?? "").trim();
    if (stopId === "" || existing.has(stopId)) continue;
    const kana = firstNonEmpty([
      stop["stop_name_kana"],
      stop["name_kana"],
      stop["stop_kana"],
      stop["stop_name_yomi"],
      stop["stop_yomi"],
    ]);
    const fallback = (stop["stop_name"] ?? "").trim();
    if (!kana && !fallbackKana) {
      warnings.push({
        code: "missing_stop_kana",
        message: "停留所名の読み仮名を補完できませんでした",
        entity: { type: "stops", id: stopId },
      });
      continue;
    }
    rows.push({
      table_name: "stops",
      field_name: "stop_name",
      language: "ja-Hrkt",
      translation: kana ?? fallback,
      record_id: stopId,
    });
    if (!kana) {
      warnings.push({
        code: "fallback_stop_kana",
        message: "読み仮名が見つからないため、stop_nameを仮のja-Hrkt translationとして設定しました。公開前に要確認です",
        entity: { type: "stops", id: stopId },
      });
    }
  }

  // 既存の translations が持つ列（field_value / record_sub_id / en翻訳 等）を保持する。
  // 固定列だけで上書きすると、それらの値が出力時に欠落してしまう。
  const columns = [...(table?.columns ?? [])];
  for (const col of ["table_name", "field_name", "language", "translation", "record_id"]) {
    if (!columns.includes(col)) columns.push(col);
  }
  setTable(feed, "translations", rows, columns);
}

function ensureColumns(table: FeedTable, columns: string[]) {
  for (const col of columns) {
    if (!table.columns.includes(col)) table.columns.push(col);
  }
}

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const v = (value ?? "").trim();
    if (v !== "") return v;
  }
  return undefined;
}

function minNonEmpty(values: Array<string | undefined>): string | undefined {
  const list = values.map((v) => (v ?? "").trim()).filter((v) => v !== "");
  return list.length > 0 ? [...list].sort()[0] : undefined;
}

function maxNonEmpty(values: Array<string | undefined>): string | undefined {
  const list = values.map((v) => (v ?? "").trim()).filter((v) => v !== "");
  return list.length > 0 ? [...list].sort().at(-1) : undefined;
}

function todayLikeDate(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}
