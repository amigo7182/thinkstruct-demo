import { describe, expect, it } from "vitest";
import { resultSummary } from "../lib/format";
import { percentile } from "../lib/stats";
import {
  classificationPath,
  LANDING,
  normalizeClassification,
  parseParams,
  stateToParams,
  withFilters,
  withMore,
  withoutFilter,
  withQuery,
  type SearchState,
} from "../state/search";

const parse = (qs: string) => parseParams(new URLSearchParams(qs));

describe("search state", () => {
  it("round-trips through the URL", () => {
    const state: SearchState = {
      started: true,
      query: "bicycle spoke",
      filters: { classification: "B60B 27", weekFrom: "2024-03-07", weekTo: "2024-04-04", keywords: "hub", title: "Drag wheel" },
      limit: 60,
    };
    expect(parse(stateToParams(state).toString())).toEqual(state);
    expect(parse(stateToParams({ ...state, query: "", filters: {}, limit: 20 }).toString())).toEqual({
      started: true,
      query: "",
      filters: {},
      limit: 20,
    });
    expect(parse("")).toEqual(LANDING);
  });

  it("normalizes classification codes like the backend and drops invalid input", () => {
    expect(normalizeClassification("b60b27")).toBe("B60B 27");
    expect(normalizeClassification(" B60B 027 ")).toBe("B60B 27");
    expect(normalizeClassification("b60")).toBe("B60");
    expect(normalizeClassification("unclassified")).toBe("Unclassified");
    expect(normalizeClassification("not a code")).toBeUndefined();
    expect(parse("classification=Q99&week_from=yesterday&limit=999")).toEqual({
      started: true,
      query: "",
      filters: {},
      limit: 100,
    });
    expect(classificationPath("B60B 27")).toEqual(["B", "B60", "B60B", "B60B 27"]);
  });

  it("swaps a reversed week range instead of sending an invalid request", () => {
    expect(parse("week_from=2024-05-02&week_to=2024-03-07").filters).toEqual({ weekFrom: "2024-03-07", weekTo: "2024-05-02" });
  });

  it("keeps filters on a new query and resets the page size on any change", () => {
    const base = withMore(withFilters(withQuery(LANDING, "spoke"), { classification: "B60B" }));
    expect(base.limit).toBe(40);
    expect(withQuery(base, "tire")).toEqual({ started: true, query: "tire", filters: { classification: "B60B" }, limit: 20 });
    expect(withoutFilter(base, "classification")).toEqual({ started: true, query: "spoke", filters: {}, limit: 20 });
  });

  it("summarizes counts the way the toolbar shows them", () => {
    expect(resultSummary(41, 100)).toBe("41 of the top 100 matches");
    expect(resultSummary(41, null)).toBe("41 patents");
    expect(resultSummary(1, null)).toBe("1 patent");
    expect(resultSummary(100, 100)).toBe("The top 100 matches");
  });

  it("computes percentiles", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5, 1, 3], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBeCloseTo(9.55);
  });
});
