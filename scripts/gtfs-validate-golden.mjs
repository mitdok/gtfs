#!/usr/bin/env node
/**
 * v4 golden sample zip を MobilityData validator に一括投入する。
 *
 * 事前に `pnpm gtfs:golden` で `gtfs-tmp/golden/*.zip` を生成しておく。
 * report.json は既定で `gtfs-tmp/golden-reports/<sample>/report.json` に保存する。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename, join, resolve } from "node:path";
import {
  importGtfsZip,
  parseStandardValidatorReport,
  validateFeed,
} from "../packages/core/dist/index.js";

function parseArgs(argv) {
  const opts = {
    goldenDir: "gtfs-tmp/golden",
    reportsDir: "gtfs-tmp/golden-reports",
    summary: "gtfs-tmp/golden-reports/summary.json",
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--validator-jar") opts.validatorJar = argv[++i];
    else if (a === "--golden-dir") opts.goldenDir = argv[++i];
    else if (a === "--reports-dir") opts.reportsDir = argv[++i];
    else if (a === "--summary") opts.summary = argv[++i];
    else if (a === "--verbose") opts.verbose = true;
    else throw new Error(`unknown option: ${a}`);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const validatorJar = resolve(
  opts.validatorJar ?? process.env.GTFS_VALIDATOR_JAR ?? "tools/gtfs-validator.jar",
);
if (!existsSync(validatorJar)) {
  console.error(`MobilityData validator jar が見つかりません: ${validatorJar}`);
  console.error("配置例: tools/gtfs-validator.jar");
  console.error("または GTFS_VALIDATOR_JAR=/path/to/gtfs-validator.jar を指定してください。");
  process.exit(1);
}

const goldenDir = resolve(opts.goldenDir);
const reportsDir = resolve(opts.reportsDir);
const zips = readdirSync(goldenDir)
  .filter((name) => name.endsWith(".zip"))
  .sort()
  .map((name) => ({ id: basename(name, ".zip"), path: join(goldenDir, name) }));

if (zips.length === 0) {
  console.error(`golden zip が見つかりません: ${goldenDir}`);
  console.error("先に pnpm gtfs:golden を実行してください。");
  process.exit(1);
}

const results = [];
for (const zip of zips) {
  // Validate the actual exported archive, not only the in-memory fixture used to
  // create it. This catches profile filtering and CSV/ZIP round-trip regressions.
  const imported = importGtfsZip(new Uint8Array(readFileSync(zip.path)));
  const internalV4 = validateFeed(imported.feed, { profileId: "gtfs-jp-v4" });
  const internalGoogle = validateFeed(imported.feed, {
    profileId: "google-transit-ready",
    // Golden fixtures have a fixed 2026 validity period. Pin the date so this
    // conformance test remains deterministic after that period expires.
    validationDate: "20260616",
  });
  const out = join(reportsDir, zip.id);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const run = spawnSync("java", ["-jar", validatorJar, "--input", zip.path, "--output_base", out], {
    encoding: "utf8",
    stdio: opts.verbose ? "inherit" : "pipe",
  });
  if (run.error || run.status !== 0) {
    if (!opts.verbose) {
      if (run.stdout) console.error(run.stdout);
      if (run.stderr) console.error(run.stderr);
    }
    throw new Error(`${zip.id}: validator failed (status=${run.status})`);
  }
  const reportPath = join(out, "report.json");
  const report = parseStandardValidatorReport(readFileSync(reportPath, "utf8"));
  results.push({
    id: zip.id,
    reportPath,
    errors: report.summary.errors,
    warnings: report.summary.warnings,
    infos: report.summary.infos,
    validatorVersion: report.validatorVersion,
    internal: {
      gtfsJpV4: internalV4.summary,
      googleTransitReady: internalGoogle.summary,
    },
  });
}

const summary = {
  generatedAt: new Date().toISOString(),
  validationDate: "20260616",
  reportsDir,
  results,
};
const summaryPath = resolve(opts.summary);
await mkdir(resolve(summaryPath, ".."), { recursive: true });
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ summaryPath, ...summary }, null, 2));
const failed = results.filter(
  (result) =>
    result.errors > 0 ||
    result.internal.gtfsJpV4.errors > 0 ||
    result.internal.googleTransitReady.errors > 0,
);
if (failed.length > 0) {
  console.error(
    `golden validator errors: ${failed
      .map(
        (result) =>
          `${result.id}=standard:${result.errors},v4:${result.internal.gtfsJpV4.errors},google:${result.internal.googleTransitReady.errors}`,
      )
      .join(", ")}`,
  );
  process.exit(2);
}
