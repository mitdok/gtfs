import { describe, it, expect } from "vitest";
import { strToU8 } from "fflate";
import { importEntries } from "../src/importer.js";
import { evaluateReleaseGate } from "../src/release-gate.js";
import { SPEC_LOCKS } from "../src/spec-lock.js";
import { SAMPLE_FILES } from "./fixtures.js";

function feedFrom(files: Record<string, string>) {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, text] of Object.entries(files)) entries[name] = strToU8(text);
  return importEntries(entries).feed;
}

const VALIDATOR_LOCKED = {
  ...SPEC_LOCKS.VALIDATOR_LOCK,
  status: "locked" as const,
  version: "v6.0.0-test",
  confirmedAt: "2026-06-16",
};

const V4_FEED = {
  ...SAMPLE_FILES,
  "agency.txt": [
    "agency_id,agency_name,agency_url,agency_timezone,agency_lang,agency_email",
    "toyo,テスト交通,https://example.com,Asia/Tokyo,ja,info@example.com",
    "",
  ].join("\n"),
  "stops.txt": [
    "stop_id,stop_name,stop_lat,stop_lon,location_type",
    "S1,駅前,34.769100,137.391600,0",
    "S2,市役所前,34.766000,137.385000,0",
    "S3,中央病院,34.760000,137.380000,0",
    "",
  ].join("\n"),
  "feed_info.txt": [
    "feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version,feed_contact_email",
    "テスト,https://example.com,ja,20260401,20261231,2026-04,info@example.com",
    "",
  ].join("\n"),
  "fare_attributes.txt": [
    "fare_id,price,currency_type,payment_method,transfers",
    "free,0,JPY,0,0",
    "",
  ].join("\n"),
  "translations.txt": [
    "table_name,field_name,language,translation,record_id",
    "stops,stop_name,ja-Hrkt,エキマエ,S1",
    "stops,stop_name,ja-Hrkt,シヤクショマエ,S2",
    "stops,stop_name,ja-Hrkt,チュウオウビョウイン,S3",
    "",
  ].join("\n"),
};

describe("公開可否ゲート", () => {
  it("validator lock と標準validator結果がない場合は公開不可にする", () => {
    const report = evaluateReleaseGate(feedFrom(V4_FEED), {
      profileId: "gtfs-jp-v4",
      validationDate: "20260616",
    });
    expect(report.status).toBe("not_ready");
    expect(report.blockers.some((b) => b.code === "spec_lock_missing")).toBe(true);
    expect(report.blockers.some((b) => b.code === "validator_not_executed")).toBe(true);
  });

  it("profile error がある場合は標準validatorが通っていても公開不可にする", () => {
    const files = { ...V4_FEED };
    delete files["translations.txt"];
    const report = evaluateReleaseGate(feedFrom(files), {
      profileId: "gtfs-jp-v4",
      validationDate: "20260616",
      specLocks: { VALIDATOR_LOCK: VALIDATOR_LOCKED },
      standardValidator: { executed: true, errors: 0, validatorName: "test-validator" },
    });
    expect(report.status).toBe("not_ready");
    expect(report.blockers.some((b) => b.code === "profile_error_exists")).toBe(true);
  });

  it("必須ロック・標準validator・profile error 0 が揃えば ready にする", () => {
    const report = evaluateReleaseGate(feedFrom(V4_FEED), {
      profileId: "google-transit-ready",
      validationDate: "20260616",
      specLocks: { VALIDATOR_LOCK: VALIDATOR_LOCKED },
      standardValidator: { executed: true, errors: 0, validatorName: "test-validator" },
      goldenFeedPassed: true,
      publicUrlVerified: true,
    });
    expect(report.status).toBe("ready");
    expect(report.blockers).toHaveLength(0);
    // Google向けのshape推奨はwarningであり、公開阻害errorではない。
    expect(report.validation.issues.some((i) => i.code === "missing_shape_recommended")).toBe(true);
  });
});
