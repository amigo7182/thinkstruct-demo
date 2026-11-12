import { useEffect, useRef } from "react";
import { usePageVisible, type Theme } from "../lib/hooks";
import { OceanEngine, type OceanPalette } from "../vendor/ascii-sharks";

// The page's paper, grid, ink and accent colours, so the ocean sits in the page.
const PALETTES: Record<Theme, Partial<OceanPalette>> = {
  light: { background: "#F6F7F6", grid: "#E4E7E4", fish: [21, 24, 22], wake: [36, 80, 216] },
  dark: { background: "#000000", grid: "#141714", fish: [230, 238, 255], wake: [134, 166, 255] },
};

// The engine needs these; it throws on its own if the canvas has no 2D context.
function canRun(): boolean {
  return (
    typeof ResizeObserver !== "undefined" &&
    typeof IntersectionObserver !== "undefined" &&
    typeof window.matchMedia === "function"
  );
}

/**
 * ASCII sharks behind the landing and no-results states (decorative, hidden from
 * assistive tech). The engine runs only while this is mounted and the tab is visible;
 * with prefers-reduced-motion it draws one still frame and never animates.
 */
export function Sharks({ theme }: { theme: Theme }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visible = usePageVisible();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible || !canRun()) return;
    let engine: OceanEngine;
    try {
      engine = new OceanEngine(canvas, undefined, PALETTES[theme]);
    } catch {
      return; // no 2D canvas: the page works fine without sharks
    }
    return () => engine.destroy();
  }, [theme, visible]);

  return <canvas ref={canvasRef} className="sharks" aria-hidden="true" />;
}
