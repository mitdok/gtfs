#!/usr/bin/env node
/**
 * GTFS Studio API サーバ起動エントリ（依存ゼロ）。
 *
 *   node bin/gtfs-api.mjs [--port 8787] [--locks ./data/spec-locks.json]
 *   環境変数: PORT / GTFS_SPEC_LOCKS_PATH
 *
 * ルート:
 *   GET  /health
 *   GET  /spec-locks
 *   GET  /spec-locks/:id
 *   PUT  /spec-locks/:id        （body: SpecLock。永続化される）
 *   POST /acceptance            （body: { zipBase64, profileId?, standardReport?, ... }）
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { openSpecLockRepository, createApiServer, createRtRelayService } = await import(
  resolve(here, "../dist/index.js")
);

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const port = Number(arg("port", process.env.PORT ?? "8787"));
const locksPath = resolve(
  process.cwd(),
  arg("locks", process.env.GTFS_SPEC_LOCKS_PATH ?? "./data/spec-locks.json"),
);

const repository = openSpecLockRepository(locksPath);
const rtRelay = createRtRelayService(); // 既定の global fetch を使用
const server = createApiServer({ repository, rtRelay });

server.listen(port, () => {
  console.error(`gtfs-studio API listening on http://localhost:${port}`);
  console.error(`spec-locks: ${locksPath}`);
  console.error(`GTFS-RT relay: /rt/sources, POST /rt/sources/:id/poll, GET /rt/sources/:id/feed.pb`);
});
