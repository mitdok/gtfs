import { createFeed, getTable } from "@gtfs-studio/core";
import { describe, expect, it } from "vitest";
import { updateFirstRow } from "./MetadataView";

describe("updateFirstRow", () => {
  it("creates a missing metadata table without losing the new column", () => {
    const feed = createFeed();
    updateFirstRow(feed, "feed_info", "feed_contact_email", "gtfs@example.jp");
    expect(getTable(feed, "feed_info")).toEqual({
      name: "feed_info",
      columns: ["feed_contact_email"],
      rows: [{ feed_contact_email: "gtfs@example.jp" }],
    });
  });

  it("preserves existing rows and column order", () => {
    const feed = createFeed();
    updateFirstRow(feed, "agency", "agency_name", "交通局");
    updateFirstRow(feed, "agency", "agency_email", "info@example.jp");
    expect(getTable(feed, "agency")?.columns).toEqual(["agency_name", "agency_email"]);
    expect(getTable(feed, "agency")?.rows[0]).toMatchObject({
      agency_name: "交通局",
      agency_email: "info@example.jp",
    });
  });
});
