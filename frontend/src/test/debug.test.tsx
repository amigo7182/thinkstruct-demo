import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { classButton, INITIAL, setup } from "./fixtures";

describe("debug panel", () => {
  it("only appears with ?debug=1", async () => {
    const { calls } = setup("/?q=spoke");
    await calls[0].respond(INITIAL);
    expect(screen.queryByRole("complementary", { name: "Debug panel" })).not.toBeInTheDocument();
  });

  it("passes the delay to the API and keeps debug=1 in the URL", async () => {
    const user = userEvent.setup();
    const { calls } = setup("/?q=spoke&debug=1");
    await calls[0].respond(INITIAL);
    expect(screen.getByRole("complementary", { name: "Debug panel" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Server delay"), "1000");
    await user.click(classButton("B60B"));
    expect(calls[1].params.get("delay_ms")).toBe("1000");
    expect(new URLSearchParams(window.location.search).get("debug")).toBe("1");
  });

  it("records a latency sample for each filter change", async () => {
    const user = userEvent.setup();
    const { calls, store } = setup("/?q=spoke&debug=1");
    await calls[0].respond(INITIAL);
    expect(store.getSnapshot().latency.samples).toHaveLength(0); // the first load isn't a change

    await user.click(classButton("B60B"));
    await calls[1].respond(INITIAL);
    const samples = store.getSnapshot().latency.samples;
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ kind: "filter", requestId: calls[1].id });
    expect(samples[0].ms).toBeGreaterThanOrEqual(0);
    expect(screen.getByText(/^updated in /)).toBeInTheDocument();
  });
});
