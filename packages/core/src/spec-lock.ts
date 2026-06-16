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

/**
 * 仕様ロックの保存・取得の口（10.2「ロック状態はAPIで取得できるように」）。
 *
 * 実体の永続化（DB/ファイル）は api 層が担い、コアは「現在のロック集合」を保持・
 * 更新・判定するインメモリストアを提供する。既定値（SPEC_LOCKS）を起点に、
 * validator結果由来の `VALIDATOR_LOCK` などを上書き保存できる。
 */
export interface SpecLockStore {
  get(id: SpecLockId): SpecLock | undefined;
  all(): SpecLock[];
  /** ロックを保存（上書き）する。 */
  set(lock: SpecLock): void;
  isLocked(id: SpecLockId): boolean;
  /** 指定IDのうち locked でないものを返す。 */
  missing(ids: SpecLockId[]): SpecLockId[];
  /** release-gate / acceptance へ渡す形（部分マップ）。 */
  snapshot(): Partial<Record<SpecLockId, SpecLock>>;
}

export function createSpecLockStore(
  initial: Partial<Record<SpecLockId, SpecLock>> = {},
): SpecLockStore {
  const locks: Record<string, SpecLock> = {};
  for (const lock of Object.values({ ...SPEC_LOCKS, ...initial })) {
    if (lock) locks[lock.id] = { ...lock, documents: lock.documents?.slice() };
  }
  return {
    get: (id) => locks[id],
    all: () => Object.values(locks).map((l) => ({ ...l, documents: l.documents?.slice() })),
    set: (lock) => {
      locks[lock.id] = { ...lock, documents: lock.documents?.slice() };
    },
    isLocked: (id) => locks[id]?.status === "locked",
    missing: (ids) => ids.filter((id) => locks[id]?.status !== "locked"),
    snapshot: () => {
      const out: Partial<Record<SpecLockId, SpecLock>> = {};
      for (const lock of Object.values(locks)) out[lock.id] = { ...lock };
      return out;
    },
  };
}
