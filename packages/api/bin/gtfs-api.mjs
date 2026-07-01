#!/usr/bin/env node
/**
 * GTFS Studio API サーバ起動エントリ（依存ゼロ）。
 *
 *   node bin/gtfs-api.mjs [--port 8787] [--locks ./data/spec-locks.json] [--revisions ./data/revisions] [--tokens token1,token2]
 *   環境変数: PORT / GTFS_SPEC_LOCKS_PATH / GTFS_REVISIONS_PATH / GTFS_API_TOKENS
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
const { openSpecLockRepository, openRevisionRepository, createApiServer, createRtRelayService } = await import(
  resolve(here, "../dist/index.js")
);
const {
  createRealtimeAlertStore,
  createRealtimeTripUpdateStore,
  createRealtimeVehicleStore,
} = await import("@gtfs-studio/core/realtime");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const port = Number(arg("port", process.env.PORT ?? "8787"));
const locksPath = resolve(
  process.cwd(),
  arg("locks", process.env.GTFS_SPEC_LOCKS_PATH ?? "./data/spec-locks.json"),
);
const revisionsPath = resolve(
  process.cwd(),
  arg("revisions", process.env.GTFS_REVISIONS_PATH ?? "./data/revisions"),
);
const staticWriteTokens = String(arg("tokens", process.env.GTFS_API_TOKENS ?? ""))
  .split(",")
  .map((token) => token.trim())
  .filter(Boolean);

const repository = openSpecLockRepository(locksPath);
const revisions = openRevisionRepository(revisionsPath);
const rtRelay = createRtRelayService(); // 既定の global fetch を使用
const rtAlerts = createRealtimeAlertStore();
const rtVehicles = createRealtimeVehicleStore();
const rtTripUpdates = createRealtimeTripUpdateStore();
const server = createApiServer({
  repository,
  revisions,
  staticWriteTokens,
  rtRelay,
  rtAlerts,
  rtVehicles,
  rtTripUpdates,
});

server.listen(port, () => {
  console.error(`gtfs-studio API listening on http://localhost:${port}`);
  console.error(`spec-locks: ${locksPath}`);
  console.error(`revisions: ${revisionsPath}`);
  console.error(`static write auth: ${staticWriteTokens.length > 0 ? "enabled" : "disabled"}`);
  console.error(`GTFS-RT alerts: GET/POST /rt/alerts, GET /rt/alerts.pb`);
  console.error(`GTFS-RT vehicles: GET/POST /rt/vehicles, GET /rt/vehicles.pb`);
  console.error(`GTFS-RT trip updates: GET/POST /rt/trip-updates, GET /rt/trip-updates.pb`);
  console.error(`GTFS-RT relay: /rt/sources, POST /rt/sources/:id/poll, GET /rt/sources/:id/feed.pb`);
});
