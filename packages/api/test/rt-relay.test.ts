import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  createRealtimeAlertStore,
  createRealtimeTripUpdateStore,
  createRealtimeVehicleStore,
  decodeRealtimeFeed,
  encodeServiceAlertsFeed,
} from "@gtfs-studio/core/realtime";
import { openSpecLockRepository } from "../src/spec-lock-repository.js";
import { createRtRelayService, type RtFetch, type RtFetchResponse } from "../src/rt-relay.js";
import { createApiServer } from "../src/server.js";

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
      body: JSON.stringify({ url: "http://feed/b.pb", feedType: "service_alerts", pollIntervalSec: 60 }),
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

  it("未pollのsourceの feed.pb は 503", async () => {
    await fetch(`${base}/rt/sources/src3`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "http://feed/c.pb", feedType: "service_alerts", pollIntervalSec: 30 }),
    });
    const pb = await fetch(`${base}/rt/sources/src3/feed.pb`);
    expect(pb.status).toBe(503);
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
