import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSpecLockRepository } from "../src/spec-lock-repository.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gtfs-api-"));
  file = join(dir, "nested", "spec-locks.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("仕様ロックの永続化リポジトリ", () => {
  it("既定ロックで開始し、未取込のVALIDATOR_LOCKはmissing", () => {
    const repo = openSpecLockRepository(file);
    expect(repo.isLocked("GTFS_SCHEDULE_LOCK")).toBe(true);
    expect(repo.isLocked("VALIDATOR_LOCK")).toBe(false);
    expect(repo.list().length).toBeGreaterThanOrEqual(4);
  });

  it("upsert でファイルへ永続化され、開き直すと復元される", () => {
    const repo = openSpecLockRepository(file);
    repo.upsert({
      id: "VALIDATOR_LOCK",
      status: "locked",
      label: "MobilityData validator",
      source: "https://github.com/MobilityData/gtfs-validator",
      version: "5.0.1",
    });
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("VALIDATOR_LOCK");

    // 親ディレクトリも自動作成されている
    const reopened = openSpecLockRepository(file);
    expect(reopened.isLocked("VALIDATOR_LOCK")).toBe(true);
    expect(reopened.get("VALIDATOR_LOCK")?.version).toBe("5.0.1");
  });

  it("snapshot はコピーを返し、外部変更がストアへ伝播しない", () => {
    const repo = openSpecLockRepository(file);
    const snap = repo.snapshot();
    snap.GTFS_SCHEDULE_LOCK!.status = "missing";
    expect(repo.isLocked("GTFS_SCHEDULE_LOCK")).toBe(true);
  });
});
