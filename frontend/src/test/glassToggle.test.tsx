import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { GlassToggle } from "../components/GlassToggle";
import { MAX_DELAY, MAX_PIXELS, MOON, morph, PAIRS, SUN } from "../lib/glass/pixels";
import { useTheme, type Theme } from "../lib/hooks";

const key = ([x, y]: readonly [number, number]) => `${Math.round(x)},${Math.round(y)}`;
const sorted = (cells: readonly (readonly [number, number])[]) => cells.map(key).sort();

describe("glass toggle pixels", () => {
  it("pairs every moon pixel with a sun pixel, in angle order, within the shader's limit", () => {
    expect(PAIRS.length).toBe(Math.max(MOON.length, SUN.length));
    expect(PAIRS.length).toBeLessThanOrEqual(MAX_PIXELS);
    expect(new Set(PAIRS.map((p) => key(p.moon)))).toEqual(new Set(MOON.map(key)));
    expect(new Set(PAIRS.map((p) => key(p.sun)))).toEqual(new Set(SUN.map(key)));
    const angles = PAIRS.map((p) => Math.atan2(p.moon[1], p.moon[0]));
    expect(angles).toEqual([...angles].sort((a, b) => a - b));
  });

  it("is exactly the moon at night and the sun by day", () => {
    const night = morph(0).map((p) => [p.x, p.y] as const);
    const day = morph(1).map((p) => [p.x, p.y] as const);
    expect(new Set(sorted(night))).toEqual(new Set(sorted(MOON)));
    expect(new Set(sorted(day))).toEqual(new Set(sorted(SUN)));
    expect(morph(0).every((p) => p.sun === 0)).toBe(true);
    expect(morph(1).every((p) => p.sun === 1)).toBe(true);
  });

  it("holds the swarm mid-flight at any knob position, the same way every time", () => {
    const half = morph(0.5);
    expect(morph(0.5)).toEqual(half); // scrubbed by position, not by time
    const flying = half.filter((p) => !Number.isInteger(p.x) || !Number.isInteger(p.y));
    expect(flying.length).toBeGreaterThan(half.length / 2);
    // Staggered: just after the start only the earliest pixels have left.
    const early = morph(MAX_DELAY / 2).filter((p, i) => p.x !== morph(0)[i].x || p.y !== morph(0)[i].y);
    expect(early.length).toBeGreaterThan(0);
    expect(early.length).toBeLessThan(half.length);
  });
});

function Harness() {
  const { theme, setTheme } = useTheme();
  return <GlassToggle theme={theme} onChange={setTheme} />;
}

describe("glass toggle", () => {
  it("switches the theme and remembers it, as a plain switch when WebGL is unavailable", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const toggle = screen.getByRole("button", { name: "Dark mode" });
    expect(toggle).toHaveClass("glass-toggle--plain"); // jsdom has no WebGL
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("patent-search.theme")).toBe("dark");

    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("follows a theme set from elsewhere", () => {
    function Controlled() {
      const [theme, setTheme] = useState<Theme>("dark");
      return (
        <>
          <GlassToggle theme={theme} onChange={setTheme} />
          <button type="button" onClick={() => setTheme("light")}>
            Use light
          </button>
        </>
      );
    }
    render(<Controlled />);
    expect(screen.getByRole("button", { name: "Dark mode" })).toHaveAttribute("aria-pressed", "true");
    screen.getByRole("button", { name: "Use light" }).click();
    return expect(screen.findByRole("button", { name: "Dark mode", pressed: false })).resolves.toBeInTheDocument();
  });
});
