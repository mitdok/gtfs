#!/usr/bin/env node
/**
 * MobilityData GTFS validator CLI jar を tools/gtfs-validator.jar に配置する。
 * CIや新規環境で `pnpm gtfs:validate-golden` を再現するための補助コマンド。
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { get } from "node:https";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

const VERSION = "8.0.1";
const URL = `https://github.com/MobilityData/gtfs-validator/releases/download/v${VERSION}/gtfs-validator-${VERSION}-cli.jar`;
const SHA256 = "19293ddd9b6f954f216d4f12054bd8a3232921751c4484339e339764a91000e2";

function parseArgs(argv) {
  const opts = { output: "tools/gtfs-validator.jar", force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--output") opts.output = argv[++i];
    else if (a === "--force") opts.force = true;
    else throw new Error(`unknown option: ${a}`);
  }
  return opts;
}

async function sha256(path) {
  const data = await readFile(path);
  return createHash("sha256").update(data).digest("hex");
}

function request(url, redirects = 0) {
  return new Promise((resolvePromise, reject) => {
    const req = get(url, (res) => {
      const status = res.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        if (redirects >= 5) {
          res.resume();
          reject(new Error("too many redirects"));
          return;
        }
        const location = res.headers.location;
        if (!location) {
          res.resume();
          reject(new Error(`redirect without location: ${status}`));
          return;
        }
        res.resume();
        resolvePromise(request(new URL(location, url).toString(), redirects + 1));
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`download failed: HTTP ${status}`));
        return;
      }
      resolvePromise(res);
    });
    req.on("error", reject);
  });
}

async function download(url, output) {
  const res = await request(url);
  await pipeline(res, createWriteStream(output));
}

const opts = parseArgs(process.argv.slice(2));
const output = resolve(opts.output);
const tmp = `${output}.tmp`;

try {
  if (!opts.force && (await sha256(output).catch(() => null)) === SHA256) {
    console.log(`MobilityData validator ${VERSION} は配置済みです: ${output}`);
    process.exit(0);
  }

  await mkdir(dirname(output), { recursive: true });
  await rm(tmp, { force: true });
  console.log(`MobilityData validator ${VERSION} を取得します: ${URL}`);
  await download(URL, tmp);

  const actual = await sha256(tmp);
  if (actual !== SHA256) {
    throw new Error(`sha256 mismatch: expected ${SHA256}, actual ${actual}`);
  }

  await rename(tmp, output);
  console.log(`MobilityData validator ${VERSION} を配置しました: ${output}`);
} catch (error) {
  await rm(tmp, { force: true }).catch(() => {});
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
