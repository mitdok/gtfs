/**
 * 採用仕様・検証器のロック情報。
 *
 * 公開判定では「どの版の仕様に対して検証したか」を監査可能にする必要がある。
 * validator は実行方式とバージョン確定が未実装のため、現時点では missing として扱う。
 */

export type SpecLockId =
  | "GTFS_SCHEDULE_LOCK"
  | "GTFS_JP_V4_LOCK"
  | "GOOGLE_TRANSIT_LOCK"
  | "VALIDATOR_LOCK";

export interface SpecLock {
  id: SpecLockId;
  status: "locked" | "missing";
  label: string;
  source: string;
  version?: string;
  confirmedAt?: string;
  documents?: string[];
  notes?: string;
}

export const SPEC_LOCKS: Record<SpecLockId, SpecLock> = {
  GTFS_SCHEDULE_LOCK: {
    id: "GTFS_SCHEDULE_LOCK",
    status: "locked",
    label: "GTFS Schedule Reference",
    source: "https://gtfs.org/documentation/schedule/reference/",
    version: "2026-04-27",
    confirmedAt: "2026-06-12",
  },
  GTFS_JP_V4_LOCK: {
    id: "GTFS_JP_V4_LOCK",
    status: "locked",
    label: "公共交通運行情報標準データ仕様（GTFS-JP）第4.0版",
    source: "https://www.mlit.go.jp/commmmons/document/007/",
    version: "第4.0版 / 2026-03-19",
    confirmedAt: "2026-06-16",
    documents: [
      "commmmons_doc_007-01_ver01.pdf",
      "commmmons_doc_007-02_ver01.pdf",
      "commmmons_doc_007-03_ver01.pdf",
    ],
  },
  GOOGLE_TRANSIT_LOCK: {
    id: "GOOGLE_TRANSIT_LOCK",
    status: "locked",
    label: "Google Transit GTFS Schedule Reference and Differences",
    source: "https://developers.google.com/transit/gtfs/reference",
    confirmedAt: "2026-06-16",
    notes: "google-transit-ready はGTFS公式仕様ではなく、本サービスの公開前品質ゲートとして扱う。",
  },
  VALIDATOR_LOCK: {
    id: "VALIDATOR_LOCK",
    status: "missing",
    label: "MobilityData Canonical GTFS Schedule Validator",
    source: "https://github.com/MobilityData/gtfs-validator",
    notes: "validator連携とバージョン固定が未実装。",
  },
};

export function getSpecLocks(): SpecLock[] {
  return Object.values(SPEC_LOCKS).map((lock) => ({ ...lock, documents: lock.documents?.slice() }));
}

export function requiredSpecLocksForProfile(profileId: string): SpecLockId[] {
  if (profileId === "gtfs-base") return ["GTFS_SCHEDULE_LOCK", "VALIDATOR_LOCK"];
  if (profileId === "google-transit-ready") {
    return ["GTFS_SCHEDULE_LOCK", "GTFS_JP_V4_LOCK", "GOOGLE_TRANSIT_LOCK", "VALIDATOR_LOCK"];
  }
  if (profileId === "gtfs-jp-v4" || profileId === "gtfs-jp-v3-legacy") {
    return ["GTFS_SCHEDULE_LOCK", "GTFS_JP_V4_LOCK", "VALIDATOR_LOCK"];
  }
  return ["GTFS_SCHEDULE_LOCK", "VALIDATOR_LOCK"];
}
