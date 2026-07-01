#!/usr/bin/env node
/**
 * GTFS zip を回帰用に匿名化する補助CLI。
 *
 * 既定では参照整合を守るため *_id と緯度経度は保持し、名称・URL・電話・メール等を
 * 決定的なダミー値へ置換する。座標は必要な場合だけ --jitter-meters でずらす。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { exportToZip, importGtfsZip } from "../packages/core/dist/index.js";

const TEXT_FIELDS = new Set([
  "agency_name",
  "stop_name",
  "stop_desc",
  "zone_id",
  "route_short_name",
  "route_long_name",
  "route_desc",
  "trip_headsign",
  "stop_headsign",
  "feed_publisher_name",
  "feed_contact_email",
  "feed_contact_url",
  "translation",
  "tts_stop_name",
  "attribution_organization_name",
  "attribution_email",
  "attribution_phone",
  "attribution_url",
]);

const URL_FIELDS = new Set([
  "agency_url",
  "route_url",
  "stop_url",
  "feed_publisher_url",
  "feed_contact_url",
  "attribution_url",
]);

const EMAIL_FIELDS = new Set(["agency_email", "feed_contact_email", "attribution_email"]);
const PHONE_FIELDS = new Set(["agency_phone", "attribution_phone"]);
const LAT_FIELDS = new Set(["stop_lat", "shape_pt_lat"]);
const LON_FIELDS = new Set(["stop_lon", "shape_pt_lon"]);

function parseArgs(argv) {
  const opts = { report: undefined, jitterMeters: 0 };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;
    if (a === "--report") opts.report = argv[++i];
    else if (a === "--jitter-meters") opts.jitterMeters = Number(argv[++i]);
    else if (a === "--seed") opts.seed = argv[++i];
    else if (a.startsWith("--")) throw new Error(`unknown option: ${a}`);
    else positional.push(a);
  }
  opts.input = positional[0];
  opts.output = positional[1];
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.input || !opts.output) {
  console.error("usage: pnpm gtfs:anonymize <input.zip> <output.zip> [--report report.json] [--jitter-meters n] [--seed text]");
  process.exit(2);
}
if (!Number.isFinite(opts.jitterMeters) || opts.jitterMeters < 0 || opts.jitterMeters > 10_000) {
  console.error("--jitter-meters は 0〜10000 の数値で指定してください。");
  process.exit(2);
}

const inputPath = resolve(opts.input);
const outputPath = resolve(opts.output);
const reportPath = opts.report ? resolve(opts.report) : undefined;
const imported = importGtfsZip(new Uint8Array(readFileSync(inputPath)));
const seed = opts.seed ?? hash(inputPath).slice(0, 12);
const stats = {
  input: inputPath,
  output: outputPath,
  seed,
  jitterMeters: opts.jitterMeters,
  tables: {},
  changedCells: 0,
  coordinateCells: 0,
  warnings: [
    "This tool reduces obvious identifying text/contact fields for regression use, but does not prove legal anonymization.",
    "IDs are preserved by default to avoid breaking GTFS references.",
  ],
};

for (const table of imported.feed.tables.values()) {
  const tableStats = { rows: table.rows.length, changedCells: 0, coordinateCells: 0, fields: {} };
  for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex++) {
    const row = table.rows[rowIndex];
    for (const column of table.columns) {
      const value = row[column];
      if (value === undefined || value === "") continue;
      let next = value;
      if (EMAIL_FIELDS.has(column)) next = `contact+${stableToken(table.name, column, value)}@example.invalid`;
      else if (PHONE_FIELDS.has(column)) next = "000-0000-0000";
      else if (URL_FIELDS.has(column)) next = `https://example.com/gtfs/${stableToken(table.name, column, value)}`;
      else if (TEXT_FIELDS.has(column)) next = anonymizedText(table.name, column, value);
      else if (opts.jitterMeters > 0 && (LAT_FIELDS.has(column) || LON_FIELDS.has(column))) {
        next = jitterCoordinate(table.name, rowIndex, column, value, seed, opts.jitterMeters);
        if (next !== value) {
          tableStats.coordinateCells++;
          stats.coordinateCells++;
        }
      }
      if (next !== value) {
        row[column] = next;
        tableStats.changedCells++;
        stats.changedCells++;
        tableStats.fields[column] = (tableStats.fields[column] ?? 0) + 1;
      }
    }
  }
  if (tableStats.changedCells > 0 || tableStats.coordinateCells > 0) {
    stats.tables[table.name] = tableStats;
  }
}

await mkdir(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, exportToZip(imported.feed));
if (reportPath) {
  await mkdir(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(stats, null, 2) + "\n");
}
console.log(JSON.stringify(stats, null, 2));

function anonymizedText(table, column, value) {
  const token = stableToken(table, column, value);
  if (column === "route_short_name") return `R${token.slice(0, 4).toUpperCase()}`;
  if (column === "zone_id") return `zone_${token.slice(0, 6)}`;
  if (column === "trip_headsign" || column === "stop_headsign") return `HeadSign ${token.slice(0, 6)}`;
  if (column === "translation") return `Text ${token.slice(0, 6)}`;
  return `${labelFor(column)} ${token.slice(0, 6)}`;
}

function labelFor(column) {
  if (column.includes("stop")) return "Stop";
  if (column.includes("route")) return "Route";
  if (column.includes("agency")) return "Agency";
  if (column.includes("feed")) return "Publisher";
  if (column.includes("attribution")) return "Attribution";
  return "Text";
}

function stableToken(table, column, value) {
  return hash(`${table}:${column}:${value}`);
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function jitterCoordinate(table, rowIndex, column, value, seed, meters) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  const sign = hash(`${seed}:${table}:${rowIndex}:${column}`).charCodeAt(0) % 2 === 0 ? 1 : -1;
  const fraction = parseInt(hash(`${seed}:${table}:${rowIndex}:${column}`).slice(0, 8), 16) / 0xffffffff;
  const offsetMeters = sign * meters * fraction;
  const degrees = offsetMeters / 111_320;
  const next = n + degrees;
  return next.toFixed(6);
}
