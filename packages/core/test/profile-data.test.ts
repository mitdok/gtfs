import { describe, it, expect } from "vitest";
import {
  getProfile,
  getProfileDefinition,
  listProfileDefinitions,
  sourceLocksForProfile,
  toProfile,
} from "../src/profile.js";
import { requiredSpecLocksForProfile } from "../src/spec-lock.js";

describe("プロファイル定義（JSON外部化 / 仕様10.11）", () => {
  it("4プロファイルが版・採用ロック付きで読み込める", () => {
    const ids = listProfileDefinitions().map((d) => d.profileId).sort();
    expect(ids).toEqual([
      "google-transit-ready",
      "gtfs-base",
      "gtfs-jp-v3-legacy",
      "gtfs-jp-v4",
    ]);
    for (const def of listProfileDefinitions()) {
      expect(def.profileVersion).toMatch(/^\d{4}-\d{2}-\d{2}/);
      expect(def.sourceLocks.length).toBeGreaterThan(0);
    }
  });

  it("ファイル・項目に根拠仕様参照(source_ref)を持つ", () => {
    const v4 = getProfileDefinition("gtfs-jp-v4");
    const feedInfo = v4.files?.find((f) => f.name === "feed_info");
    expect(feedInfo?.sourceRef).toBe("feed_info.txt");
    expect(feedInfo?.fields.every((fld) => fld.presence === "required")).toBe(true);
    expect(v4.extraRules?.some((r) => r.code === "missing_stop_name_kana")).toBe(true);
  });

  it("extends で親のファイル定義を継承する（v3-legacy ← base）", () => {
    const legacy = getProfileDefinition("gtfs-jp-v3-legacy");
    const base = getProfileDefinition("gtfs-base");
    expect(legacy.extends).toBe("gtfs-base");
    expect(legacy.files?.map((f) => f.name)).toEqual(base.files?.map((f) => f.name));
    // google-transit-ready ← gtfs-jp-v4
    const g = getProfileDefinition("google-transit-ready");
    const v4 = getProfileDefinition("gtfs-jp-v4");
    expect(g.files?.map((f) => f.name)).toEqual(v4.files?.map((f) => f.name));
  });

  it("定義 → 実行時Profile変換: 必須/推奨ファイルが正しく落ちる", () => {
    const v4 = getProfile("gtfs-jp-v4");
    const feedInfo = v4.files.find((f) => f.name === "feed_info");
    expect(feedInfo?.required).toBe(true);
    const attributions = v4.files.find((f) => f.name === "attributions");
    expect(attributions?.presence).toBe("recommended");
    expect(attributions?.required).toBeUndefined();
    // conditionallyRequired は実行時には必須でないファイル扱い
    const shapes = v4.files.find((f) => f.name === "shapes");
    expect(shapes?.required).toBeUndefined();
    expect(shapes?.presence).toBeUndefined();
    // toProfile は getProfile と一致
    expect(toProfile(v4Def())).toEqual(v4);
    function v4Def() {
      return getProfileDefinition("gtfs-jp-v4");
    }
  });

  it("source_locks は VALIDATOR_LOCK を除く必須ロックと整合する", () => {
    for (const id of ["gtfs-base", "gtfs-jp-v4", "google-transit-ready"]) {
      const fromProfile = sourceLocksForProfile(id).sort();
      const required = requiredSpecLocksForProfile(id)
        .filter((l) => l !== "VALIDATOR_LOCK")
        .sort();
      expect(fromProfile, id).toEqual(required);
    }
  });
});
