import { describe, it, expect } from "vitest";
import {
  parseStandardValidatorReport,
  toStandardValidatorSummary,
  validatorLockFromResult,
} from "../src/standard-validator.js";

const REPORT = {
  summary: { validatorVersion: "5.0.1", validatedAt: "2026-06-16T00:00:00Z" },
  notices: [
    { code: "duplicated_column", severity: "WARNING", totalNotices: 2 },
    { code: "missing_required_field", severity: "ERROR", totalNotices: 3 },
    { code: "unknown_column", severity: "INFO", totalNotices: 5 },
    { code: "weird", severity: "SYSTEM_ERROR", totalNotices: 1 },
  ],
};

describe("標準validatorレポート取込", () => {
  it("severityごとに件数を集計し、版・実行日時を取り出す", () => {
    const r = parseStandardValidatorReport(REPORT);
    expect(r.validatorName).toBe("mobilitydata-gtfs-validator");
    expect(r.validatorVersion).toBe("5.0.1");
    expect(r.executedAt).toBe("2026-06-16T00:00:00Z");
    expect(r.summary.errors).toBe(3);
    expect(r.summary.warnings).toBe(2);
    // INFO(5) + 未知severity(1) は info に集約
    expect(r.summary.infos).toBe(6);
  });

  it("JSON文字列でも受け取れる / totalNotices欠落は1件扱い", () => {
    const r = parseStandardValidatorReport(
      JSON.stringify({ notices: [{ code: "x", severity: "ERROR" }] }),
      { validatorVersion: "9.9" },
    );
    expect(r.summary.errors).toBe(1);
    expect(r.validatorVersion).toBe("9.9"); // summaryが無い場合はオプションでフォールバック
  });

  it("壊れたJSONは明示的にエラー", () => {
    expect(() => parseStandardValidatorReport("{not json")).toThrow(/JSON解析に失敗/);
  });

  it("release-gate 用サマリへ変換できる", () => {
    const s = toStandardValidatorSummary(parseStandardValidatorReport(REPORT));
    expect(s).toMatchObject({ executed: true, errors: 3, warnings: 2, validatorVersion: "5.0.1" });
  });

  it("版が取れれば VALIDATOR_LOCK を locked にできる", () => {
    const locked = validatorLockFromResult(parseStandardValidatorReport(REPORT), {
      runMethod: "docker",
      rulesetVersion: "default",
    });
    expect(locked.status).toBe("locked");
    expect(locked.version).toBe("5.0.1");
    expect(locked.notes).toContain("docker");

    const missing = validatorLockFromResult(
      parseStandardValidatorReport({ notices: [] }),
    );
    expect(missing.status).toBe("missing");
  });
});
