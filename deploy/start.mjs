#!/usr/bin/env node
import { resolve } from "node:path";

const { openSpecLockRepository, openRevisionRepository, createApiServer, createRtRelayService } =
  await import(resolve(process.cwd(), "api/dist/index.js"));
const { createRealtimeAlertStore, createRealtimeTripUpdateStore, createRealtimeVehicleStore } =
  await import("@gtfs-studio/core/realtime");

const host = process.env.GTFS_API_HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? "8787");
const locksPath = resolve(process.cwd(), process.env.GTFS_SPEC_LOCKS_PATH ?? "./data/spec-locks.json");
const revisionsPath = resolve(process.cwd(), process.env.GTFS_REVISIONS_PATH ?? "./data/revisions");
const staticWriteTokens = String(process.env.GTFS_API_TOKENS ?? "")
  .split(",")
  .map((token) => token.trim())
  .filter(Boolean);

if (staticWriteTokens.length === 0) {
  throw new Error("GTFS_API_TOKENS must be configured in production");
}

const server = createApiServer({
  repository: openSpecLockRepository(locksPath),
  revisions: openRevisionRepository(revisionsPath),
  staticWriteTokens,
  rtRelay: createRtRelayService(),
  rtAlerts: createRealtimeAlertStore(),
  rtVehicles: createRealtimeVehicleStore(),
  rtTripUpdates: createRealtimeTripUpdateStore(),
});

server.listen(port, host, () => {
  console.error(`gtfs-studio API listening on http://${host}:${port}`);
  console.error(`spec-locks: ${locksPath}`);
  console.error(`revisions: ${revisionsPath}`);
  console.error("static write auth: enabled");
});
