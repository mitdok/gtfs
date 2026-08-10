import { describe, expect, it } from "vitest";
import { strToU8 } from "fflate";
import { exportToFiles, exportToZip } from "../src/exporter.js";
import { importEntries, importGtfsZip } from "../src/importer.js";
import { validateFeed } from "../src/validator.js";
import { v4GoldenSamples, v4MinimalFixedBusFiles } from "../src/v4-golden-samples.js";

function feedFrom(files: Record<string, string>) {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, text] of Object.entries(files)) entries[name] = strToU8(text);
  return importEntries(entries).feed;
}

function validateV4(files: Record<string, string>) {
  return validateFeed(feedFrom(files), { profileId: "gtfs-jp-v4" });
}

const V4_GOLDEN_FILES = v4MinimalFixedBusFiles();

describe("GTFS-JP v4 golden samples", () => {
  it("minimal-fixed-bus は v4 error 0 で通る", () => {
    expect(validateV4(V4_GOLDEN_FILES).summary.errors).toBe(0);
  });

  it("overnight-bus は24時超時刻を正常に扱う", () => {
    const report = validateV4(V4_GOLDEN_FILES);
    expect(report.summary.errors).toBe(0);
    expect(report.issues.some((i) => i.code === "invalid_time_format")).toBe(false);
    expect(report.issues.some((i) => i.code === "stop_time_decreasing")).toBe(false);
  });

  it("calendar-dates-only は calendar なしでも service 参照が成立する", () => {
    const files = v4GoldenSamples().find((sample) => sample.id === "calendar-dates-only")!.files;

    expect(validateV4(files).summary.errors).toBe(0);
  });

  it("translations-kana は record_id 方式の停留所読み仮名を認識する", () => {
    const report = validateV4(V4_GOLDEN_FILES);
    expect(report.issues.some((i) => i.code === "missing_stop_name_kana")).toBe(false);
  });

  it("shape-basic は trips.shape_id と shapes を含めて v4 error 0 で通る", () => {
    const files = v4GoldenSamples().find((sample) => sample.id === "shape-basic")!.files;

    expect(validateV4(files).summary.errors).toBe(0);
  });

  it("v4 golden feed は出力後も v4 error 0 を維持する", () => {
    const exported = exportToFiles(feedFrom(V4_GOLDEN_FILES), { profileId: "gtfs-jp-v4" });
    expect(validateV4(exported).summary.errors).toBe(0);
  });

  it.each(v4GoldenSamples())("$id はzip往復後もv4/Google error 0を維持する", (sample) => {
    const zip = exportToZip(feedFrom(sample.files), { profileId: "gtfs-jp-v4" });
    const roundtripped = importGtfsZip(zip).feed;

    expect(validateFeed(roundtripped, { profileId: "gtfs-jp-v4" }).summary.errors).toBe(0);
    expect(
      validateFeed(roundtripped, {
        profileId: "google-transit-ready",
        validationDate: "20260616",
      }).summary.errors,
    ).toBe(0);
  });
});
