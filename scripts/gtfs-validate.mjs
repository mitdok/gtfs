#!/usr/bin/env node
/**
 * ルート用GTFS検収ラッパ。
 *
 * MobilityData validator jar の置き場所を `GTFS_VALIDATOR_JAR` または
 * `tools/gtfs-validator.jar` に固定し、packages/core の gtfs-acceptance CLIへ委譲する。
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

function parseArgs(argv) {
  const opts = { _: [], passthrough: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--validator-jar") {
      opts.validatorJar = argv[++i];
      continue;
    }
    if (a === "--report") {
      opts.report = argv[++i];
      opts.passthrough.push(a, opts.report);
      continue;
    }
    if (a.startsWith("--")) {
      opts.passthrough.push(a);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) opts.passthrough.push(argv[++i]);
      continue;
    }
    opts._.push(a);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const zipPath = opts._[0];
if (!zipPath) {
  console.error("使い方: pnpm gtfs:validate <gtfs.zip> [--report report.json | --validator-jar validator.jar] [gtfs-acceptance options]");
  process.exit(1);
}

const validatorJar = resolve(
  opts.validatorJar ?? process.env.GTFS_VALIDATOR_JAR ?? "tools/gtfs-validator.jar",
);
const args = [resolve("packages/core/bin/gtfs-acceptance.mjs"), zipPath, ...opts.passthrough];

if (!opts.report) {
  if (!existsSync(validatorJar)) {
    console.error(`MobilityData validator jar が見つかりません: ${validatorJar}`);
    console.error("配置例: tools/gtfs-validator.jar");
    console.error("または GTFS_VALIDATOR_JAR=/path/to/gtfs-validator.jar を指定してください。");
    console.error("既存の report.json を使う場合は --report report.json を指定してください。");
    process.exit(1);
  }
  args.push("--validator-jar", validatorJar);
}

const result = spawnSync(process.execPath, args, { stdio: "inherit" });
if (result.error) {
  console.error(`gtfs-acceptance 起動に失敗しました: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
