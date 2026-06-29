#!/usr/bin/env node
/**
 * GTFS-JP v4 golden sample zip を生成する。
 *
 * 出力先は既定で `gtfs-tmp/golden/`。生成前に内部 v4 validator error 0 を確認する。
 * 標準validatorは `pnpm gtfs:validate gtfs-tmp/golden/<id>.zip` で別途実行する。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  exportToZip,
  importEntries,
  validateFeed,
  v4GoldenSamples,
} from "../packages/core/dist/index.js";

function parseArgs(argv) {
  const opts = { out: "gtfs-tmp/golden" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") opts.out = argv[++i];
    else throw new Error(`unknown option: ${a}`);
  }
  return opts;
}

function feedFrom(files) {
  const entries = {};
  for (const [name, text] of Object.entries(files)) entries[name] = Buffer.from(text, "utf8");
  return importEntries(entries).feed;
}

const opts = parseArgs(process.argv.slice(2));
const outDir = resolve(opts.out);
await mkdir(outDir, { recursive: true });

for (const sample of v4GoldenSamples()) {
  const feed = feedFrom(sample.files);
  const report = validateFeed(feed, { profileId: "gtfs-jp-v4" });
  if (report.summary.errors !== 0) {
    throw new Error(`${sample.id}: internal v4 validation failed (${report.summary.errors} errors)`);
  }
  const zip = exportToZip(feed, { profileId: "gtfs-jp-v4" });
  const path = resolve(outDir, `${sample.id}.zip`);
  await writeFile(path, zip);
  console.error(`generated ${path}`);
}
