import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import { exportToZip, importEntries } from "@gtfs-studio/core";
import {
  createRealtimeAlertStore,
  createRealtimeTripUpdateStore,
  createRealtimeVehicleStore,
  decodeRealtimeFeed,
  encodeServiceAlertsFeed,
  encodeVehiclePositionsFeed,
} from "@gtfs-studio/core/realtime";
import { openSpecLockRepository } from "../src/spec-lock-repository.js";
import { createRtRelayService, type RtFetch, type RtFetchResponse } from "../src/rt-relay.js";
import { createApiServer } from "../src/server.js";

const enc = new TextEncoder();

/** 指定タイムスタンプの ServiceAlerts Feed をバイト列で作る。 */
function alertFeed(feedTs: number): Uint8Array {
  return encodeServiceAlertsFeed(
    [{ id: "a1", informedEntities: [{ stopId: "S1" }], headerText: { ja: "運休" } }],
    { timestamp: feedTs },
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function okResponse(bytes: Uint8Array, headers: Record<string, string> = {}): RtFetchResponse {
  return {
    status: 200,
    ok: true,
    headers: { get: (n) => headers[n.toLowerCase()] ?? null },
    arrayBuffer: async () => toArrayBuffer(bytes),
  };
}
function statusResponse(status: number): RtFetchResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

function staticGtfsZipBase64(): string {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, text] of Object.entries({
    "agency.txt": "agency_id,agency_name,agency_url,agency_timezone\na,Agency,https://example.com,Asia/Tokyo\n",
    "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\nS1,One,34.7,137.3\nS2,Two,34.8,137.4\n",
    "routes.txt": "route_id,agency_id,route_short_name,route_long_name,route_type\nR1,a,1,Route,3\n",
    "trips.txt": "route_id,service_id,trip_id,block_id\nR1,weekday,T1,B1\n",
    "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,07:00:00,07:00:00,S1,1\nT1,07:10:00,07:10:00,S2,2\n",
    "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nweekday,1,1,1,1,1,0,0,20260401,20261231\n",
  })) {
    entries[name] = enc.encode(text);
  }
  return Buffer.from(exportToZip(importEntries(entries).feed)).toString("base64");
}

describe("RT-2 poller（fetch注入）", () => {
  it("200で取り込み、ETagを記録し次回は条件付きGET", async () => {
    const calls: Array<Record<string, string>> = [];
    const fetchImpl: RtFetch = async (_url, init) => {
      calls.push({ ...init.headers });
      return calls.length === 1
        ? okResponse(alertFeed(1_000), { etag: 'W/"v1"' })
        : statusResponse(304);
    };
    const svc = createRtRelayService({
      fetch: fetchImpl,
      now: () => 1_000,
      initialSources: [{ id: "s", url: "http://x/a.pb", feedType: "service_alerts", pollIntervalSec: 30 }],
    });

    const first = await svc.poll("s");
    expect(first.outcome).toBe("ingested");
    expect(first.summary?.counts.alert).toBe(1);

    const second = await svc.poll("s");
    expect(second.outcome).toBe("not_modified");
    expect(calls[1]?.["if-none-match"]).toBe('W/"v1"'); // 2回目は条件付き
  });

  it("HTTP error / ネットワークエラーを failed として記録する", async () => {
    let mode = "500";
    const fetchImpl: RtFetch = async () => {
      if (mode === "throw") throw new Error("ECONNREFUSED");
      return statusResponse(500);
    };
    const svc = createRtRelayService({
      fetch: fetchImpl,
      now: () => 5,
      initialSources: [{ id: "s", url: "http://x", feedType: "trip_updates", pollIntervalSec: 30 }],
    });
    expect((await svc.poll("s")).outcome).toBe("failed");
    mode = "throw";
    expect((await svc.poll("s")).outcome).toBe("failed");
    expect(svc.store.metrics("s")!.consecutiveFailures).toBe(2);
  });

  it("disabledまたはactiveFrom前のsourceはpollをskipする", async () => {
    const svc = createRtRelayService({
      fetch: async () => okResponse(alertFeed(1_000)),
      now: () => 1_000,
      initialSources: [
        { id: "disabled", url: "http://x/a.pb", feedType: "service_alerts", pollIntervalSec: 30, enabled: false },
        {
          id: "future",
          url: "http://x/b.pb",
          feedType: "service_alerts",
          pollIntervalSec: 30,
          activeFrom: 2_000,
        },
      ],
    });

    expect(await svc.poll("disabled")).toMatchObject({ outcome: "skipped", reason: "disabled" });
    expect(await svc.poll("future")).toMatchObject({ outcome: "skipped", reason: "not_active_yet" });
    expect(svc.store.serve("future", 1_000).ok).toBe(false);
  });
});

describe("RT-2 中継エンドポイント", () => {
  let server: Server | undefined;
  let base: string;

  beforeEach(async () => {
    const repository = openSpecLockRepository("/tmp/__rt_locks_unused.json");
    const rtRelay = createRtRelayService({
      fetch: async () => okResponse(alertFeed(1_000), { etag: '"e1"' }),
      now: () => 1_000,
      initialSources: [
        { id: "src1", url: "http://feed/a.pb", feedType: "service_alerts", pollIntervalSec: 30 },
      ],
    });
    server = createApiServer({ repository, rtRelay, rtNow: () => 1_030 });
    base = await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}`);
      });
    });
  });
  afterEach(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
  });

  it("GET /rt/sources は登録済みsourceを返す", async () => {
    const r = await fetch(`${base}/rt/sources`);
    const body = await r.json();
    expect(body.sources.map((s: { id: string }) => s.id)).toContain("src1");
  });

  it("PUT で source 追加、poll で取り込み、feed.pb を再配信", async () => {
    // 追加
    const put = await fetch(`${base}/rt/sources/src2`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "http://feed/b.pb",
        feedType: "service_alerts",
        pollIntervalSec: 60,
        gtfsRevision: "rev-20260401",
      }),
    });
    expect(put.status).toBe(200);

    // poll
    const poll = await fetch(`${base}/rt/sources/src1/poll`, { method: "POST" });
    expect((await poll.json()).outcome).toBe("ingested");

    // 再配信（protobuf binary）
    const pb = await fetch(`${base}/rt/sources/src1/feed.pb`);
    expect(pb.status).toBe(200);
    expect(pb.headers.get("content-type")).toContain("x-protobuf");
    expect(pb.headers.get("x-feed-stale")).toBe("false"); // age 30s < 600s SLO
    expect((await pb.arrayBuffer()).byteLength).toBeGreaterThan(0);

    // status
    const st = await fetch(`${base}/rt/sources/src1/status`);
    const body = await st.json();
    expect(body.summary.counts.alert).toBe(1);
    expect(body.stale).toBe(false);
  });

  it("sourceのcached feedを静的GTFS revisionと照合できる", async () => {
    await fetch(`${base}/rt/sources/src-compat`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "http://feed/compat.pb",
        feedType: "service_alerts",
        pollIntervalSec: 60,
        gtfsRevision: "rev-20260401",
      }),
    });
    await fetch(`${base}/rt/sources/src-compat/poll`, { method: "POST" });

    const checked = await fetch(`${base}/rt/sources/src-compat/static-compat/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ zipBase64: staticGtfsZipBase64(), gtfsRevision: "rev-20260401" }),
    });
    expect(checked.status).toBe(200);
    const body = await checked.json();
    expect(body.sourceRevision).toBe("rev-20260401");
    expect(body.revisionMatched).toBe(true);
    expect(body.compatibility.ok).toBe(true);
    expect(body.summary.referencedStopIds).toEqual(["S1"]);
  });

  it("未pollのsourceの feed.pb は 503", async () => {
    await fetch(`${base}/rt/sources/src3`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "http://feed/c.pb", feedType: "service_alerts", pollIntervalSec: 30 }),
    });
    const pb = await fetch(`${base}/rt/sources/src3/feed.pb`);
    expect(pb.status).toBe(503);
  });

  it("stalePolicy=block の source は stale feed を 503 にする", async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    const repository = openSpecLockRepository("/tmp/__rt_stale_policy_locks_unused.json");
    const rtRelay = createRtRelayService({
      fetch: async () => okResponse(alertFeed(1_000), { etag: '"e-stale"' }),
      now: () => 1_000,
      initialSources: [],
    });
    server = createApiServer({ repository, rtRelay, rtNow: () => 1_700 });
    base = await new Promise((resolve) => {
      server!.listen(0, "127.0.0.1", () => {
        const { port } = server!.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}`);
      });
    });

    await fetch(`${base}/rt/sources/src-block`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "http://feed/block.pb",
        feedType: "service_alerts",
        pollIntervalSec: 30,
        stalePolicy: "block",
      }),
    });
    await fetch(`${base}/rt/sources/src-block/poll`, { method: "POST" });

    const pb = await fetch(`${base}/rt/sources/src-block/feed.pb`);
    expect(pb.status).toBe(503);
    expect(await pb.json()).toMatchObject({
      stale: true,
      stalePolicy: "block",
    });
  });

  it("rtRelay未設定なら /rt は 501", async () => {
    const repository = openSpecLockRepository("/tmp/__rt_locks_unused2.json");
    const s = createApiServer({ repository });
    const b: string = await new Promise((resolve) => {
      s.listen(0, "127.0.0.1", () => {
        const { port } = s.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}`);
      });
    });
    const r = await fetch(`${b}/rt/sources`);
    expect(r.status).toBe(501);
    await new Promise<void>((res) => s.close(() => res()));
  });
});

describe("RT-1 手動ServiceAlerts API", () => {
  let server: Server;
  let base: string;

  beforeEach(async () => {
    const repository = openSpecLockRepository("/tmp/__rt_alert_locks_unused.json");
    server = createApiServer({
      repository,
      rtAlerts: createRealtimeAlertStore(),
      rtNow: () => 1_781_568_000,
    });
    base = await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}`);
      });
    });
  });
  afterEach(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    server = undefined;
  });

  it("Alertを登録・取得・protobuf配信できる", async () => {
    const post = await fetch(`${base}/rt/alerts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "manual-1",
        informedEntities: [{ routeId: "R1" }],
        effect: "NO_SERVICE",
        headerText: { ja: "運休" },
      }),
    });
    expect(post.status).toBe(200);
    expect((await post.json()).enabled).toBe(true);

    const list = await fetch(`${base}/rt/alerts`);
    expect((await list.json()).alerts.map((a: { id: string }) => a.id)).toEqual(["manual-1"]);

    const pb = await fetch(`${base}/rt/alerts.pb`);
    expect(pb.status).toBe(200);
    expect(pb.headers.get("content-type")).toContain("x-protobuf");
    const feed = decodeRealtimeFeed(new Uint8Array(await pb.arrayBuffer()));
    expect(feed.entity[0]?.id).toBe("manual-1");
    expect(feed.entity[0]?.alert?.informedEntity[0]?.routeId).toBe("R1");
  });

  it("PUT/DELETEでAlertを更新・削除できる", async () => {
    const put = await fetch(`${base}/rt/alerts/manual-2`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        informedEntities: [{ stopId: "S1" }],
        effect: "DETOUR",
        headerText: { ja: "迂回" },
        enabled: false,
      }),
    });
    expect(put.status).toBe(200);
    expect((await put.json()).id).toBe("manual-2");

    const get = await fetch(`${base}/rt/alerts/manual-2`);
    expect((await get.json()).enabled).toBe(false);

    const del = await fetch(`${base}/rt/alerts/manual-2`, { method: "DELETE" });
    expect((await del.json()).removed).toBe(true);
    expect((await fetch(`${base}/rt/alerts/manual-2`)).status).toBe(404);
  });
});

describe("RT-3 VehiclePositions API", () => {
  let server: Server | undefined;
  let base: string;

  async function listen(serverToListen: Server): Promise<string> {
    return await new Promise((resolve) => {
      serverToListen.listen(0, "127.0.0.1", () => {
        const { port } = serverToListen.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}`);
      });
    });
  }

  async function restart(options: Parameters<typeof createApiServer>[0]) {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    server = createApiServer(options);
    base = await listen(server);
  }

  beforeEach(async () => {
    const repository = openSpecLockRepository("/tmp/__rt_vehicle_locks_unused.json");
    server = createApiServer({
      repository,
      rtVehicles: createRealtimeVehicleStore(),
      rtNow: () => 1_781_568_000,
    });
    base = await listen(server);
  });
  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
  });

  it("VehiclePositionを登録・取得・protobuf配信できる", async () => {
    const post = await fetch(`${base}/rt/vehicles`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "veh-1",
        vehicleId: "bus-1",
        latitude: 34.7691,
        longitude: 137.3916,
        routeId: "R1",
      }),
    });
    expect(post.status).toBe(200);
    expect((await post.json()).vehicleId).toBe("bus-1");

    const list = await fetch(`${base}/rt/vehicles`);
    expect((await list.json()).vehicles.map((v: { id: string }) => v.id)).toEqual(["veh-1"]);

    const pb = await fetch(`${base}/rt/vehicles.pb`);
    expect(pb.status).toBe(200);
    expect(pb.headers.get("content-type")).toContain("x-protobuf");
    const feed = decodeRealtimeFeed(new Uint8Array(await pb.arrayBuffer()));
    expect(feed.entity[0]?.id).toBe("veh-1");
    expect(feed.entity[0]?.vehicle?.vehicle?.id).toBe("bus-1");
    expect(feed.entity[0]?.vehicle?.trip?.routeId).toBe("R1");
  });

  it("PUT/DELETEでVehiclePositionを更新・削除できる", async () => {
    const put = await fetch(`${base}/rt/vehicles/veh-2`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vehicleId: "bus-2",
        latitude: 34.76,
        longitude: 137.38,
        speed: 6.5,
      }),
    });
    expect(put.status).toBe(200);
    expect((await put.json()).id).toBe("veh-2");

    const get = await fetch(`${base}/rt/vehicles/veh-2`);
    expect((await get.json()).speed).toBe(6.5);

    const del = await fetch(`${base}/rt/vehicles/veh-2`, { method: "DELETE" });
    expect((await del.json()).removed).toBe(true);
    expect((await fetch(`${base}/rt/vehicles/veh-2`)).status).toBe(404);
  });

  it("source token設定時はVehiclePosition書き込みを認証する", async () => {
    const repository = openSpecLockRepository("/tmp/__rt_vehicle_auth_locks_unused.json");
    await restart({
      repository,
      rtVehicles: createRealtimeVehicleStore(),
      rtVehicleTokens: ["source-token"],
      rtNow: () => 1_781_568_000,
    });

    const missing = await fetch(`${base}/rt/vehicles`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "veh-auth", vehicleId: "bus-auth", latitude: 34.7, longitude: 137.3 }),
    });
    expect(missing.status).toBe(401);

    const authorized = await fetch(`${base}/rt/vehicles`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer source-token" },
      body: JSON.stringify({ id: "veh-auth", vehicleId: "bus-auth", latitude: 34.7, longitude: 137.3 }),
    });
    expect(authorized.status).toBe(200);
    expect((await fetch(`${base}/rt/vehicles`)).status).toBe(200);
  });

  it("VehiclePosition書き込みをsource token単位でレート制限する", async () => {
    const repository = openSpecLockRepository("/tmp/__rt_vehicle_rate_locks_unused.json");
    await restart({
      repository,
      rtVehicles: createRealtimeVehicleStore(),
      rtVehicleTokens: ["rate-token"],
      rtVehicleRateLimit: { windowMs: 60_000, max: 1 },
      rtNow: () => 1_781_568_000,
    });

    const first = await fetch(`${base}/rt/vehicles/veh-rate`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-rt-source-token": "rate-token" },
      body: JSON.stringify({ vehicleId: "bus-rate", latitude: 34.7, longitude: 137.3 }),
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${base}/rt/vehicles/veh-rate`, {
      method: "DELETE",
      headers: { "x-rt-source-token": "rate-token" },
    });
    expect(second.status).toBe(429);

    const read = await fetch(`${base}/rt/vehicles/veh-rate`);
    expect(read.status).toBe(200);
  });

  it("VehiclePositionからTripUpdateを生成して保存できる", async () => {
    await restart({
      repository: openSpecLockRepository("/tmp/__rt_vehicle_trip_update_locks_unused.json"),
      rtVehicles: createRealtimeVehicleStore(),
      rtTripUpdates: createRealtimeTripUpdateStore(),
      rtNow: () => 1_781_568_000,
    });
    await fetch(`${base}/rt/vehicles/veh-tu`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vehicleId: "bus-tu",
        latitude: 34.7,
        longitude: 137.3,
        routeId: "R1",
        tripId: "T1",
      }),
    });

    const generated = await fetch(`${base}/rt/vehicles/veh-tu/trip-update`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        zipBase64: staticGtfsZipBase64(),
        atTime: "07:05:00",
        delaySec: 120,
        save: true,
      }),
    });
    expect(generated.status).toBe(200);
    const body = await generated.json();
    expect(body.update.tripId).toBe("T1");
    expect(body.update.vehicleId).toBe("bus-tu");
    expect(body.update.stopTimeUpdates.map((stop: { stopId: string }) => stop.stopId)).toEqual(["S2"]);

    const list = await fetch(`${base}/rt/trip-updates`);
    expect((await list.json()).tripUpdates.map((update: { id: string }) => update.id)).toEqual([
      "veh-tu-trip-update",
    ]);
  });

  it("trip_idなしのVehiclePositionでもGPS位置からTripUpdate候補を生成できる", async () => {
    await restart({
      repository: openSpecLockRepository("/tmp/__rt_vehicle_gps_trip_update_locks_unused.json"),
      rtVehicles: createRealtimeVehicleStore(),
      rtTripUpdates: createRealtimeTripUpdateStore(),
      rtNow: () => 1_781_568_000,
    });
    await fetch(`${base}/rt/vehicles/veh-gps-tu`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vehicleId: "bus-gps-tu",
        latitude: 34.80002,
        longitude: 137.40002,
        routeId: "R1",
      }),
    });

    const generated = await fetch(`${base}/rt/vehicles/veh-gps-tu/trip-update`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        zipBase64: staticGtfsZipBase64(),
        atTime: "07:09:30",
        delaySec: 90,
        blockId: "B1",
        maxStopDistanceMeters: 100,
        save: true,
      }),
    });
    expect(generated.status).toBe(200);
    const body = await generated.json();
    expect(body.update.tripId).toBe("T1");
    expect(body.update.stopTimeUpdates.map((stop: { stopId: string }) => stop.stopId)).toEqual(["S2"]);
  });

  it("静的GTFSとprobeからtrip候補品質を評価できる", async () => {
    await restart({
      repository: openSpecLockRepository("/tmp/__rt_trip_match_eval_locks_unused.json"),
    });

    const evaluated = await fetch(`${base}/rt/trip-matching/evaluate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        zipBase64: staticGtfsZipBase64(),
        probes: [
          { routeId: "R1", atTime: "07:01:00", expectedTripId: "T1", maxTimeDiffSec: 120 },
          { routeId: "NOPE", atTime: "07:10:30", expectedTripId: "T1", maxTimeDiffSec: 120 },
        ],
      }),
    });
    expect(evaluated.status).toBe(200);
    const body = await evaluated.json();
    expect(body.total).toBe(2);
    expect(body.unique).toBe(1);
    expect(body.miss).toBe(1);
    expect(body.expectedAccuracy).toBe(0.5);
    expect(body.results[0].bestTripId).toBe("T1");
  });

  it("RT feedの参照IDと静的GTFSの整合を確認できる", async () => {
    await restart({
      repository: openSpecLockRepository("/tmp/__rt_static_compat_locks_unused.json"),
    });
    const feedBase64 = Buffer.from(
      encodeVehiclePositionsFeed(
        [
          {
            id: "veh-compat",
            vehicleId: "bus-compat",
            latitude: 34.7,
            longitude: 137.3,
            tripId: "NO_TRIP",
            routeId: "R1",
          },
        ],
        { timestamp: 1_781_568_000 },
      ),
    ).toString("base64");

    const checked = await fetch(`${base}/rt/static-compat/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        zipBase64: staticGtfsZipBase64(),
        feedBase64,
      }),
    });
    expect(checked.status).toBe(200);
    const body = await checked.json();
    expect(body.compatibility.ok).toBe(false);
    expect(body.compatibility.missing.tripIds).toEqual(["NO_TRIP"]);
    expect(body.compatibility.missing.routeIds).toEqual([]);
  });
});

describe("RT-4 TripUpdates API", () => {
  let server: Server;
  let base: string;

  beforeEach(async () => {
    const repository = openSpecLockRepository("/tmp/__rt_trip_update_locks_unused.json");
    server = createApiServer({
      repository,
      rtTripUpdates: createRealtimeTripUpdateStore(),
      rtNow: () => 1_781_568_000,
    });
    base = await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}`);
      });
    });
  });
  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("TripUpdateを登録・取得・protobuf配信できる", async () => {
    const post = await fetch(`${base}/rt/trip-updates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "tu-1",
        tripId: "T1",
        routeId: "R1",
        vehicleId: "bus-1",
        stopTimeUpdates: [{ stopSequence: 1, stopId: "S1", departureDelay: 120 }],
      }),
    });
    expect(post.status).toBe(200);
    expect((await post.json()).tripId).toBe("T1");

    const list = await fetch(`${base}/rt/trip-updates`);
    expect((await list.json()).tripUpdates.map((u: { id: string }) => u.id)).toEqual(["tu-1"]);

    const pb = await fetch(`${base}/rt/trip-updates.pb`);
    expect(pb.status).toBe(200);
    expect(pb.headers.get("content-type")).toContain("x-protobuf");
    const feed = decodeRealtimeFeed(new Uint8Array(await pb.arrayBuffer()));
    expect(feed.entity[0]?.id).toBe("tu-1");
    expect(feed.entity[0]?.tripUpdate?.trip?.tripId).toBe("T1");
    expect(feed.entity[0]?.tripUpdate?.stopTimeUpdate?.[0]?.departure?.delay).toBe(120);
  });

  it("PUT/DELETEでTripUpdateを更新・削除できる", async () => {
    const put = await fetch(`${base}/rt/trip-updates/tu-2`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tripId: "T2",
        routeId: "R1",
        stopTimeUpdates: [{ stopSequence: 2, stopId: "S2", arrivalDelay: 60 }],
      }),
    });
    expect(put.status).toBe(200);
    expect((await put.json()).id).toBe("tu-2");

    const get = await fetch(`${base}/rt/trip-updates/tu-2`);
    expect((await get.json()).stopTimeUpdates[0].arrivalDelay).toBe(60);

    const del = await fetch(`${base}/rt/trip-updates/tu-2`, { method: "DELETE" });
    expect((await del.json()).removed).toBe(true);
    expect((await fetch(`${base}/rt/trip-updates/tu-2`)).status).toBe(404);
  });
});

describe("RT-5 freshness status API", () => {
  let server: Server;
  let base: string;

  beforeEach(async () => {
    const repository = openSpecLockRepository("/tmp/__rt_status_locks_unused.json");
    const alerts = createRealtimeAlertStore();
    const vehicles = createRealtimeVehicleStore();
    const tripUpdates = createRealtimeTripUpdateStore();
    alerts.upsert(
      { id: "alert-fresh", informedEntities: [{ routeId: "R1" }], headerText: { ja: "遅延" } },
      1_000,
    );
    vehicles.upsert(
      { id: "veh-stale", vehicleId: "bus-1", latitude: 34.7, longitude: 137.3 },
      800,
    );

    server = createApiServer({
      repository,
      rtAlerts: alerts,
      rtVehicles: vehicles,
      rtTripUpdates: tripUpdates,
      rtNow: () => 1_000,
    });
    base = await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}`);
      });
    });
  });
  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("GET /rt/status は各RT feedの鮮度SLOを返す", async () => {
    const res = await fetch(`${base}/rt/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const byType = new Map(body.feeds.map((feed: { feedType: string }) => [feed.feedType, feed]));
    expect(byType.get("service_alerts")).toMatchObject({
      status: "fresh",
      sloSec: 600,
      entityCount: 1,
    });
    expect(byType.get("vehicle_positions")).toMatchObject({
      status: "stale",
      ageSec: 200,
      sloSec: 90,
      entityCount: 1,
    });
    expect(byType.get("trip_updates")).toMatchObject({
      status: "no_data",
      sloSec: 90,
      entityCount: 0,
    });
  });
});

describe("RT-5 audit log API", () => {
  let server: Server;
  let base: string;

  beforeEach(async () => {
    const repository = openSpecLockRepository("/tmp/__rt_audit_locks_unused.json");
    server = createApiServer({
      repository,
      rtAlerts: createRealtimeAlertStore(),
      rtRelay: createRtRelayService({ fetch: async () => statusResponse(500), now: () => 1_000 }),
      rtNow: () => 1_000,
    });
    base = await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}`);
      });
    });
  });
  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("RT変更操作とpoll結果を /rt/audit に記録する", async () => {
    await fetch(`${base}/rt/alerts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "audit-alert", informedEntities: [{ routeId: "R1" }], headerText: { ja: "遅延" } }),
    });
    await fetch(`${base}/rt/sources/audit-source`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "http://feed/audit.pb", feedType: "service_alerts", pollIntervalSec: 30 }),
    });
    await fetch(`${base}/rt/sources/audit-source/poll`, { method: "POST" });

    const res = await fetch(`${base}/rt/audit`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events.map((event: { action: string }) => event.action)).toEqual([
      "source.poll",
      "source.upsert",
      "alert.upsert",
    ]);
    expect(body.events[0]).toMatchObject({ outcome: "failed", targetId: "audit-source" });
  });
});

describe("RT-5 public URL smoke API", () => {
  let feedServer: Server;
  let apiServer: Server;
  let feedBase: string;
  let apiBase: string;

  beforeEach(async () => {
    feedServer = createServer((_req, res) => {
      const bytes = alertFeed(1_000);
      res.writeHead(200, { "content-type": "application/x-protobuf" });
      res.end(Buffer.from(bytes));
    });
    feedBase = await new Promise((resolve) => {
      feedServer.listen(0, "127.0.0.1", () => {
        const { port } = feedServer.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}`);
      });
    });

    const repository = openSpecLockRepository("/tmp/__rt_smoke_locks_unused.json");
    apiServer = createApiServer({ repository, rtNow: () => 1_030 });
    apiBase = await new Promise((resolve) => {
      apiServer.listen(0, "127.0.0.1", () => {
        const { port } = apiServer.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}`);
      });
    });
  });
  afterEach(async () => {
    await new Promise<void>((r) => apiServer.close(() => r()));
    await new Promise<void>((r) => feedServer.close(() => r()));
  });

  it("POST /rt/smoke は公開URLのprotobufをdecodeして鮮度を返す", async () => {
    const res = await fetch(`${apiBase}/rt/smoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: `${feedBase}/alerts.pb`, feedType: "service_alerts" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      stage: "decode",
      httpStatus: 200,
      feedType: "service_alerts",
      ageSec: 30,
      stale: false,
    });
    expect(body.summary.counts.alert).toBe(1);
  });
});
