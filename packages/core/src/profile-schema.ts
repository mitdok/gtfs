/**
 * プロファイル定義（設定データ）のスキーマ。仕様 10.11「ルール定義データの必須項目」。
 *
 * 実行時の最小 `Profile`（`profile.ts`）とは別に、版・根拠仕様（source/source_ref）・
 * 採用ロック（source_locks）・追加ルール（extra_rules）を持つ「正本」となるデータ形。
 * `src/profiles/*.json` がこの形で、`profile.ts` がそれを読み込んで実行時 `Profile`
 * へ変換する。仕様改定時は JSON 差し替えで追従できる（10.2 のデータ駆動方針）。
 */
import type { Severity } from "./validator.js";
import type { SpecLockId } from "./spec-lock.js";

export type DefinitionPresence =
  | "required"
  | "conditionallyRequired"
  | "recommended"
  | "optional"
  | "legacy";

export interface FieldDefinition {
  name: string;
  presence: DefinitionPresence;
  /** 値の型ヒント（text/url/date/enum 等）。検証強化の足がかり。 */
  type?: string;
  /** 欠落時の severity（既定は presence から導出）。 */
  severityIfMissing?: Severity;
  /** 公式仕様の参照箇所（空なら本サービス独自ルール）。 */
  sourceRef?: string;
}

export interface FileDefinition {
  name: string;
  presence: DefinitionPresence;
  /** 根拠仕様名（例: "GTFS Schedule Reference"）。 */
  source?: string;
  /** 根拠仕様の参照箇所（例: "agency.txt"）。 */
  sourceRef?: string;
  fields: FieldDefinition[];
}

export interface ExtraRule {
  code: string;
  severity: Severity;
  description: string;
  source?: string;
  sourceRef?: string;
}

export interface ProfileDefinition {
  profileId: string;
  profileVersion: string;
  label: string;
  /** 継承元プロファイルID（files 等を引き継ぐ）。 */
  extends?: string | null;
  serviceFilesEitherRequired?: boolean;
  /** 採用する仕様ロック（10.2）。 */
  sourceLocks: SpecLockId[];
  files?: FileDefinition[];
  extraRules?: ExtraRule[];
}
