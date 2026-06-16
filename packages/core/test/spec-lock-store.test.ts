import { describe, it, expect } from "vitest";
import { createSpecLockStore } from "../src/spec-lock.js";
import {
  parseStandardValidatorReport,
  validatorLockFromResult,
} from "../src/standard-validator.js";

describe("仕様ロックストア（10.2 保存・取得）", () => {
  it("既定ロックを起点に取得・判定できる", () => {
    const store = createSpecLockStore();
    expect(store.isLocked("GTFS_SCHEDULE_LOCK")).toBe(true);
    // VALIDATOR_LOCK は既定で未設定
    expect(store.isLocked("VALIDATOR_LOCK")).toBe(false);
    expect(store.missing(["GTFS_SCHEDULE_LOCK", "VALIDATOR_LOCK"])).toEqual(["VALIDATOR_LOCK"]);
  });

  it("validator結果由来のロックを保存して locked にできる", () => {
    const store = createSpecLockStore();
    const result = parseStandardValidatorReport({
      summary: { validatorVersion: "5.0.1", validatedAt: "2026-06-16T00:00:00Z" },
      notices: [],
    });
    store.set(validatorLockFromResult(result, { runMethod: "docker" }));
    expect(store.isLocked("VALIDATOR_LOCK")).toBe(true);
    expect(store.get("VALIDATOR_LOCK")?.version).toBe("5.0.1");
    expect(store.missing(["GTFS_SCHEDULE_LOCK", "VALIDATOR_LOCK"])).toEqual([]);
  });

  it("snapshot は release-gate/acceptance へ渡せる部分マップ", () => {
    const store = createSpecLockStore();
    const snap = store.snapshot();
    expect(snap.GTFS_SCHEDULE_LOCK?.status).toBe("locked");
    // ストアは内部状態を直接露出しない（コピーを返す）
    snap.GTFS_SCHEDULE_LOCK!.status = "missing";
    expect(store.isLocked("GTFS_SCHEDULE_LOCK")).toBe(true);
  });
});
