#!/usr/bin/env node
/**
 * 検収CLI（仕様 11.4 検収コマンドの実体 / 10.7 標準validator連携）。
 *
 * gtfs.zip を取込・検証し、MobilityData validator の report.json を取り込んで
 * 公開ゲート・検収（A-01〜A-10, 11.5）を機械判定する。判定ロジックは core の
 * `runAcceptancePipeline` を再利用し、本スクリプトは fs / Java 起動のみを担う。
 *
 * 使い方:
 *   node bin/gtfs-acceptance.mjs <gtfs.zip> [options]
 *     --report <report.json>     既に実行済みの MobilityData validator 結果
 *     --validator-jar <jar>      gtfs-validator.jar を起動して report.json を生成
 *     --profile <id>             公開プロファイル（既定 gtfs-jp-v4）
 *     --validation-date <YYYYMMDD>
 *     --release-candidate <ver>
 *     --roundtrip-errors <n>     実フィード回帰の標準validator error数(A-07の証跡)
 *     --v3-errors <n>            v3移行回帰の標準validator error数(A-08の証跡)
 *     --regression-summary <summary.json>
 *                               gtfs-regression の summary.json から A-07/A-08 を抽出
 *     --roundtrip-case <id>      A-07 に使う regression case id
 *     --v3-case <id>             A-08 に使う regression case id
 *     --require-reviewed         regression case の review.ready=true を必須化
 *     --public-url-errors <n>    公開URL取得zipの標準validator error数(A-09の証跡)
 *     --out <acceptance.json>    検収結果(11.5)の出力先。未指定なら標準出力
 *
 * 終了コード: ready=0 / not_ready=2 / 実行エラー=1
 */
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const { evidenceFromRegressionSummary, runAcceptancePipeline } = await import(resolve(here, "../dist/index.js"));

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--require-reviewed") opts["require-reviewed"] = true;
    else if (a.startsWith("--")) opts[a.slice(2)] = argv[++i];
    else opts._.push(a);
  }
  return opts;
}

/** MobilityData validator(jar) を起動し report.json を返す。java と jar が必要。 */
async function runJavaValidator(jarPath, zipPath) {
  const out = await mkdtemp(join(tmpdir(), "gtfs-val-"));
  try {
    const r = spawnSync("java", ["-jar", jarPath, "--input", zipPath, "--output_base", out], {
      stdio: "inherit",
    });
    if (r.error || r.status !== 0) {
      throw new Error(`gtfs-validator 実行に失敗しました (status=${r.status})`);
    }
    return await readFile(join(out, "report.json"), "utf8");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const zipPath = opts._[0];
  if (!zipPath) {
    console.error("使い方: node bin/gtfs-acceptance.mjs <gtfs.zip> [--report r.json | --validator-jar v.jar] [--out out.json]");
    process.exit(1);
  }

  const zip = new Uint8Array(await readFile(zipPath));

  let standardReport;
  if (opts["validator-jar"]) {
    standardReport = await runJavaValidator(opts["validator-jar"], zipPath);
  } else if (opts.report) {
    standardReport = await readFile(opts.report, "utf8");
  }

  const num = (v) => (v === undefined ? undefined : Number(v));
  const roundtripErrors = num(opts["roundtrip-errors"]);
  const v3Errors = num(opts["v3-errors"]);
  const publicUrlErrors = num(opts["public-url-errors"]);
  const regressionEvidence = opts["regression-summary"]
    ? evidenceFromRegressionSummary(await readFile(opts["regression-summary"], "utf8"), {
        roundtripCaseId: opts["roundtrip-case"],
        v3CaseId: opts["v3-case"],
        requireReviewed: opts["require-reviewed"] === true,
      })
    : {};

  const result = runAcceptancePipeline({
    zip,
    profileId: opts.profile,
    validationDate: opts["validation-date"],
    standardReport,
    releaseCandidate: opts["release-candidate"],
    executedAt: new Date().toISOString(),
    realFeedRoundtrip:
      roundtripErrors === undefined
        ? regressionEvidence.realFeedRoundtrip
        : { standardErrors: roundtripErrors },
    v3Migration:
      v3Errors === undefined
        ? regressionEvidence.v3Migration
        : { standardErrors: v3Errors, warningsReasonable: true },
    publicUrl:
      publicUrlErrors === undefined ? undefined : { verified: true, standardErrors: publicUrlErrors },
  });

  const acceptanceJson = JSON.stringify(result.acceptance, null, 2);
  if (opts.out) {
    await writeFile(opts.out, acceptanceJson + "\n");
    console.error(`検収結果を ${opts.out} に出力しました`);
  } else {
    console.log(acceptanceJson);
  }

  // 人間向けサマリは stderr へ。
  const a = result.acceptance;
  console.error(`\n[${a.status.toUpperCase()}] profile=${result.profileId}`);
  for (const c of a.checks) {
    const mark = c.status === "pass" ? "✓" : c.status === "skip" ? "-" : "✗";
    console.error(`  ${mark} ${c.id} ${c.detail}`);
  }
  for (const b of result.gate.blockers) console.error(`  ! ${b.code}: ${b.message}`);

  process.exit(a.status === "ready" ? 0 : 2);
}

main().catch((e) => {
  console.error(`エラー: ${e.message}`);
  process.exit(1);
});
