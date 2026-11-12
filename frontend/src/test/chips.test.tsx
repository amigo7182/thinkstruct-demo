import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { FilterKey } from "../state/search";
import { filterParams, result, setup } from "./fixtures";

const START = "/?q=spoke&classification=B60B&week_from=2024-03-07&week_to=2024-04-04&keywords=hub&title=Drag%20wheel";

const CHIP: Record<FilterKey, string> = {
  classification: "Class B60B",
  weeks: "7 Mar – 4 Apr 2024",
  keywords: "Words: hub",
  title: "Title: Drag wheel",
};

const PARAMS: Record<FilterKey, Record<string, string>> = {
  classification: { classification: "B60B" },
  weeks: { week_from: "2024-03-07", week_to: "2024-04-04" },
  keywords: { keywords: "hub" },
  title: { title: "Drag wheel" },
};

const ANSWER = { total: 3, results: [result("1", "Some wheel")] };

describe("filter chips", () => {
  it.each<[FilterKey[]]>([
    [["weeks", "title", "classification", "keywords"]],
    [["keywords", "classification", "title", "weeks"]],
    [["title", "weeks", "keywords", "classification"]],
    [["classification", "keywords", "weeks", "title"]],
  ])("removing them in the order %j leaves exactly the others", async (order) => {
    const user = userEvent.setup();
    const { calls } = setup(START);
    await calls[0].respond(ANSWER);
    const remaining = new Set<FilterKey>(["classification", "weeks", "keywords", "title"]);

    for (const key of order) {
      await user.click(screen.getByRole("button", { name: `Remove filter: ${CHIP[key]}` }));
      remaining.delete(key);
      const expected = Object.assign({ q: "spoke" }, ...[...remaining].map((k) => PARAMS[k]));
      expect(filterParams(calls.at(-1)!)).toEqual(expected);
      for (const k of remaining) expect(screen.getByRole("button", { name: `Remove filter: ${CHIP[k]}` })).toBeInTheDocument();
      await calls.at(-1)!.respond(ANSWER);
    }

    expect(calls).toHaveLength(1 + order.length); // one request per removal
    expect(screen.queryByRole("group", { name: "Active filters" })).not.toBeInTheDocument();
  });

  it("clear all removes every filter in one request and keeps the query", async () => {
    const user = userEvent.setup();
    const { calls } = setup(START);
    await calls[0].respond(ANSWER);
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(calls).toHaveLength(2);
    expect(filterParams(calls[1])).toEqual({ q: "spoke" });
  });

  it("removing a chip moves focus to its neighbour", async () => {
    const user = userEvent.setup();
    const { calls } = setup(START);
    await calls[0].respond(ANSWER);
    await user.click(screen.getByRole("button", { name: `Remove filter: ${CHIP.weeks}` }));
    expect(screen.getByRole("button", { name: `Remove filter: ${CHIP.keywords}` })).toHaveFocus();
  });
});
