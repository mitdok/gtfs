import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  importEntries,
  migrateToGtfsJpV4,
  exportToZip,
} from "@gtfs-studio/core";
import { openSpecLockRepository } from "../src/spec-lock-repository.js";

const enc = new TextEncoder();
import { createApiServer } from "../src/server.js";

const SAMPLE: Record<string, string> = {
  "agency.txt": "agency_id,agency_name,agency_url,agency_timezone\ntoyo,テスト交通,https://example.com,Asia/Tokyo\n",
  "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\nS1,駅前,34.7691,137.3916\nS2,市役所前,34.766,137.385\nS3,中央病院,34.76,137.38\n",
  "routes.txt": "route_id,agency_id,route_short_name,route_long_name,route_type\nR1,toyo,1,テスト線,3\n",
  "trips.txt": "route_id,service_id,trip_id,trip_headsign\nR1,weekday,T1,中央病院\nR1,weekday,T2,中央病院\n",
  "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,07:00:00,07:00:00,S1,1\nT1,07:05:00,07:05:00,S2,2\nT1,07:12:00,07:12:00,S3,3\nT2,08:00:00,08:00:00,S1,1\nT2,08:05:00,08:05:00,S2,2\nT2,08:12:00,08:12:00,S3,3\n",
  "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nweekday,1,1,1,1,1,0,0,20260401,20261231\n",
  "feed_info.txt": "feed_publisher_name,feed_publisher_url,feed_lang\nテスト,https://example.com,ja\n",
};

function goldenZipBase64(): string {
  const entries: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(SAMPLE)) entries[k] = enc.encode(v);
  const feed = migrateToGtfsJpV4(importEntries(entries).feed, { referenceDate: "20260601" }).feed;
  return Buffer.from(exportToZip(feed)).toString("base64");
}

const CLEAN_REPORT = {
  summary: { validatorVersion: "5.0.1", validatedAt: "2026-06-16T00:00:00Z" },
  notices: [{ code: "unknown_column", severity: "WARNING", totalNotices: 1 }],
};

let dir: string;
let server: Server;
let base: string;

function listen(s: Server): Promise<string> {
  return new Promise((resolve) => {
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "gtfs-api-srv-"));
  const repository = openSpecLockRepository(join(dir, "spec-locks.json"));
  server = createApiServer({ repository, now: () => "2026-06-16T00:00:00Z" });
  base = await listen(server);
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

describe("GTFS Studio API", () => {
  it("GET /health は ok", async () => {
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(200);
    expect((await r.json()).status).toBe("ok");
  });

  it("GET /spec-locks は既定ロック一覧を返す", async () => {
    const r = await fetch(`${base}/spec-locks`);
    const body = await r.json();
    expect(body.specLocks.map((l: { id: string }) => l.id)).toContain("GTFS_JP_V4_LOCK");
  });

  it("PUT /spec-locks/:id でロックを保存・取得できる", async () => {
    const put = await fetch(`${base}/spec-locks/VALIDATOR_LOCK`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "locked", version: "5.0.1", label: "MobilityData" }),
    });
    expect(put.status).toBe(200);
    const get = await fetch(`${base}/spec-locks/VALIDATOR_LOCK`);
    expect((await get.json()).status).toBe("locked");
  });

  it("未知の spec lock id は 404", async () => {
    const r = await fetch(`${base}/spec-locks/NOPE`);
    expect(r.status).toBe(404);
  });

  it("POST /acceptance: 証跡が揃えば ready", async () => {
    // 先に VALIDATOR_LOCK を保存（A-01/A-10 充足）
    await fetch(`${base}/spec-locks/VALIDATOR_LOCK`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "locked", version: "5.0.1", label: "MobilityData" }),
    });
    const r = await fetch(`${base}/acceptance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        zipBase64: goldenZipBase64(),
        profileId: "gtfs-jp-v4",
        validationDate: "20260601",
        standardReport: CLEAN_REPORT,
        realFeedRoundtrip: { standardErrors: 0 },
        v3Migration: { standardErrors: 0, warningsReasonable: true },
        publicUrl: { verified: true, standardErrors: 0 },
        releaseCandidate: "0.1.0-rc.1",
      }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.status, JSON.stringify(body.acceptance?.checks?.filter((c: { status: string }) => c.status !== "pass"))).toBe("ready");
    expect(body.validation.gtfsJpV4.errors).toBe(0);
  });

  it("POST /acceptance: report 無しは not_ready", async () => {
    const r = await fetch(`${base}/acceptance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ zipBase64: goldenZipBase64(), validationDate: "20260601" }),
    });
    const body = await r.json();
    expect(body.status).toBe("not_ready");
    expect(body.gate.blockers.some((b: { code: string }) => b.code === "validator_not_executed")).toBe(true);
  });

  it("POST /acceptance: zipBase64 欠落は 400", async () => {
    const r = await fetch(`${base}/acceptance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profileId: "gtfs-jp-v4" }),
    });
    expect(r.status).toBe(400);
  });
});
