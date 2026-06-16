/**
 * 検収パイプライン（仕様 10.7 の検証順 / 11.4 検収コマンドの中核）。
 *
 * 取込済み Feed または zip バイト列を起点に、内部検証（v4 / google）→ 標準validator
 * 結果取込 → 仕様ロック確定 → 公開ゲート・検収（A-01〜A-10）までを 1 関数にまとめる。
 * fs / プロセス起動には依存せず（バイト列と report.json 文字列を受け取る）、CLI/API/Web の
 * いずれからも同じ判定を再利用できる。
 */
import { importGtfsZip } from "./importer.js";
import type { Feed } from "./model.js";
import { validateFeed, type ValidationReport } from "./validator.js";
import { createSpecLockStore, type SpecLock, type SpecLockId } from "./spec-lock.js";
import {
  parseStandardValidatorReport,
  toStandardValidatorSummary,
  validatorLockFromResult,
  type MobilityDataReport,
  type StandardValidatorResult,
} from "./standard-validator.js";
import { evaluateReleaseGate, type ReleaseGateReport } from "./release-gate.js";
import {
  evaluateAcceptance,
  type AcceptanceReport,
  type RegressionEvidence,
} from "./acceptance.js";

export interface AcceptancePipelineInput {
  /** 検収対象。zip バイト列か、取込済み Feed のどちらか一方を渡す。 */
  feed?: Feed;
  zip?: Uint8Array;
  /** 公開プロファイル（既定 gtfs-jp-v4）。 */
  profileId?: string;
  /** 日付依存検証の基準日（YYYYMMDD）。 */
  validationDate?: string;
  /** 既に実行した MobilityData validator の report.json（文字列 or オブジェクト）。 */
  standardReport?: string | MobilityDataReport;
  /** 既定ロックへの上書き（テスト/運用での明示指定）。 */
  specLocks?: Partial<Record<SpecLockId, SpecLock>>;
  /** 回帰・公開URL検証の証跡（11章 A-07〜A-09）。 */
  realFeedRoundtrip?: RegressionEvidence;
  v3Migration?: RegressionEvidence & { warningsReasonable?: boolean };
  publicUrl?: { verified: boolean; standardErrors?: number };
  releaseCandidate?: string;
  executedAt?: string;
}

export interface AcceptancePipelineResult {
  profileId: string;
  feed: Feed;
  importWarnings: string[];
  standardValidator?: StandardValidatorResult;
  v4Validation: ValidationReport;
  googleValidation: ValidationReport;
  gate: ReleaseGateReport;
  acceptance: AcceptanceReport;
}

/**
 * 検収パイプラインを実行する。zip を渡した場合は取込（文字コード自動判定）から行う。
 */
export function runAcceptancePipeline(input: AcceptancePipelineInput): AcceptancePipelineResult {
  const profileId = input.profileId ?? "gtfs-jp-v4";

  let feed: Feed;
  let importWarnings: string[] = [];
  if (input.feed) {
    feed = input.feed;
  } else if (input.zip) {
    const imported = importGtfsZip(input.zip);
    feed = imported.feed;
    importWarnings = imported.warnings;
  } else {
    throw new Error("runAcceptancePipeline には feed または zip が必要です");
  }

  const standardValidator = input.standardReport
    ? parseStandardValidatorReport(input.standardReport)
    : undefined;

  // 仕様ロック: 既定 + 明示上書き + validator結果由来の VALIDATOR_LOCK。
  const store = createSpecLockStore(input.specLocks);
  if (standardValidator) {
    store.set(validatorLockFromResult(standardValidator, { runMethod: "pipeline" }));
  }
  const specLockSnapshot = store.snapshot();

  const v4Validation = validateFeed(feed, {
    profileId: "gtfs-jp-v4",
    validationDate: input.validationDate,
  });
  const googleValidation = validateFeed(feed, {
    profileId: "google-transit-ready",
    validationDate: input.validationDate,
  });

  const gate = evaluateReleaseGate(feed, {
    profileId,
    validationDate: input.validationDate,
    specLocks: specLockSnapshot,
    standardValidator: standardValidator
      ? toStandardValidatorSummary(standardValidator)
      : undefined,
  });

  const acceptance = evaluateAcceptance({
    feed,
    releaseCandidate: input.releaseCandidate,
    executedAt: input.executedAt,
    validationDate: input.validationDate,
    specLocks: specLockSnapshot,
    standardValidator,
    v4Report: v4Validation,
    googleReport: googleValidation,
    realFeedRoundtrip: input.realFeedRoundtrip,
    v3Migration: input.v3Migration,
    publicUrl: input.publicUrl,
  });

  return {
    profileId,
    feed,
    importWarnings,
    standardValidator,
    v4Validation,
    googleValidation,
    gate,
    acceptance,
  };
}
