import { describe, it, expect } from "vitest";
import { importEntries } from "../src/importer.js";
import { migrateToGtfsJpV4 } from "../src/migration.js";
import { exportToZip } from "../src/exporter.js";
import { runAcceptancePipeline } from "../src/pipeline.js";
import { sampleEntries } from "./fixtures.js";

/** SAMPLE を v4 へ移行した zip を作る。 */
function goldenZip(): Uint8Array {
  const feed = migrateToGtfsJpV4(importEntries(sampleEntries()).feed, {
    referenceDate: "20260601",
  }).feed;
  return exportToZip(feed);
}

const CLEAN_REPORT = JSON.stringify({
  summary: { validatorVersion: "5.0.1", validatedAt: "2026-06-16T00:00:00Z" },
  notices: [{ code: "unknown_column", severity: "WARNING", totalNotices: 1 }],
});

describe("検収パイプライン", () => {
  it("zip取込→検証→検収を一括実行し、証跡が揃えば ready", () => {
    const result = runAcceptancePipeline({
      zip: goldenZip(),
      validationDate: "20260601",
      standardReport: CLEAN_REPORT,
      realFeedRoundtrip: { standardErrors: 0 },
      v3Migration: { standardErrors: 0, warningsReasonable: true },
      publicUrl: { verified: true, standardErrors: 0 },
      releaseCandidate: "0.1.0-rc.1",
      executedAt: "2026-06-16T00:00:00Z",
    });
    expect(result.v4Validation.summary.errors).toBe(0);
    expect(result.standardValidator?.validatorVersion).toBe("5.0.1");
    expect(result.gate.status).toBe("ready");
    expect(result.acceptance.status).toBe("ready");
    expect(result.acceptance.specLocks.VALIDATOR_LOCK).toBe("locked");
  });

  it("report.json 未指定なら validator 未実行で not_ready", () => {
    const result = runAcceptancePipeline({ zip: goldenZip(), validationDate: "20260601" });
    expect(result.standardValidator).toBeUndefined();
    expect(result.gate.status).toBe("not_ready");
    expect(result.gate.blockers.some((b) => b.code === "validator_not_executed")).toBe(true);
    expect(result.acceptance.checks.find((c) => c.id === "A-04")?.status).toBe("fail");
  });

  it("feed も zip も無ければ例外", () => {
    expect(() => runAcceptancePipeline({})).toThrow(/feed または zip/);
  });
});
