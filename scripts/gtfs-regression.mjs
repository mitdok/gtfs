#!/usr/bin/env node
/**
 * 実データ回帰セットを manifest から実行する。
 *
 * 実フィード自体は利用許諾や匿名化方針がケースごとに異なるため、Git管理外の
 * ローカルパスを manifest に書き、結果だけを再現可能な JSON として保存する。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import {
  exportToZip,
  importGtfsZip,
  migrateToGtfsJpV4,
  parseStandardValidatorReport,
  validateFeed,
} from "../packages/core/dist/index.js";

function parseArgs(argv) {
  const opts = {
    manifest: "gtfs-tmp/regression/manifest.json",
    outDir: "gtfs-tmp/regression/results",
    profileId: "gtfs-jp-v4",
    dryRun: false,
    requireReviewed: false,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;
    if (a === "--manifest") opts.manifest = argv[++i];
    else if (a === "--out-dir") opts.outDir = argv[++i];
    else if (a === "--profile") opts.profileId = argv[++i];
    else if (a === "--validator-jar") opts.validatorJar = argv[++i];
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--require-reviewed") opts.requireReviewed = true;
    else if (a === "--verbose") opts.verbose = true;
    else throw new Error(`unknown option: ${a}`);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const manifestPath = resolve(opts.manifest);
if (!existsSync(manifestPath)) {
  console.error(`regression manifest が見つかりません: ${manifestPath}`);
  console.error("例: docs/regression-manifest.example.json を gtfs-tmp/regression/manifest.json にコピーしてローカルパスを設定してください。");
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const cases = Array.isArray(manifest.cases) ? manifest.cases : [];
if (cases.length === 0) {
  console.error("manifest.cases が空です。");
  process.exit(2);
}

const outDir = resolve(opts.outDir);
const validatorJar = resolve(
  opts.validatorJar ?? process.env.GTFS_VALIDATOR_JAR ?? "tools/gtfs-validator.jar",
);
const reviewStatuses = cases.map((c) => reviewStatus(c));
const reviewFailures = reviewStatuses.filter((status) => !status.ready);

if (opts.dryRun) {
  const missing = cases.filter((c) => !c.input || !existsSync(resolveRelative(c.input, manifestPath)));
  console.log(JSON.stringify({
    manifest: manifestPath,
    cases: cases.length,
    missingInputs: missing.map((c) => c.id ?? c.input),
    reviewStatuses,
  }, null, 2));
  process.exit(missing.length > 0 || (opts.requireReviewed && reviewFailures.length > 0) ? 2 : 0);
}

if (opts.requireReviewed && reviewFailures.length > 0) {
  console.error(JSON.stringify({
    error: "review requirements are not satisfied",
    manifest: manifestPath,
    failures: reviewFailures,
  }, null, 2));
  process.exit(3);
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const results = [];
for (const c of cases) {
  const id = requireId(c);
  const inputPath = resolveRelative(c.input, manifestPath);
  if (!existsSync(inputPath)) throw new Error(`${id}: input が見つかりません: ${inputPath}`);

  const caseDir = join(outDir, id);
  await mkdir(caseDir, { recursive: true });

  const inputZip = new Uint8Array(readFileSync(inputPath));
  const imported = importGtfsZip(inputZip);
  let feed = imported.feed;
  const migrationWarnings = [];
  const mode = c.mode ?? "roundtrip";
  if (mode === "v3-migration") {
    const migrated = migrateToGtfsJpV4(feed, c.referenceDate ? { referenceDate: c.referenceDate } : {});
    feed = migrated.feed;
    migrationWarnings.push(...migrated.warnings);
  } else if (mode !== "roundtrip") {
    throw new Error(`${id}: unsupported mode: ${mode}`);
  }

  const profileId = c.profileId ?? opts.profileId;
  const internal = validateFeed(feed, {
    profileId,
    validationDate: c.validationDate,
  });

  const outputZipPath = join(caseDir, `${id}.zip`);
  writeFileSync(outputZipPath, exportToZip(feed, c.exportProfileId ? { profileId: c.exportProfileId } : {}));

  const standard = await standardValidatorResult(c, outputZipPath, caseDir, validatorJar, opts.verbose);
  const result = {
    id,
    mode,
    input: inputPath,
    outputZip: outputZipPath,
    sourceLicense: c.sourceLicense ?? "unknown",
    anonymized: c.anonymized === true,
    review: reviewStatus(c),
    importedFiles: imported.importedFiles.sort(),
    importWarnings: imported.warnings,
    migrationWarnings: migrationWarnings.map((w) => ({ code: w.code, message: w.message })),
    internal: {
      profileId,
      summary: internal.summary,
      issues: internal.issues.slice(0, 20).map((issue) => ({
        severity: issue.severity,
        code: issue.code,
        message: issue.message,
        entity: issue.entity,
      })),
    },
    standard,
    acceptanceEvidence: {
      standardErrors: standard?.summary.errors,
      note: `${mode}: ${basename(inputPath)}`,
    },
  };
  results.push(result);
}

const summary = {
  manifest: manifestPath,
  outDir,
  executedAt: new Date().toISOString(),
  results,
};
const summaryPath = join(outDir, "summary.json");
writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));

const failed = results.filter((r) => r.internal.summary.errors > 0 || (r.standard && r.standard.summary.errors > 0));
process.exit(failed.length > 0 ? 2 : 0);

function requireId(c) {
  if (!c.id || !/^[A-Za-z0-9._-]+$/.test(c.id)) throw new Error(`case id が不正です: ${c.id}`);
  return c.id;
}

function resolveRelative(path, baseFile) {
  if (!path) return "";
  return resolve(dirname(baseFile), path);
}

function reviewStatus(c) {
  const review = c.review ?? {};
  const sourceLicense = review.sourceLicense ?? c.sourceLicense ?? "unknown";
  const issues = [];
  if (!sourceLicense || sourceLicense === "unknown") issues.push("sourceLicense is unknown");
  if (review.allowedForRegression !== true) issues.push("review.allowedForRegression must be true");
  if (!review.reviewedBy) issues.push("review.reviewedBy is required");
  if (!review.reviewedAt) issues.push("review.reviewedAt is required");
  if (c.anonymized === true) {
    if (review.anonymizationReviewed !== true) issues.push("review.anonymizationReviewed must be true for anonymized feeds");
  } else if (review.rawFeedReviewed !== true) {
    issues.push("review.rawFeedReviewed must be true when anonymized=false");
  }
  return {
    id: c.id,
    ready: issues.length === 0,
    sourceLicense,
    anonymized: c.anonymized === true,
    reviewedBy: review.reviewedBy,
    reviewedAt: review.reviewedAt,
    issues,
  };
}

async function standardValidatorResult(c, outputZipPath, caseDir, jarPath, verbose) {
  if (c.report) {
    const reportPath = resolveRelative(c.report, manifestPath);
    const parsed = parseStandardValidatorReport(readFileSync(reportPath, "utf8"));
    return {
      source: "report",
      reportPath,
      validatorName: parsed.validatorName,
      validatorVersion: parsed.validatorVersion,
      executedAt: parsed.executedAt,
      summary: parsed.summary,
      issues: parsed.issues.slice(0, 20),
    };
  }
  if (!existsSync(jarPath)) {
    return {
      source: "not_executed",
      summary: { errors: undefined, warnings: undefined, infos: undefined },
      reason: `validator jar not found: ${jarPath}`,
    };
  }

  const reportDir = join(caseDir, "validator");
  await mkdir(reportDir, { recursive: true });
  const run = spawnSync("java", ["-jar", jarPath, "--input", outputZipPath, "--output_base", reportDir], {
    encoding: "utf8",
    stdio: verbose ? "inherit" : "pipe",
  });
  if (run.error || run.status !== 0) {
    if (!verbose) {
      if (run.stdout) console.error(run.stdout);
      if (run.stderr) console.error(run.stderr);
    }
    throw new Error(`${c.id}: validator failed (status=${run.status})`);
  }

  const reportPath = join(reportDir, "report.json");
  const parsed = parseStandardValidatorReport(readFileSync(reportPath, "utf8"));
  return {
    source: "validator",
    reportPath,
    validatorName: parsed.validatorName,
    validatorVersion: parsed.validatorVersion,
    executedAt: parsed.executedAt,
      summary: parsed.summary,
      issues: parsed.issues.slice(0, 20),
    };
  }
