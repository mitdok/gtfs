/**
 * tsc は import した JSON を dist へ出力しないため、プロファイル定義（src/profiles/*.json）を
 * dist/profiles へ複製する。dist 実行時に `./profiles/*.json` を解決できるようにするためのもの。
 */
import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../src/profiles");
const dest = resolve(here, "../dist/profiles");

await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });
console.log(`copied profiles -> ${dest}`);
