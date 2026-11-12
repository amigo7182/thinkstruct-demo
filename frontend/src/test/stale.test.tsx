import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { classButton, INITIAL, NO_FILTERS, result, setup, watchText } from "./fixtures";

describe("stale responses", () => {
  it("never renders an older response that arrives after a newer one", async () => {
    const user = userEvent.setup();
    const { calls } = setup("/?q=spoke");
    await calls[0].respond(INITIAL);
    const seen = watchText();

    await user.click(classButton("B60B")); // request 2
    await user.click(classButton("B60C")); // request 3, sent before 2 is answered
    expect(calls).toHaveLength(3);
    expect(calls[1].signal.aborted).toBe(true); // the older request was cancelled...

    await calls[2].respond({
      ...INITIAL,
      total: 23,
      filters: { ...NO_FILTERS, classification: "B60C" },
      results: [result("3", "Newest tire result")],
    });
    // ...but even when its answer arrives anyway, after the newer one, it is dropped.
    await calls[1].respond({
      ...INITIAL,
      total: 77,
      filters: { ...NO_FILTERS, classification: "B60B" },
      results: [result("2", "Stale wheel result")],
    });

    expect(screen.getByText("Newest tire result")).toBeInTheDocument();
    expect(screen.getByText("23 of the top 100 matches")).toBeInTheDocument();
    expect(seen()).not.toContain("Stale wheel result");
  });

  it("keeps the previous response, dimmed, while only an older request has answered", async () => {
    const user = userEvent.setup();
    const { calls, view } = setup("/?q=spoke");
    await calls[0].respond(INITIAL);
    const seen = watchText();

    await user.click(classButton("B60B"));
    await user.click(classButton("B60C"));
    // The older request answers first, while the newest is still pending.
    await calls[1].respond({ ...INITIAL, total: 77, results: [result("2", "Stale wheel result")] });

    const views = view.container.querySelector(".views")!;
    expect(screen.getByText("Initial spoke wheel")).toBeInTheDocument();
    expect(views).toHaveAttribute("data-pending", "true");
    expect(views).toHaveAttribute("aria-busy", "true");

    await calls[2].respond({ ...INITIAL, total: 23, results: [result("3", "Newest tire result")] });
    expect(screen.getByText("Newest tire result")).toBeInTheDocument();
    expect(views).toHaveAttribute("data-pending", "false");
    expect(seen()).not.toContain("Stale wheel result");
  });

  it("drops an answer whose echoed request_id is not the latest", async () => {
    const user = userEvent.setup();
    const { calls } = setup("/?q=spoke");
    await calls[0].respond(INITIAL);
    await user.click(classButton("B60B"));
    await calls[1].respond({ ...INITIAL, request_id: 1, results: [result("9", "Mislabelled result")] });
    expect(screen.queryByText("Mislabelled result")).not.toBeInTheDocument();
  });
});
