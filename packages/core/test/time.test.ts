import { describe, it, expect } from "vitest";
import { hmsToSec, secToHms, isValidGtfsTime } from "../src/time.js";

describe("time", () => {
  it("HH:MM:SS を秒へ変換する", () => {
    expect(hmsToSec("07:05:00")).toBe(7 * 3600 + 5 * 60);
    expect(hmsToSec("00:00:00")).toBe(0);
  });

  it("24時超（深夜便）を扱う", () => {
    expect(hmsToSec("25:10:30")).toBe(25 * 3600 + 10 * 60 + 30);
    expect(secToHms(25 * 3600 + 10 * 60 + 30)).toBe("25:10:30");
  });

  it("秒→HH:MM:SS のラウンドトリップ", () => {
    for (const s of [0, 59, 3600, 90061, 25 * 3600]) {
      expect(hmsToSec(secToHms(s))).toBe(s);
    }
  });

  it("不正形式を弾く", () => {
    expect(hmsToSec("7:5:0")).toBeNull();
    expect(hmsToSec("aa:bb:cc")).toBeNull();
    expect(isValidGtfsTime("25:61:00")).toBe(false);
    expect(isValidGtfsTime("08:30:00")).toBe(true);
  });
});
