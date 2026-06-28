/**
 * 出力/検証プロファイル（実行時表現）。
 *
 * 仕様 10.11 の「ルール定義データ」を正本とし、`src/profiles/*.json` を読み込んで
 * 実行時の最小 `Profile` を導出する。検証ロジック（validator.ts）はこの最小表現
 * （ファイル/項目の要否）だけを参照し、版・根拠仕様などのメタデータは定義層
 * （`ProfileDefinition`、`getProfileDefinition`）に保持する。仕様改定時は JSON 差し替え。
 */
import type {
  DefinitionPresence,
  FieldDefinition,
  FileDefinition,
  ProfileDefinition,
} from "./profile-schema.js";
import type { SpecLockId } from "./spec-lock.js";
import type { Severity } from "./validator.js";

import gtfsBaseRaw from "./profiles/gtfs-base.json" with { type: "json" };
import gtfsJpV4Raw from "./profiles/gtfs-jp-v4.json" with { type: "json" };
import gtfsJpV3LegacyRaw from "./profiles/gtfs-jp-v3-legacy.json" with { type: "json" };
import googleTransitReadyRaw from "./profiles/google-transit-ready.json" with { type: "json" };

export type {
  ProfileDefinition,
  FileDefinition,
  FieldDefinition,
  ExtraRule,
  DefinitionPresence,
} from "./profile-schema.js";

export type FieldPresence = "required" | "recommended" | "optional" | "conditionallyRequired";

export interface FieldDef {
  name: string;
  required?: boolean;
  presence?: FieldPresence;
  type?: string;
}

export interface FileDef {
  /** 拡張子なしのファイル名（例: "stops"） */
  name: string;
  /** 必須ファイルか */
  required?: boolean;
  presence?: "required" | "recommended" | "optional" | "conditionallyRequired" | "legacy";
  fields: FieldDef[];
}

export interface Profile {
  id: string;
  label: string;
  files: FileDef[];
  /**
   * calendar.txt と calendar_dates.txt は「いずれか必須」。
   * この特例を扱うためのフラグ。
   */
  serviceFilesEitherRequired: boolean;
}

// --- JSON（snake_case）→ ProfileDefinition（camelCase）正規化 ------------------

interface RawField {
  name: string;
  presence: DefinitionPresence;
  type?: string;
  severity_if_missing?: Severity;
  source_ref?: string;
}
interface RawFile {
  name: string;
  presence: DefinitionPresence;
  source?: string;
  source_ref?: string;
  fields: RawField[];
}
interface RawProfile {
  profile_id: string;
  profile_version: string;
  label: string;
  extends?: string | null;
  service_files_either_required?: boolean;
  source_locks: string[];
  files?: RawFile[];
  extra_rules?: { code: string; severity: Severity; description: string; source?: string; source_ref?: string }[];
}

function normalizeField(f: RawField): FieldDefinition {
  return {
    name: f.name,
    presence: f.presence,
    type: f.type,
    severityIfMissing: f.severity_if_missing,
    sourceRef: f.source_ref,
  };
}

function normalizeFile(f: RawFile): FileDefinition {
  return {
    name: f.name,
    presence: f.presence,
    source: f.source,
    sourceRef: f.source_ref,
    fields: f.fields.map(normalizeField),
  };
}

function normalizeProfile(raw: RawProfile): ProfileDefinition {
  return {
    profileId: raw.profile_id,
    profileVersion: raw.profile_version,
    label: raw.label,
    extends: raw.extends ?? null,
    serviceFilesEitherRequired: raw.service_files_either_required,
    sourceLocks: raw.source_locks as SpecLockId[],
    files: raw.files?.map(normalizeFile),
    extraRules: raw.extra_rules,
  };
}

const RAW_DEFINITIONS: RawProfile[] = [
  gtfsBaseRaw as RawProfile,
  gtfsJpV4Raw as RawProfile,
  gtfsJpV3LegacyRaw as RawProfile,
  googleTransitReadyRaw as RawProfile,
];

// extends を解決し、files / service_files_either_required を継承する。
const DEFINITIONS: Record<string, ProfileDefinition> = (() => {
  const byId = new Map<string, ProfileDefinition>();
  for (const raw of RAW_DEFINITIONS) byId.set(raw.profile_id, normalizeProfile(raw));

  const resolved: Record<string, ProfileDefinition> = {};
  function resolve(id: string): ProfileDefinition {
    if (resolved[id]) return resolved[id]!;
    const def = byId.get(id);
    if (!def) throw new Error(`unknown profile definition: ${id}`);
    if (!def.extends) {
      resolved[id] = def;
      return def;
    }
    const parent = resolve(def.extends);
    const merged: ProfileDefinition = {
      ...def,
      files: def.files ?? parent.files,
      serviceFilesEitherRequired:
        def.serviceFilesEitherRequired ?? parent.serviceFilesEitherRequired,
    };
    resolved[id] = merged;
    return merged;
  }
  for (const id of byId.keys()) resolve(id);
  return resolved;
})();

// --- 定義 → 実行時 Profile への変換 -------------------------------------------

function toFieldDef(f: FieldDefinition): FieldDef {
  if (f.presence === "required") return { name: f.name, required: true, type: f.type };
  if (f.presence === "recommended" || f.presence === "optional" || f.presence === "conditionallyRequired") {
    return { name: f.name, presence: f.presence, type: f.type };
  }
  return { name: f.name, type: f.type };
}

function toFileDef(f: FileDefinition): FileDef {
  const fields = f.fields.map(toFieldDef);
  if (f.presence === "required") return { name: f.name, required: true, fields };
  if (f.presence === "recommended" || f.presence === "legacy") {
    return { name: f.name, presence: f.presence, fields };
  }
  // conditionallyRequired / optional は実行時には「必須でないファイル」として扱う。
  return { name: f.name, fields };
}

/** ProfileDefinition を実行時の最小 Profile へ変換する。 */
export function toProfile(def: ProfileDefinition): Profile {
  return {
    id: def.profileId,
    label: def.label,
    serviceFilesEitherRequired: def.serviceFilesEitherRequired ?? true,
    files: (def.files ?? []).map(toFileDef),
  };
}

// --- 公開API -----------------------------------------------------------------

/** プロファイル定義（メタデータ込みの正本）を取得する。 */
export function getProfileDefinition(id: string): ProfileDefinition {
  const def = DEFINITIONS[id];
  if (!def) throw new Error(`unknown profile: ${id}`);
  return def;
}

/** 全プロファイル定義を返す。 */
export function listProfileDefinitions(): ProfileDefinition[] {
  return Object.values(DEFINITIONS);
}

/** プロファイルが採用する仕様ロック（10.2 source_locks）。 */
export function sourceLocksForProfile(id: string): SpecLockId[] {
  return [...getProfileDefinition(id).sourceLocks];
}

export const PROFILES: Record<string, Profile> = Object.fromEntries(
  Object.values(DEFINITIONS).map((def) => [def.profileId, toProfile(def)]),
);

export function getProfile(id: string): Profile {
  const p = PROFILES[id];
  if (!p) throw new Error(`unknown profile: ${id}`);
  return p;
}

// 後方互換のための名前付き定数（JSON から導出）。
export const GTFS_BASE: Profile = getProfile("gtfs-base");
export const GTFS_JP_V4: Profile = getProfile("gtfs-jp-v4");
export const GTFS_JP_V3_LEGACY: Profile = getProfile("gtfs-jp-v3-legacy");
export const GOOGLE_TRANSIT_READY: Profile = getProfile("google-transit-ready");
