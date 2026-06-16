import type { Feed } from "./model.js";
import {
  SPEC_LOCKS,
  requiredSpecLocksForProfile,
  type SpecLock,
  type SpecLockId,
} from "./spec-lock.js";
import { validateFeed, type ValidateOptions, type ValidationReport } from "./validator.js";

export type ReleaseGateStatus = "ready" | "not_ready";

export type ReleaseBlockerCode =
  | "spec_lock_missing"
  | "gtfs_jp_matrix_unverified"
  | "validator_not_executed"
  | "validator_error_exists"
  | "profile_error_exists"
  | "golden_feed_failed"
  | "public_url_unverified";

export interface StandardValidatorSummary {
  executed: boolean;
  validatorName?: string;
  validatorVersion?: string;
  errors: number;
  warnings?: number;
}

export interface ReleaseGateOptions extends ValidateOptions {
  profileId: string;
  specLocks?: Partial<Record<SpecLockId, SpecLock>>;
  standardValidator?: StandardValidatorSummary;
  gtfsJpMatrixVerified?: boolean;
  goldenFeedPassed?: boolean;
  publicUrlVerified?: boolean;
}

export interface ReleaseBlocker {
  code: ReleaseBlockerCode;
  message: string;
  entity?: { type: string; id?: string; [key: string]: unknown };
}

export interface ReleaseGateReport {
  status: ReleaseGateStatus;
  profileId: string;
  validation: ValidationReport;
  requiredSpecLocks: SpecLockId[];
  blockers: ReleaseBlocker[];
}

/**
 * 公開可否ゲート。
 *
 * 自前プロファイル検証だけでなく、仕様ロックと標準validator結果をまとめて
 * 「公開してよいか」に変換する。外部validator実行自体は別レイヤで行い、
 * 結果サマリを standardValidator に渡す。
 */
export function evaluateReleaseGate(feed: Feed, options: ReleaseGateOptions): ReleaseGateReport {
  const validation = validateFeed(feed, options);
  const blockers: ReleaseBlocker[] = [];
  const requiredSpecLocks = requiredSpecLocksForProfile(options.profileId);
  const locks = { ...SPEC_LOCKS, ...options.specLocks };

  for (const id of requiredSpecLocks) {
    const lock = locks[id];
    if (!lock || lock.status !== "locked") {
      blockers.push({
        code: "spec_lock_missing",
        message: `${id} が未設定です`,
        entity: { type: "spec_lock", id },
      });
    }
  }

  if (
    (options.profileId === "gtfs-jp-v4" || options.profileId === "google-transit-ready") &&
    options.gtfsJpMatrixVerified === false
  ) {
    blockers.push({
      code: "gtfs_jp_matrix_unverified",
      message: "GTFS-JP v4公式要件表の反映確認が未完了です",
      entity: { type: "profile", id: options.profileId },
    });
  }

  if (!options.standardValidator?.executed) {
    blockers.push({
      code: "validator_not_executed",
      message: "生成zipに標準GTFS validatorを実行していません",
      entity: { type: "validator" },
    });
  } else if (options.standardValidator.errors > 0) {
    blockers.push({
      code: "validator_error_exists",
      message: `標準GTFS validator の error が ${options.standardValidator.errors} 件あります`,
      entity: { type: "validator", errors: options.standardValidator.errors },
    });
  }

  if (validation.summary.errors > 0) {
    blockers.push({
      code: "profile_error_exists",
      message: `${options.profileId} の profile error が ${validation.summary.errors} 件あります`,
      entity: { type: "profile", id: options.profileId, errors: validation.summary.errors },
    });
  }

  if (options.goldenFeedPassed === false) {
    blockers.push({
      code: "golden_feed_failed",
      message: "最小サンプルまたは実フィード回帰が失敗しています",
      entity: { type: "acceptance" },
    });
  }

  if (options.publicUrlVerified === false) {
    blockers.push({
      code: "public_url_unverified",
      message: "公開URLから取得したzipの検証が未完了です",
      entity: { type: "public_url" },
    });
  }

  return {
    status: blockers.length === 0 ? "ready" : "not_ready",
    profileId: options.profileId,
    validation,
    requiredSpecLocks,
    blockers,
  };
}
