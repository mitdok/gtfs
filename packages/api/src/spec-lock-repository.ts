/**
 * 仕様ロックのファイル永続化（仕様 10.2「ロック状態はAPIで取得できるように」/ 11.2）。
 *
 * core の `createSpecLockStore`（インメモリ）をエンジンに使い、JSON ファイルへの
 * 読み書きを足した薄いリポジトリ。core 本体は fs 非依存のまま、永続化責務をこの api 層に置く。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  createSpecLockStore,
  type SpecLock,
  type SpecLockId,
} from "@gtfs-studio/core";

export interface SpecLockRepository {
  /** 現在の全ロックを返す。 */
  list(): SpecLock[];
  get(id: SpecLockId): SpecLock | undefined;
  /** ロックを保存（上書き）してファイルへ永続化し、保存後の値を返す。 */
  upsert(lock: SpecLock): SpecLock;
  isLocked(id: SpecLockId): boolean;
  /** release-gate / acceptance へ渡す部分マップ。 */
  snapshot(): Partial<Record<SpecLockId, SpecLock>>;
  /** 永続化ファイルのパス。 */
  readonly path: string;
}

function readSaved(filePath: string): Partial<Record<SpecLockId, SpecLock>> {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, "utf8").trim();
  if (raw === "") return {};
  const parsed = JSON.parse(raw) as SpecLock[];
  const out: Partial<Record<SpecLockId, SpecLock>> = {};
  for (const lock of parsed) out[lock.id] = lock;
  return out;
}

/**
 * 永続化ファイルを開く（無ければ core 既定ロックで開始）。
 * 保存済みファイルがあれば既定に上書きマージする。
 */
export function openSpecLockRepository(filePath: string): SpecLockRepository {
  const store = createSpecLockStore(readSaved(filePath));

  function persist() {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(store.all(), null, 2) + "\n");
  }

  return {
    path: filePath,
    list: () => store.all(),
    get: (id) => store.get(id),
    isLocked: (id) => store.isLocked(id),
    snapshot: () => store.snapshot(),
    upsert: (lock) => {
      store.set(lock);
      persist();
      return store.get(lock.id)!;
    },
  };
}
