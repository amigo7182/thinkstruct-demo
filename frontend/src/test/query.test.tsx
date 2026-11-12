import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { classButton, filterParams, INITIAL, result, setup } from "./fixtures";

const searchbox = () => screen.getByRole("searchbox", { name: "Describe the invention" });

describe("queries", () => {
  it("a new query keeps the current filters", async () => {
    const user = userEvent.setup();
    const { calls } = setup("/?q=spoke&classification=B60B&week_from=2024-03-07&week_to=2024-03-07");
    await calls[0].respond({ total: 5, results: [result("1", "Spoke")] });

    await user.clear(searchbox());
    await user.type(searchbox(), "tire tread with sipes");
    expect(calls).toHaveLength(1); // typing alone never searches
    await user.keyboard("{Enter}");

    expect(calls).toHaveLength(2);
    expect(filterParams(calls[1])).toEqual({
      q: "tire tread with sipes",
      classification: "B60B",
      week_from: "2024-03-07",
      week_to: "2024-03-07",
    });
    const url = new URLSearchParams(window.location.search);
    expect(url.get("q")).toBe("tire tread with sipes");
    expect(url.get("classification")).toBe("B60B");
  });

  it("Esc clears the box without searching", async () => {
    const user = userEvent.setup();
    const { calls } = setup("/?q=spoke");
    await calls[0].respond(INITIAL);
    await user.click(searchbox());
    await user.keyboard("{Escape}");
    expect(searchbox()).toHaveValue("");
    expect(calls).toHaveLength(1);
  });

  it("show more raises the limit through the same request path", async () => {
    const user = userEvent.setup();
    const { calls } = setup("/?q=spoke");
    await calls[0].respond({ ...INITIAL, total: 100 });
    expect(calls[0].params.get("limit")).toBe("20");
    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(calls).toHaveLength(2);
    expect(calls[1].params.get("limit")).toBe("40");
    expect(filterParams(calls[1])).toEqual({ q: "spoke" });
  });

  it("back and forward restore earlier states, one request each", async () => {
    const user = userEvent.setup();
    const { calls } = setup("/?q=spoke");
    await calls[0].respond(INITIAL);
    await user.click(classButton("B60B"));
    await calls[1].respond({ ...INITIAL, total: 77 });

    window.history.back();
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(filterParams(calls[2])).toEqual({ q: "spoke" });

    window.history.forward();
    await waitFor(() => expect(calls).toHaveLength(4));
    expect(filterParams(calls[3])).toEqual({ q: "spoke", classification: "B60B" });
  });

  it("starts on the landing page, and an example query searches", async () => {
    const user = userEvent.setup();
    const { calls } = setup("/");
    expect(screen.getByRole("heading", { name: "describe the invention" })).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "tire tread with sipes" }));
    expect(calls).toHaveLength(1);
    expect(filterParams(calls[0])).toEqual({ q: "tire tread with sipes" });
  });

  it("shows the no-results state with the chips that caused it", async () => {
    const { calls } = setup("/?q=spoke&classification=B60D");
    await calls[0].respond({ ...INITIAL, total: 0, results: [], facets: { ...INITIAL.facets, classification: [] } });
    expect(screen.getByText("No patents in this part of the sea.")).toBeInTheDocument();
    expect(screen.getByText("Remove a filter to widen the results.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove filter: Class B60D" })).toBeInTheDocument();
    // No week filter caused it, so there's no timeline to widen.
    expect(screen.queryByRole("region", { name: "Published by week" })).not.toBeInTheDocument();
  });
});
