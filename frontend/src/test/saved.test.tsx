import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { savedSearches } from "../state/saved";
import { filterParams, INITIAL, setup } from "./fixtures";

describe("saved searches", () => {
  beforeEach(() => savedSearches.reload());

  it("saves {name, query, filters} to localStorage and restores it", async () => {
    const user = userEvent.setup();
    const { calls } = setup("/?q=spoke&classification=B60B");
    await calls[0].respond(INITIAL);

    await user.click(screen.getByRole("button", { name: "Save this search" }));
    const name = screen.getByRole("textbox", { name: "Name for this search" });
    await user.clear(name);
    await user.type(name, "Molded spokes{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    const stored = JSON.parse(window.localStorage.getItem("patent-search.saved.v1")!);
    expect(stored).toMatchObject([{ name: "Molded spokes", query: "spoke", filters: { classification: "B60B" } }]);

    await user.click(screen.getByRole("button", { name: "Clear all" }));
    await user.click(screen.getByRole("button", { name: /Saved searches/ }));
    await user.click(screen.getByRole("button", { name: /^Molded spokes/ }));
    expect(filterParams(calls.at(-1)!)).toEqual({ q: "spoke", classification: "B60B" });
  });

  it("still works for the visit when storage throws", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const user = userEvent.setup();
    const { calls } = setup("/?q=spoke");
    await calls[0].respond(INITIAL);
    await user.click(screen.getByRole("button", { name: "Save this search" }));
    await user.keyboard("{Enter}");
    expect(screen.getByText(/Saved for this visit only/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Saved searches/ }));
    expect(screen.getByRole("button", { name: /^spoke/ })).toBeInTheDocument();
  });
});
