import type { RegressionEvidence } from "./acceptance.js";

export interface RegressionSummaryCase {
  id: string;
  mode?: "roundtrip" | "v3-migration" | string;
  standard?: { summary?: { errors?: number } };
  acceptanceEvidence?: RegressionEvidence;
  review?: { ready?: boolean; issues?: string[] };
}

export interface RegressionSummary {
  results?: RegressionSummaryCase[];
}

export interface RegressionEvidenceOptions {
  /** A-07 に使う case id。未指定なら mode=roundtrip の最初の結果。 */
  roundtripCaseId?: string;
  /** A-08 に使う case id。未指定なら mode=v3-migration の最初の結果。 */
  v3CaseId?: string;
  /** true の場合、review.ready=false の case を証跡として採用しない。 */
  requireReviewed?: boolean;
}

export interface RegressionAcceptanceEvidence {
  realFeedRoundtrip?: RegressionEvidence;
  v3Migration?: RegressionEvidence & { warningsReasonable?: boolean };
}

export function parseRegressionSummary(input: string | RegressionSummary): RegressionSummary {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input) as RegressionSummary;
  } catch (e) {
    throw new Error(`回帰summary JSONの解析に失敗しました: ${(e as Error).message}`);
  }
}

export function evidenceFromRegressionSummary(
  input: string | RegressionSummary,
  options: RegressionEvidenceOptions = {},
): RegressionAcceptanceEvidence {
  const summary = parseRegressionSummary(input);
  const results = Array.isArray(summary.results) ? summary.results : [];
  const roundtrip = pickCase(results, "roundtrip", options.roundtripCaseId, options.requireReviewed);
  const v3 = pickCase(results, "v3-migration", options.v3CaseId, options.requireReviewed);

  return {
    realFeedRoundtrip: roundtrip ? toEvidence(roundtrip) : undefined,
    v3Migration: v3 ? { ...toEvidence(v3), warningsReasonable: true } : undefined,
  };
}

function pickCase(
  results: RegressionSummaryCase[],
  mode: "roundtrip" | "v3-migration",
  id: string | undefined,
  requireReviewed: boolean | undefined,
): RegressionSummaryCase | undefined {
  const found = id
    ? results.find((result) => result.id === id)
    : results.find((result) => result.mode === mode);
  if (!found) return undefined;
  if (found.mode && found.mode !== mode) {
    throw new Error(`回帰case ${found.id} は mode=${found.mode} のため ${mode} 証跡に使えません`);
  }
  if (requireReviewed && found.review?.ready !== true) {
    const issues = found.review?.issues?.join(", ") || "review is not ready";
    throw new Error(`回帰case ${found.id} はレビュー未完了です: ${issues}`);
  }
  return found;
}

function toEvidence(result: RegressionSummaryCase): RegressionEvidence {
  const fromEvidence = result.acceptanceEvidence?.standardErrors;
  const fromStandard = result.standard?.summary?.errors;
  const standardErrors = Number(fromEvidence ?? fromStandard);
  if (!Number.isFinite(standardErrors)) {
    throw new Error(`回帰case ${result.id} に standardErrors がありません`);
  }
  return {
    standardErrors,
    note: result.acceptanceEvidence?.note ?? `${result.mode ?? "regression"}: ${result.id}`,
  };
}
