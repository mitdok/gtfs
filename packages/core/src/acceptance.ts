/**
 * 実データ検収・最終OK判定（仕様 10.9 / 11章）。
 *
 * 11.1 の A-01〜A-10 を機械判定し、11.5 のJSON形に整形して返す。
 * 個々の検査の根拠（標準validator結果・回帰結果・公開URL検証）は呼び出し側が
 * 証跡として渡す。コアは判定ロジックのみを持ち、実行・保存は別レイヤが担う。
 */
import type { Feed } from "./model.js";
import { validateFeed, type ValidationReport } from "./validator.js";
import {
  SPEC_LOCKS,
  type SpecLock,
  type SpecLockId,
} from "./spec-lock.js";
import type { StandardValidatorResult } from "./standard-validator.js";

export type AcceptanceStatus = "ready" | "not_ready";
export type CheckStatus = "pass" | "fail" | "skip";

export type AcceptanceCheckId =
  | "A-01"
  | "A-02"
  | "A-03"
  | "A-04"
  | "A-05"
  | "A-06"
  | "A-07"
  | "A-08"
  | "A-09"
  | "A-10";

export interface AcceptanceCheck {
  id: AcceptanceCheckId;
  status: CheckStatus;
  detail: string;
  errors?: number;
  warnings?: number;
}

export interface AcceptanceReport {
  releaseCandidate?: string;
  status: AcceptanceStatus;
  executedAt?: string;
  specLocks: Record<SpecLockId, "locked" | "missing">;
  checks: AcceptanceCheck[];
}

/** 取込→再出力などの回帰結果（標準validatorのerror件数で合否を見る）。 */
export interface RegressionEvidence {
  standardErrors: number;
  note?: string;
}

export interface AcceptanceInput {
  /** 検収対象の最小サンプル/MVPフィード（A-03/A-05/A-06の内部検証に使う）。 */
  feed: Feed;
  releaseCandidate?: string;
  executedAt?: string;
  /** 公開ゲートの日付依存検証の基準日（YYYYMMDD）。 */
  validationDate?: string;
  /** 既定ロックへの上書き。 */
  specLocks?: Partial<Record<SpecLockId, SpecLock>>;
  /** A-02: プロファイル定義が設定化されているか。既定 true（profile.ts に定義済み）。 */
  profilesConfigured?: boolean;
  /** A-04: 生成zipの標準検証結果。未指定なら未実行扱いで fail。 */
  standardValidator?: StandardValidatorResult;
  /** A-05: gtfs-jp-v4 検証。未指定なら feed から内部検証する。 */
  v4Report?: ValidationReport;
  /** A-06: google-transit-ready 検証。未指定なら feed から内部検証する。 */
  googleReport?: ValidationReport;
  /** A-07: 実フィード取込→再出力の標準検証。 */
  realFeedRoundtrip?: RegressionEvidence;
  /** A-08: v3取込→v4出力の標準検証＋移行警告の妥当性。 */
  v3Migration?: RegressionEvidence & { warningsReasonable?: boolean };
  /** A-09: 公開URLから取得したzipの検証。 */
  publicUrl?: { verified: boolean; standardErrors?: number };
}

const ALL_LOCK_IDS: SpecLockId[] = [
  "GTFS_SCHEDULE_LOCK",
  "GTFS_JP_V4_LOCK",
  "GOOGLE_TRANSIT_LOCK",
  "VALIDATOR_LOCK",
];

/**
 * 検収レポートを評価する。status=ready は A-01〜A-10 がすべて pass のときのみ。
 */
export function evaluateAcceptance(input: AcceptanceInput): AcceptanceReport {
  const locks = { ...SPEC_LOCKS, ...input.specLocks };
  const lockStatus = {} as Record<SpecLockId, "locked" | "missing">;
  for (const id of ALL_LOCK_IDS) {
    lockStatus[id] = locks[id]?.status === "locked" ? "locked" : "missing";
  }

  const v4Report = input.v4Report ?? validateFeed(input.feed, {
    profileId: "gtfs-jp-v4",
    validationDate: input.validationDate,
  });
  const googleReport = input.googleReport ?? validateFeed(input.feed, {
    profileId: "google-transit-ready",
    validationDate: input.validationDate,
  });

  const checks: AcceptanceCheck[] = [];

  // A-01 公式仕様ロック
  const missingLocks = ALL_LOCK_IDS.filter((id) => lockStatus[id] !== "locked");
  checks.push({
    id: "A-01",
    status: missingLocks.length === 0 ? "pass" : "fail",
    detail:
      missingLocks.length === 0
        ? "公式仕様ロックがすべて設定済み"
        : `未ロック: ${missingLocks.join(", ")}`,
  });

  // A-02 プロファイル定義の設定化
  const profilesConfigured = input.profilesConfigured ?? true;
  checks.push({
    id: "A-02",
    status: profilesConfigured ? "pass" : "fail",
    detail: profilesConfigured
      ? "gtfs-base / gtfs-jp-v4 / google-transit-ready を定義済み"
      : "プロファイル定義が未設定",
  });

  // A-03 MVP生成（フィードに中核テーブルがあるか）
  const generated = input.feed.tables.size > 0;
  checks.push({
    id: "A-03",
    status: generated ? "pass" : "fail",
    detail: generated ? "固定路線バスの最小データを生成可能" : "生成対象フィードが空",
  });

  // A-04 標準検証（生成zip）
  const sv = input.standardValidator;
  if (!sv) {
    checks.push({ id: "A-04", status: "fail", detail: "生成zipに標準validatorを実行していない" });
  } else {
    checks.push({
      id: "A-04",
      status: sv.summary.errors === 0 ? "pass" : "fail",
      detail: `標準validator ${sv.validatorName}${sv.validatorVersion ? `@${sv.validatorVersion}` : ""}`,
      errors: sv.summary.errors,
      warnings: sv.summary.warnings,
    });
  }

  // A-05 gtfs-jp-v4 検証
  checks.push({
    id: "A-05",
    status: v4Report.summary.errors === 0 ? "pass" : "fail",
    detail: "gtfs-jp-v4 プロファイル検証",
    errors: v4Report.summary.errors,
    warnings: v4Report.summary.warnings,
  });

  // A-06 google-transit-ready 検証（warningは許容）
  checks.push({
    id: "A-06",
    status: googleReport.summary.errors === 0 ? "pass" : "fail",
    detail: "google-transit-ready プロファイル検証（warningは公開時確認付きで許容）",
    errors: googleReport.summary.errors,
    warnings: googleReport.summary.warnings,
  });

  // A-07 実フィード回帰
  checks.push(regressionCheck("A-07", input.realFeedRoundtrip, "実フィード取込→再出力"));

  // A-08 v3移行回帰（標準validator error 0 かつ 警告が妥当）
  if (!input.v3Migration) {
    checks.push({ id: "A-08", status: "fail", detail: "v3移行回帰が未実行" });
  } else {
    const reasonable = input.v3Migration.warningsReasonable ?? true;
    const ok = input.v3Migration.standardErrors === 0 && reasonable;
    checks.push({
      id: "A-08",
      status: ok ? "pass" : "fail",
      detail: reasonable
        ? "v3取込→v4出力の標準検証"
        : "v3移行警告が妥当性レビュー未通過",
      errors: input.v3Migration.standardErrors,
    });
  }

  // A-09 公開URL検証
  if (!input.publicUrl) {
    checks.push({ id: "A-09", status: "fail", detail: "公開URL経由zipの検証が未実行" });
  } else {
    const ok = input.publicUrl.verified && (input.publicUrl.standardErrors ?? 0) === 0;
    checks.push({
      id: "A-09",
      status: ok ? "pass" : "fail",
      detail: input.publicUrl.verified
        ? "公開URL取得zipの標準検証"
        : "公開URL取得zipが未検証",
      errors: input.publicUrl.standardErrors,
    });
  }

  // A-10 監査可能性（validator版・実行日時・仕様ロックが揃っているか）
  const auditable =
    missingLocks.length === 0 &&
    !!sv?.validatorVersion &&
    !!(sv?.executedAt || input.executedAt);
  checks.push({
    id: "A-10",
    status: auditable ? "pass" : "fail",
    detail: auditable
      ? "仕様ロック・validatorバージョン・実行日時・対象revisionを保存可能"
      : "監査情報（validatorバージョン/実行日時/仕様ロック）が不足",
  });

  const status: AcceptanceStatus = checks.every((c) => c.status === "pass")
    ? "ready"
    : "not_ready";

  return {
    releaseCandidate: input.releaseCandidate,
    status,
    executedAt: input.executedAt,
    specLocks: lockStatus,
    checks,
  };
}

function regressionCheck(
  id: AcceptanceCheckId,
  evidence: RegressionEvidence | undefined,
  label: string,
): AcceptanceCheck {
  if (!evidence) return { id, status: "fail", detail: `${label}が未実行` };
  return {
    id,
    status: evidence.standardErrors === 0 ? "pass" : "fail",
    detail: evidence.note ?? `${label}の標準検証`,
    errors: evidence.standardErrors,
  };
}
