/**
 * 標準GTFSバリデータ（MobilityData Canonical GTFS Schedule Validator）連携。
 *
 * 仕様 10.7 step3 / 11.2 `VALIDATOR_LOCK`。validator の実行（Java 実体の起動）は
 * フレームワーク非依存のコアでは行わず、別レイヤ（CLI/API）が生成した
 * `report.json` を取り込んで内部表現へ正規化する受け口を提供する。
 *
 * MobilityData validator の `report.json` 形:
 * ```json
 * { "summary": { "validatorVersion": "5.0.1", "validatedAt": "..." },
 *   "notices": [ { "code": "...", "severity": "ERROR", "totalNotices": 3 } ] }
 * ```
 */
import type { Severity } from "./validator.js";
import type { SpecLock } from "./spec-lock.js";

/** MobilityData validator の notice 1件分（必要項目のみ）。 */
export interface MobilityDataNotice {
  code: string;
  severity: string; // "ERROR" | "WARNING" | "INFO"
  totalNotices?: number;
  sampleNotices?: unknown[];
}

/** MobilityData validator の `report.json`（必要項目のみ）。 */
export interface MobilityDataReport {
  summary?: { validatorVersion?: string; validatedAt?: string; [k: string]: unknown };
  notices?: MobilityDataNotice[];
}

/** 正規化した1指摘（severity ごとに集約）。 */
export interface StandardValidatorIssue {
  code: string;
  severity: Severity;
  /** 同一 code の件数。 */
  count: number;
}

/** 取込・正規化済みの標準検証結果（仕様 10.7 の保存項目に対応）。 */
export interface StandardValidatorResult {
  validatorName: string;
  validatorVersion?: string;
  executedAt?: string;
  /** 対象版または作業データID（10.7 `source_revision`）。 */
  sourceRevision?: string;
  summary: { errors: number; warnings: number; infos: number };
  issues: StandardValidatorIssue[];
}

export interface ParseStandardValidatorOptions {
  validatorName?: string;
  /** report に版が無い場合のフォールバック。 */
  validatorVersion?: string;
  executedAt?: string;
  sourceRevision?: string;
}

const DEFAULT_VALIDATOR_NAME = "mobilitydata-gtfs-validator";

function normalizeSeverity(raw: string): Severity {
  switch ((raw ?? "").toUpperCase()) {
    case "ERROR":
      return "error";
    case "WARNING":
      return "warning";
    default:
      // INFO / 未知の severity は info 扱い（error/warning を過小評価しない）。
      return "info";
  }
}

/**
 * MobilityData validator の report（JSON 文字列またはパース済みオブジェクト）を
 * 内部表現へ正規化する。
 */
export function parseStandardValidatorReport(
  report: string | MobilityDataReport,
  options: ParseStandardValidatorOptions = {},
): StandardValidatorResult {
  let parsed: MobilityDataReport;
  if (typeof report === "string") {
    try {
      parsed = JSON.parse(report) as MobilityDataReport;
    } catch (e) {
      throw new Error(`標準validatorレポートのJSON解析に失敗しました: ${(e as Error).message}`);
    }
  } else {
    parsed = report;
  }

  const notices = Array.isArray(parsed.notices) ? parsed.notices : [];
  const issues: StandardValidatorIssue[] = notices.map((n) => ({
    code: String(n.code ?? ""),
    severity: normalizeSeverity(n.severity),
    count: Number.isFinite(n.totalNotices) ? Number(n.totalNotices) : 1,
  }));

  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const issue of issues) {
    if (issue.severity === "error") errors += issue.count;
    else if (issue.severity === "warning") warnings += issue.count;
    else infos += issue.count;
  }

  return {
    validatorName: options.validatorName ?? DEFAULT_VALIDATOR_NAME,
    validatorVersion: parsed.summary?.validatorVersion ?? options.validatorVersion,
    executedAt: options.executedAt ?? parsed.summary?.validatedAt,
    sourceRevision: options.sourceRevision,
    summary: { errors, warnings, infos },
    issues,
  };
}

/**
 * release-gate / acceptance が受け取る `StandardValidatorSummary` へ変換する。
 * （release-gate.ts の同名 interface と構造一致。循環 import を避けるため再宣言）
 */
export function toStandardValidatorSummary(result: StandardValidatorResult): {
  executed: true;
  validatorName: string;
  validatorVersion?: string;
  errors: number;
  warnings: number;
} {
  return {
    executed: true,
    validatorName: result.validatorName,
    validatorVersion: result.validatorVersion,
    errors: result.summary.errors,
    warnings: result.summary.warnings,
  };
}

/**
 * 取込済みの validator 結果から `VALIDATOR_LOCK` を構築する（仕様 11.2）。
 * バージョンが取得できない場合はロックできない（missing のまま）。
 */
export function validatorLockFromResult(
  result: StandardValidatorResult,
  options: { rulesetVersion?: string; runMethod?: string } = {},
): SpecLock {
  const locked = !!result.validatorVersion;
  return {
    id: "VALIDATOR_LOCK",
    status: locked ? "locked" : "missing",
    label: "MobilityData Canonical GTFS Schedule Validator",
    source: "https://github.com/MobilityData/gtfs-validator",
    version: result.validatorVersion,
    confirmedAt: result.executedAt,
    notes: locked
      ? [
          `validator=${result.validatorName}`,
          options.runMethod ? `run=${options.runMethod}` : undefined,
          options.rulesetVersion ? `ruleset=${options.rulesetVersion}` : undefined,
        ]
          .filter(Boolean)
          .join(" / ")
      : "validatorバージョンが取得できずロックできません。",
  };
}
