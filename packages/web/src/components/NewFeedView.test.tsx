import { describe, expect, it } from "vitest";
import { createDefaultDraft } from "./NewFeedView";

describe("createDefaultDraft", () => {
  it("uses the current day and a one-year period", () => {
    const draft = createDefaultDraft(new Date(2026, 8, 12));
    expect(draft.feedStartDate).toBe("20260912");
    expect(draft.feedEndDate).toBe("20270912");
  });

  it("does not put realistic-looking sample operator data into a production feed", () => {
    const draft = createDefaultDraft(new Date(2026, 8, 12));
    expect(draft.agencyName).toBe("");
    expect(draft.agencyUrl).toBe("");
    expect(draft.routeLongName).toBe("");
    expect(draft.stops).toHaveLength(2);
    expect(draft.stops.every((stop) => stop.stopName === "" && stop.stopLat === "" && stop.stopLon === "")).toBe(true);
  });
});
