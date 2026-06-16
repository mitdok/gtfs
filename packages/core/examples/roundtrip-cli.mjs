#!/usr/bin/env node
/**
 * 取込 → 検証 → 再出力 を実データで試すための簡易CLI。
 *
 * 使い方:
 *   pnpm --filter @gtfs-studio/core build   # 先にビルド
 *   node packages/core/examples/roundtrip-cli.mjs <input.zip> [output.zip] [--profile gtfs-jp-v4] [--migrate-v4] [--reference-date YYYYMMDD]
 *
 * 例（豊鉄バスの公開GTFSで試す場合）:
 *   1. https://bus-viewer.jp/toyotetsu/view/opendataToyotetsu.html から zip を取得
 *   2. node packages/core/examples/roundtrip-cli.mjs ./toyotetsu.zip ./out.zip
 *
 * ※豊鉄バスのデータは出典表示等の利用条件があるため、本リポジトリには同梱しない。
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  importGtfsZip,
  migrateToGtfsJpV4,
  validateFeed,
  exportToZip,
} from "../dist/index.js";

const args = process.argv.slice(2);
const profileIdx = args.indexOf("--profile");
const profileId = profileIdx >= 0 ? args[profileIdx + 1] : "gtfs-base";
const refDateIdx = args.indexOf("--reference-date");
const referenceDate = refDateIdx >= 0 ? args[refDateIdx + 1] : undefined;
const migrateV4 = args.includes("--migrate-v4");
const flagsWithValue = new Set(["--profile", "--reference-date"]);
const positional = args.filter(
  (a, i) => !flagsWithValue.has(a) && !flagsWithValue.has(args[i - 1]) && a !== "--migrate-v4",
);
const input = positional[0];
const output = positional[1];

if (!input) {
  console.error("usage: roundtrip-cli.mjs <input.zip> [output.zip] [--profile gtfs-jp-v4] [--migrate-v4] [--reference-date YYYYMMDD]");
  process.exit(2);
}

const zip = new Uint8Array(readFileSync(input));
const imported = importGtfsZip(zip);
let feed = imported.feed;

console.log(`取込: ${imported.importedFiles.length} ファイル [${imported.importedFiles.sort().join(", ")}]`);
for (const w of imported.warnings) console.log(`  warn: ${w}`);

if (migrateV4) {
  const migrated = migrateToGtfsJpV4(feed, referenceDate ? { referenceDate } : {});
  feed = migrated.feed;
  console.log(`移行: GTFS-JP v4候補へ変換`);
  for (const w of migrated.warnings) console.log(`  migrate-warn: ${w.code}: ${w.message}`);
}

const report = validateFeed(feed, { profileId });
const { errors, warnings: warn, infos } = report.summary;
console.log(`検証(${profileId}): error=${errors} warning=${warn} info=${infos}`);

const top = report.issues.slice(0, 20);
for (const i of top) {
  console.log(`  [${i.severity}] ${i.code}: ${i.message}`);
}
if (report.issues.length > top.length) {
  console.log(`  ... 他 ${report.issues.length - top.length} 件`);
}

if (output) {
  writeFileSync(output, exportToZip(feed));
  console.log(`出力: ${output}`);
}

process.exit(errors > 0 ? 1 : 0);
