import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Highlight } from "../components/Highlight";
import { excerpt } from "../lib/highlight";
import { INITIAL, result, setup } from "./fixtures";

const marks = (root: HTMLElement) => [...root.querySelectorAll("mark")].map((m) => m.textContent);

describe("highlights", () => {
  it("wrap exactly the spanned characters in <mark>", () => {
    const { container } = render(<Highlight text="The injection molding tool" spans={[[4, 13], [14, 21]]} />);
    expect(marks(container)).toEqual(["injection", "molding"]);
    expect(container.textContent).toBe("The injection molding tool");
  });

  it("handle overlapping, unsorted and out-of-range spans", () => {
    const { container } = render(<Highlight text="The injection molding tool" spans={[[14, 21], [8, 13], [4, 10], [20, 99]]} />);
    expect(marks(container)).toEqual(["injection", "molding tool"]);
    expect(container.textContent).toBe("The injection molding tool");
  });

  it("render text as text, never as HTML", () => {
    const { container } = render(<Highlight text="<b>bold</b> spoke" spans={[[12, 17]]} />);
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toBe("<b>bold</b> spoke");
    expect(marks(container)).toEqual(["spoke"]);
  });

  it("render the API's spans in result titles and passages", async () => {
    const title = "Spoke for a bicycle wheel";
    const text = "A spoke made by injection molding of a resin.";
    const { calls } = setup("/?q=spoke");
    await calls[0].respond({
      ...INITIAL,
      results: [result("1", title, { title_spans: [[0, 5]], match: { kind: "claim", number: 12, text, spans: [[2, 7], [16, 25], [26, 33]] } })],
    });
    const row = screen.getByRole("heading", { name: title }).closest("li")!;
    expect(marks(within(row).getByRole("heading"))).toEqual(["Spoke"]);
    expect(within(row).getByText("Claim 12")).toBeInTheDocument();
    expect(marks(row.querySelector(".passage")!)).toEqual(["spoke", "injection", "molding"]);
  });

  it("excerpts keep the spans pointing at the same words", () => {
    const text = `${"lorem ipsum ".repeat(40)}the spoke is molded ${"dolor sit ".repeat(40)}`;
    const start = text.indexOf("spoke");
    const cut = excerpt(text, [[start, start + 5]]);
    expect(cut.clippedStart).toBe(true);
    expect(cut.clippedEnd).toBe(true);
    expect(cut.text.length).toBeLessThanOrEqual(320);
    const [[s, e]] = cut.spans;
    expect(cut.text.slice(s, e)).toBe("spoke");
  });
});
