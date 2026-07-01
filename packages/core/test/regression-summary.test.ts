import { describe, expect, it } from "vitest";
import { evidenceFromRegressionSummary } from "../src/regression-summary.js";

const SUMMARY = {
  results: [
    {
      id: "real-feed-roundtrip-1",
      mode: "roundtrip",
      review: { ready: true },
      acceptanceEvidence: { standardErrors: 0, note: "roundtrip evidence" },
    },
    {
      id: "v3-migration-1",
      mode: "v3-migration",
      review: { ready: true },
      standard: { summary: { errors: 1 } },
    },
  ],
};

describe("regression summary evidence", () => {
  it("A-07/A-08 の証跡を mode から抽出する", () => {
    const evidence = evidenceFromRegressionSummary(SUMMARY);
    expect(evidence.realFeedRoundtrip).toEqual({ standardErrors: 0, note: "roundtrip evidence" });
    expect(evidence.v3Migration).toEqual({
      standardErrors: 1,
      note: "v3-migration: v3-migration-1",
      warningsReasonable: true,
    });
  });

  it("case id を明示できる", () => {
    const evidence = evidenceFromRegressionSummary(SUMMARY, {
      roundtripCaseId: "real-feed-roundtrip-1",
      v3CaseId: "v3-migration-1",
    });
    expect(evidence.realFeedRoundtrip?.standardErrors).toBe(0);
    expect(evidence.v3Migration?.standardErrors).toBe(1);
  });

  it("requireReviewed では未レビューcaseを拒否する", () => {
    expect(() =>
      evidenceFromRegressionSummary({
        results: [{ id: "r1", mode: "roundtrip", review: { ready: false, issues: ["license"] }, standard: { summary: { errors: 0 } } }],
      }, { requireReviewed: true }),
    ).toThrow(/レビュー未完了/);
  });

  it("mode が違う case id は拒否する", () => {
    expect(() => evidenceFromRegressionSummary(SUMMARY, { roundtripCaseId: "v3-migration-1" })).toThrow(/mode=v3-migration/);
  });
});
