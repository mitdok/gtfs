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
import { openRevisionRepository } from "../src/revision-repository.js";

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
  return sampleZipBase64(SAMPLE);
}

function sampleZipBase64(sample: Record<string, string>): string {
  const entries: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(sample)) entries[k] = enc.encode(v);
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
  const revisions = openRevisionRepository(join(dir, "revisions"));
  server = createApiServer({ repository, revisions, now: () => "2026-06-16T00:00:00Z" });
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

  it("static write token設定時は全非GET APIを一律認証する", async () => {
    const authDir = mkdtempSync(join(tmpdir(), "gtfs-api-global-auth-"));
    const repository = openSpecLockRepository(join(authDir, "spec-locks.json"));
    const authServer = createApiServer({ repository, staticWriteTokens: ["admin-token"] });
    const authBase = await listen(authServer);
    try {
      const cases: Array<{ path: string; method: string; body?: unknown }> = [
        {
          path: "/spec-locks/VALIDATOR_LOCK",
          method: "PUT",
          body: { status: "locked", version: "8.0.1", label: "MobilityData" },
        },
        { path: "/acceptance", method: "POST", body: {} },
        { path: "/rt/sources/untrusted", method: "PUT", body: { url: "http://127.0.0.1/private" } },
        { path: "/rt/sources/untrusted/poll", method: "POST" },
        { path: "/rt/alerts", method: "POST", body: {} },
        { path: "/rt/static-compat/check", method: "POST", body: {} },
      ];

      for (const testCase of cases) {
        const rejected = await fetch(`${authBase}${testCase.path}`, {
          method: testCase.method,
          headers: testCase.body ? { "content-type": "application/json" } : undefined,
          body: testCase.body ? JSON.stringify(testCase.body) : undefined,
        });
        expect(rejected.status, `${testCase.method} ${testCase.path}`).toBe(401);
      }

      const accepted = await fetch(`${authBase}/spec-locks/VALIDATOR_LOCK`, {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: "Bearer admin-token" },
        body: JSON.stringify({ status: "locked", version: "8.0.1", label: "MobilityData" }),
      });
      expect(accepted.status).toBe(200);

      const anonymousRead = await fetch(`${authBase}/spec-locks/VALIDATOR_LOCK`);
      expect(anonymousRead.status).toBe(200);
      expect((await anonymousRead.json()).status).toBe("locked");
    } finally {
      await new Promise<void>((resolve) => authServer.close(() => resolve()));
      rmSync(authDir, { recursive: true, force: true });
    }
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

  it("POST /projects/:project/revisions で版を保存し、zipを取得できる", async () => {
    const zipBase64 = goldenZipBase64();
    const r = await fetch(`${base}/projects/demo/revisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "rev_test",
        zipBase64,
        profileId: "gtfs-jp-v4",
        validationDate: "20260601",
      }),
    });
    expect(r.status).toBe(201);
    const revision = await r.json();
    expect(revision.id).toBe("rev_test");
    expect(revision.status).toBe("validated");
    expect(revision.zipSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(revision.acceptance.status).toBe("not_ready");

    const detail = await fetch(`${base}/projects/demo/revisions/rev_test`);
    expect(detail.status).toBe(200);
    expect((await detail.json()).validation.gtfsJpV4.errors).toBe(0);

    const zip = await fetch(`${base}/projects/demo/revisions/rev_test/gtfs.zip`);
    expect(zip.status).toBe(200);
    expect(zip.headers.get("content-type")).toBe("application/zip");
    expect(Buffer.from(await zip.arrayBuffer()).toString("base64")).toBe(zipBase64);
  });

  it("GET /projects/:project/revisions はlimitできる", async () => {
    for (const id of ["rev_old", "rev_mid", "rev_new"]) {
      const r = await fetch(`${base}/projects/demo/revisions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, zipBase64: goldenZipBase64() }),
      });
      expect(r.status).toBe(201);
    }

    const limited = await fetch(`${base}/projects/demo/revisions?limit=2`);
    expect(limited.status).toBe(200);
    const body = await limited.json();
    expect(body.total).toBe(3);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(0);
    expect(body.hasMore).toBe(true);
    expect(body.statusCounts).toEqual({ validated: 3, published: 0, superseded: 0 });
    expect(body.revisions).toHaveLength(2);

    const next = await fetch(`${base}/projects/demo/revisions?limit=2&offset=2`);
    expect(next.status).toBe(200);
    const nextBody = await next.json();
    expect(nextBody.total).toBe(3);
    expect(nextBody.offset).toBe(2);
    expect(nextBody.hasMore).toBe(false);
    expect(nextBody.revisions).toHaveLength(1);
  });

  it("ready な版だけ publish でき、latest zip として配信する", async () => {
    await fetch(`${base}/spec-locks/VALIDATOR_LOCK`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "locked", version: "5.0.1", label: "MobilityData" }),
    });
    const zipBase64 = goldenZipBase64();
    const create = await fetch(`${base}/projects/demo/revisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "rev_ready",
        zipBase64,
        profileId: "gtfs-jp-v4",
        validationDate: "20260601",
        standardReport: CLEAN_REPORT,
        realFeedRoundtrip: { standardErrors: 0 },
        v3Migration: { standardErrors: 0, warningsReasonable: true },
        publicUrl: { verified: true, standardErrors: 0 },
        releaseCandidate: "0.1.0-rc.1",
      }),
    });
    expect(create.status).toBe(201);
    expect((await create.json()).acceptance.status).toBe("ready");

    const publish = await fetch(`${base}/projects/demo/revisions/rev_ready:publish`, { method: "POST" });
    expect(publish.status).toBe(200);
    expect((await publish.json()).status).toBe("published");

    const latest = await fetch(`${base}/projects/demo/latest/gtfs.zip`);
    expect(latest.status).toBe(200);
    expect(latest.headers.get("x-gtfs-revision")).toBe("rev_ready");
    expect(Buffer.from(await latest.arrayBuffer()).toString("base64")).toBe(zipBase64);

    const createNext = await fetch(`${base}/projects/demo/revisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "rev_ready_next",
        zipBase64,
        profileId: "gtfs-jp-v4",
        validationDate: "20260601",
        standardReport: CLEAN_REPORT,
        realFeedRoundtrip: { standardErrors: 0 },
        v3Migration: { standardErrors: 0, warningsReasonable: true },
        publicUrl: { verified: true, standardErrors: 0 },
      }),
    });
    expect(createNext.status).toBe(201);
    const publishNext = await fetch(`${base}/projects/demo/revisions/rev_ready_next:publish`, { method: "POST" });
    expect(publishNext.status).toBe(200);
    expect((await fetch(`${base}/projects/demo/revisions/rev_ready`).then((r) => r.json())).status).toBe("superseded");
    expect((await fetch(`${base}/projects/demo/revisions/rev_ready_next`).then((r) => r.json())).status).toBe("published");

    const publishedList = await fetch(`${base}/projects/demo/revisions?status=published`);
    expect(publishedList.status).toBe(200);
    const publishedBody = await publishedList.json();
    expect(publishedBody.total).toBe(1);
    expect(publishedBody.statusCounts).toEqual({ validated: 0, published: 1, superseded: 1 });
    expect(publishedBody.revisions.map((revision: { id: string }) => revision.id)).toEqual(["rev_ready_next"]);

    const supersededList = await fetch(`${base}/projects/demo/revisions?status=superseded`);
    expect(supersededList.status).toBe(200);
    const supersededBody = await supersededList.json();
    expect(supersededBody.total).toBe(1);
    expect(supersededBody.revisions.map((revision: { id: string }) => revision.id)).toEqual(["rev_ready"]);

    const invalidStatus = await fetch(`${base}/projects/demo/revisions?status=archived`);
    expect(invalidStatus.status).toBe(400);

    const smoke = await fetch(`${base}/projects/demo/revisions/rev_ready_next/public-url-smoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: `${base}/projects/demo/latest/gtfs.zip`,
        validationDate: "20260601",
        standardReport: CLEAN_REPORT,
      }),
    });
    expect(smoke.status).toBe(200);
    const smokeBody = await smoke.json();
    expect(smokeBody.verified).toBe(true);
    expect(smokeBody.sha256Matched).toBe(true);
    expect(smokeBody.validation.gtfsJpV4.errors).toBe(0);
    expect(smokeBody.publicUrl).toEqual({ verified: true, standardErrors: 0 });
  });

  it("not_ready な版は publish できない", async () => {
    await fetch(`${base}/projects/demo/revisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "rev_not_ready", zipBase64: goldenZipBase64() }),
    });
    const publish = await fetch(`${base}/projects/demo/revisions/rev_not_ready:publish`, { method: "POST" });
    expect(publish.status).toBe(409);
  });

  it("public URL smoke は保存済み版と異なるzipを検出する", async () => {
    await fetch(`${base}/spec-locks/VALIDATOR_LOCK`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "locked", version: "5.0.1", label: "MobilityData" }),
    });
    await fetch(`${base}/projects/demo/revisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "rev_expected",
        zipBase64: goldenZipBase64(),
        standardReport: CLEAN_REPORT,
        realFeedRoundtrip: { standardErrors: 0 },
        v3Migration: { standardErrors: 0, warningsReasonable: true },
        publicUrl: { verified: true, standardErrors: 0 },
      }),
    });
    await fetch(`${base}/projects/demo/revisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "rev_published",
        zipBase64: sampleZipBase64({
          ...SAMPLE,
          "feed_info.txt": "feed_publisher_name,feed_publisher_url,feed_lang\n別テスト,https://example.com,ja\n",
        }),
        standardReport: CLEAN_REPORT,
        realFeedRoundtrip: { standardErrors: 0 },
        v3Migration: { standardErrors: 0, warningsReasonable: true },
        publicUrl: { verified: true, standardErrors: 0 },
      }),
    });
    const publish = await fetch(`${base}/projects/demo/revisions/rev_published:publish`, { method: "POST" });
    expect(publish.status).toBe(200);

    const smoke = await fetch(`${base}/projects/demo/revisions/rev_expected/public-url-smoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: `${base}/projects/demo/latest/gtfs.zip` }),
    });
    expect(smoke.status).toBe(200);
    const body = await smoke.json();
    expect(body.verified).toBe(false);
    expect(body.sha256Matched).toBe(false);
  });

  it("public URL smoke はurl必須・http/httpsのみ許可", async () => {
    await fetch(`${base}/projects/demo/revisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "rev_smoke_bad", zipBase64: goldenZipBase64() }),
    });

    const missingUrl = await fetch(`${base}/projects/demo/revisions/rev_smoke_bad/public-url-smoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(missingUrl.status).toBe(400);
    expect(await missingUrl.text()).toContain("url is required");

    const fileUrl = await fetch(`${base}/projects/demo/revisions/rev_smoke_bad/public-url-smoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "file:///tmp/gtfs.zip" }),
    });
    expect(fileUrl.status).toBe(400);
    expect(await fileUrl.text()).toContain("url must be http or https");
  });

  it("revision warning approvals を保存・取得できる", async () => {
    await fetch(`${base}/projects/demo/revisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "rev_warn", zipBase64: goldenZipBase64() }),
    });

    const approval = {
      key: "missing_contact:{\"type\":\"agency\"}:0",
      code: "missing_contact",
      message: "agency/feed_infoに問い合わせ先がありません",
      entity: { type: "agency", id: "toyo" },
      impact: "公開前に問い合わせ窓口を別文書で案内する",
      approver: "ops@example.com",
      approvedAt: "2026-06-16T00:00:00Z",
    };
    const saved = await fetch(`${base}/projects/demo/revisions/rev_warn/warning-approvals`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvals: [approval] }),
    });
    expect(saved.status).toBe(200);
    expect((await saved.json()).approvals).toEqual([approval]);

    const listed = await fetch(`${base}/projects/demo/revisions/rev_warn/warning-approvals`);
    expect(listed.status).toBe(200);
    expect((await listed.json()).approvals).toEqual([approval]);

    const revision = await fetch(`${base}/projects/demo/revisions/rev_warn`);
    expect((await revision.json()).warningApprovals).toEqual([approval]);

    const list = await fetch(`${base}/projects/demo/revisions`);
    expect((await list.json()).revisions[0].warningApprovals).toEqual([approval]);
  });

  it("revision warning approvals は必須項目と日時を検証する", async () => {
    await fetch(`${base}/projects/demo/revisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "rev_bad_warn", zipBase64: goldenZipBase64() }),
    });

    const missingApprover = await fetch(`${base}/projects/demo/revisions/rev_bad_warn/warning-approvals`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        approvals: [
          {
            key: "missing_contact:{}:0",
            code: "missing_contact",
            message: "agency/feed_infoに問い合わせ先がありません",
            impact: "確認済み",
            approvedAt: "2026-06-16T00:00:00Z",
          },
        ],
      }),
    });
    expect(missingApprover.status).toBe(400);
    expect(await missingApprover.text()).toContain("approval.approver is required");

    const invalidDate = await fetch(`${base}/projects/demo/revisions/rev_bad_warn/warning-approvals`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        approvals: [
          {
            key: "missing_contact:{}:0",
            code: "missing_contact",
            message: "agency/feed_infoに問い合わせ先がありません",
            impact: "確認済み",
            approver: "ops",
            approvedAt: "not-a-date",
          },
        ],
      }),
    });
    expect(invalidDate.status).toBe(400);
    expect(await invalidDate.text()).toContain("invalid approval.approvedAt");
  });

  it("static write token設定時はrevision操作を認証し監査ログに記録する", async () => {
    const authDir = mkdtempSync(join(tmpdir(), "gtfs-api-auth-"));
    const repository = openSpecLockRepository(join(authDir, "spec-locks.json"));
    const revisions = openRevisionRepository(join(authDir, "revisions"));
    const authServer = createApiServer({
      repository,
      revisions,
      staticWriteTokens: ["admin-token"],
      now: () => "2026-06-16T00:00:00Z",
    });
    const authBase = await listen(authServer);
    try {
      await fetch(`${authBase}/spec-locks/VALIDATOR_LOCK`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "locked", version: "5.0.1", label: "MobilityData" }),
      });

      const rejected = await fetch(`${authBase}/projects/demo/revisions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "rev_auth", zipBase64: goldenZipBase64() }),
      });
      expect(rejected.status).toBe(401);

      const created = await fetch(`${authBase}/projects/demo/revisions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer admin-token" },
        body: JSON.stringify({
          id: "rev_auth",
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
      expect(created.status).toBe(201);

      const publish = await fetch(`${authBase}/projects/demo/revisions/rev_auth:publish`, {
        method: "POST",
        headers: { "x-api-token": "admin-token" },
      });
      expect(publish.status).toBe(200);

      const smoke = await fetch(`${authBase}/projects/demo/revisions/rev_auth/public-url-smoke`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer admin-token" },
        body: JSON.stringify({
          url: `${authBase}/projects/demo/latest/gtfs.zip`,
          validationDate: "20260601",
          standardReport: CLEAN_REPORT,
        }),
      });
      expect(smoke.status).toBe(200);

      const rejectedApproval = await fetch(`${authBase}/projects/demo/revisions/rev_auth/warning-approvals`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvals: [] }),
      });
      expect(rejectedApproval.status).toBe(401);

      const approval = await fetch(`${authBase}/projects/demo/revisions/rev_auth/warning-approvals`, {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: "Bearer admin-token" },
        body: JSON.stringify({
          approvals: [
            {
              key: "missing_contact:{}:0",
              code: "missing_contact",
              message: "agency/feed_infoに問い合わせ先がありません",
              impact: "公開前確認済み",
              approver: "admin",
              approvedAt: "2026-06-16T00:00:00Z",
            },
          ],
        }),
      });
      expect(approval.status).toBe(200);

      const audit = await fetch(`${authBase}/projects/demo/audit`, {
        headers: { authorization: "Bearer admin-token" },
      });
      expect(audit.status).toBe(200);
      const body = await audit.json();
      expect(body.events.map((event: { action: string }) => event.action)).toEqual([
        "revision.warning_approvals",
        "revision.auth_failed",
        "revision.public_url_smoke",
        "revision.publish",
        "revision.create",
        "revision.auth_failed",
      ]);
      expect(body.events[0]).toMatchObject({ outcome: "success", targetId: "rev_auth" });
      expect(body.events[1]).toMatchObject({ outcome: "blocked", targetId: "rev_auth" });
      expect(body.events[5]).toMatchObject({ outcome: "blocked", targetId: "demo" });
    } finally {
      await new Promise<void>((r) => authServer.close(() => r()));
      rmSync(authDir, { recursive: true, force: true });
    }
  });
});
