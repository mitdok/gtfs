import { describe, it, expect } from "vitest";
import { importEntries } from "../src/importer.js";
import { migrateToGtfsJpV4 } from "../src/migration.js";
import { evaluateAcceptance } from "../src/acceptance.js";
import {
  parseStandardValidatorReport,
  validatorLockFromResult,
} from "../src/standard-validator.js";
import { sampleEntries } from "./fixtures.js";

/** 検収対象: SAMPLE を v4 へ移行した golden feed。 */
function goldenFeed() {
  return migrateToGtfsJpV4(importEntries(sampleEntries()).feed, {
    referenceDate: "20260601",
  }).feed;
}

const CLEAN_REPORT = parseStandardValidatorReport({
  summary: { validatorVersion: "5.0.1", validatedAt: "2026-06-16T00:00:00Z" },
  notices: [{ code: "unknown_column", severity: "WARNING", totalNotices: 1 }],
});

/** A-01〜A-10 をすべて満たす証跡。 */
function fullEvidence() {
  return {
    feed: goldenFeed(),
    releaseCandidate: "0.1.0-rc.1",
    executedAt: "2026-06-16T00:00:00Z",
    validationDate: "20260601",
    specLocks: { VALIDATOR_LOCK: validatorLockFromResult(CLEAN_REPORT, { runMethod: "docker" }) },
    standardValidator: CLEAN_REPORT,
    realFeedRoundtrip: { standardErrors: 0 },
    v3Migration: { standardErrors: 0, warningsReasonable: true },
    publicUrl: { verified: true, standardErrors: 0 },
  };
}

describe("検収（A-01〜A-10）", () => {
  it("証跡が揃えば ready", () => {
    const report = evaluateAcceptance(fullEvidence());
    const fails = report.checks.filter((c) => c.status !== "pass");
    expect(fails, JSON.stringify(fails)).toHaveLength(0);
    expect(report.status).toBe("ready");
    expect(report.specLocks.VALIDATOR_LOCK).toBe("locked");
  });

  it("標準validatorが未実行なら A-04 と A-10 が fail で not_ready", () => {
    const ev = fullEvidence();
    delete (ev as Record<string, unknown>).standardValidator;
    const report = evaluateAcceptance(ev);
    expect(report.status).toBe("not_ready");
    expect(report.checks.find((c) => c.id === "A-04")?.status).toBe("fail");
    expect(report.checks.find((c) => c.id === "A-10")?.status).toBe("fail");
  });

  it("標準validatorにerrorがあれば A-04 fail", () => {
    const ev = fullEvidence();
    ev.standardValidator = parseStandardValidatorReport({
      summary: { validatorVersion: "5.0.1" },
      notices: [{ code: "invalid_row_length", severity: "ERROR", totalNotices: 1 }],
    });
    const report = evaluateAcceptance(ev);
    expect(report.checks.find((c) => c.id === "A-04")?.status).toBe("fail");
    expect(report.status).toBe("not_ready");
  });

  it("VALIDATOR_LOCK 未設定なら A-01 fail", () => {
    const ev = fullEvidence();
    delete (ev as Record<string, unknown>).specLocks;
    const report = evaluateAcceptance(ev);
    expect(report.specLocks.VALIDATOR_LOCK).toBe("missing");
    expect(report.checks.find((c) => c.id === "A-01")?.status).toBe("fail");
  });
});
