import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { formatDay } from "../lib/format";
import { classButton, filterParams, INITIAL, node, NO_FILTERS, result, setup, weeks, WEEKS } from "./fixtures";

const region = (name: string) => within(screen.getByRole("region", { name }));
const weekButton = (week: string, count: number) =>
  region("Published by week").getByRole("button", { name: `${formatDay(week)}: ${count} ${count === 1 ? "patent" : "patents"}` });

describe("linked views", () => {
  it("clicking a classification node sends one request, and every view renders from its response", async () => {
    const user = userEvent.setup();
    const { calls } = setup("/?q=spoke");
    await calls[0].respond(INITIAL);

    await user.click(classButton("B60B"));
    expect(calls).toHaveLength(2);
    expect(filterParams(calls[1])).toEqual({ q: "spoke", classification: "B60B" });

    await calls[1].respond({
      total: 77,
      filters: { ...NO_FILTERS, classification: "B60B" },
      facets: {
        classification: [node("B", 77, [node("B60", 77, [node("B60B", 77, [node("B60B 1", 20), node("B60B 27", 14)])])])],
        weeks: weeks({ [WEEKS[5]]: 7 }),
      },
      results: [result("20240000002", "Hub for a spoked wheel")],
    });

    // Count, chips, classification, timeline and results all come from that one response.
    expect(screen.getByText("77 of the top 100 matches")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove filter: Class B60B" })).toBeInTheDocument();
    const classification = region("Classification");
    expect(classification.getByRole("button", { name: "B60B 1: 20 patents" })).toBeInTheDocument();
    expect(classification.getByRole("button", { name: "B60B 27: 14 patents" })).toBeInTheDocument();
    expect(classification.queryByRole("button", { name: /^B60C/ })).not.toBeInTheDocument();
    expect(within(classification.getByRole("navigation")).getByText("B60B")).toHaveAttribute("aria-current", "true");
    expect(weekButton(WEEKS[5], 7)).toBeInTheDocument();
    expect(weekButton(WEEKS[6], 0)).toBeInTheDocument();
    expect(screen.getByText("Hub for a spoked wheel")).toBeInTheDocument();
    expect(screen.queryByText("Initial spoke wheel")).not.toBeInTheDocument();
    expect(calls).toHaveLength(2); // no extra requests per view
  });

  it("clicking a week filters to it, shift-click selects a range, one request each", async () => {
    const user = userEvent.setup();
    const { calls } = setup("/?q=spoke");
    await calls[0].respond(INITIAL);

    await user.click(weekButton(WEEKS[3], 1));
    expect(calls).toHaveLength(2);
    expect(filterParams(calls[1])).toEqual({ q: "spoke", week_from: WEEKS[3], week_to: WEEKS[3] });
    await calls[1].respond({
      ...INITIAL,
      total: 1,
      filters: { ...NO_FILTERS, week_from: WEEKS[3], week_to: WEEKS[3] },
      facets: { ...INITIAL.facets, weeks: weeks({ [WEEKS[3]]: 1 }) },
    });
    expect(weekButton(WEEKS[3], 1)).toHaveAttribute("aria-pressed", "true");
    expect(weekButton(WEEKS[4], 0)).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(weekButton(WEEKS[6], 0), { shiftKey: true });
    expect(calls).toHaveLength(3);
    expect(filterParams(calls[2])).toEqual({ q: "spoke", week_from: WEEKS[3], week_to: WEEKS[6] });
    expect(screen.getByRole("button", { name: "Remove filter: 7–28 Mar 2024" })).toBeInTheDocument();
  });

  it("a range can start at a week with no patents", async () => {
    const user = userEvent.setup();
    const { calls } = setup("/?q=spoke");
    await calls[0].respond(INITIAL);

    // Early March has no matches, so filtering to it alone gives no results...
    await user.click(weekButton(WEEKS[3], 1));
    await calls[1].respond({
      ...INITIAL,
      total: 0,
      results: [],
      filters: { ...NO_FILTERS, week_from: WEEKS[3], week_to: WEEKS[3] },
      facets: { classification: [], weeks: weeks() },
    });
    expect(screen.getByText("No patents in this part of the sea.")).toBeInTheDocument();

    // ...but the timeline stays, and shift-clicking December selects the range from March.
    fireEvent.click(weekButton(WEEKS[42], 0), { shiftKey: true });
    expect(calls).toHaveLength(3);
    expect(filterParams(calls[2])).toEqual({ q: "spoke", week_from: WEEKS[3], week_to: WEEKS[42] });
  });

  it("the results list filters the other views too", async () => {
    const user = userEvent.setup();
    const { calls } = setup("/?q=spoke");
    await calls[0].respond(INITIAL);
    await user.click(screen.getByRole("button", { name: "Filter to class B60B 27" }));
    expect(filterParams(calls[1])).toEqual({ q: "spoke", classification: "B60B 27" });
    await user.click(screen.getByRole("button", { name: `Filter to the week of ${formatDay(WEEKS[0])}` }));
    expect(filterParams(calls[2])).toEqual({ q: "spoke", classification: "B60B 27", week_from: WEEKS[0], week_to: WEEKS[0] });
  });

  it("a breadcrumb goes back up the classification", async () => {
    const user = userEvent.setup();
    const { calls } = setup("/?q=spoke&classification=B60B%2027");
    await calls[0].respond({
      ...INITIAL,
      total: 14,
      filters: { ...NO_FILTERS, classification: "B60B 27" },
      facets: { ...INITIAL.facets, classification: [node("B", 14, [node("B60", 14, [node("B60B", 14, [node("B60B 27", 14)])])])] },
    });
    const crumbs = within(region("Classification").getByRole("navigation"));
    await user.click(crumbs.getByRole("button", { name: "B60B" }));
    expect(filterParams(calls[1])).toEqual({ q: "spoke", classification: "B60B" });
    await user.click(crumbs.getByRole("button", { name: "All classes" }));
    expect(filterParams(calls[2])).toEqual({ q: "spoke" });
  });
});
