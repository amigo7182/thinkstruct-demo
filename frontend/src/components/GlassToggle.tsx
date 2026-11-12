import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { CANVAS, createGlassRenderer, TOGGLE, TRAVEL, type GlassRenderer } from "../lib/glass/renderer";
import { useMediaQuery, type Theme } from "../lib/hooks";

const STIFFNESS = 210; // a quick spring with a hint of overshoot
const DAMPING = 24;
const DRAG_START = 4; // px of movement before a press becomes a drag
const FLICK = 0.45; // px/ms: released faster than this, the knob goes where it was thrown

/** Knob position for a theme: night on the left, day on the right. */
const positionOf = (theme: Theme) => (theme === "dark" ? 0 : 1);

interface Drag {
  pointer: number;
  startX: number;
  startPos: number;
  moved: boolean;
  lastX: number;
  lastTime: number;
  velocity: number; // px/ms
}

/**
 * The light/dark switch: a glass knob drawn by one WebGL shader (see lib/glass). Click or
 * press Enter/Space to switch; drag the knob to scrub the moon-to-sun morph, and the theme
 * changes when you let go. Without WebGL it is a plain switch with the same behaviour.
 */
export function GlassToggle({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<GlassRenderer | null>(null);
  const [webgl, setWebgl] = useState(true);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const view = useRef({ lightPage: theme === "light", reducedMotion });
  view.current = { lightPage: theme === "light", reducedMotion };
  const motion = useRef({ pos: positionOf(theme), vel: 0, target: positionOf(theme), dragging: false, frame: 0, last: 0 });
  const drag = useRef<Drag | null>(null);
  const dragEndedAt = useRef(-Infinity);

  const draw = useCallback(() => renderer.current?.draw(motion.current.pos, view.current.lightPage), []);

  // Runs the spring until the knob settles, then stops: nothing animates while idle.
  const animate = useCallback(() => {
    const m = motion.current;
    if (m.frame) return;
    m.last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - m.last) / 1000);
      m.last = now;
      for (let left = dt; left > 0; left -= 1 / 240) {
        const h = Math.min(left, 1 / 240);
        m.vel += (-STIFFNESS * (m.pos - m.target) - DAMPING * m.vel) * h;
        m.pos += m.vel * h;
        if (m.pos < 0 || m.pos > 1) {
          m.pos = Math.min(1, Math.max(0, m.pos)); // the track's end stops the knob
          m.vel = 0;
        }
      }
      const settled = Math.abs(m.pos - m.target) < 5e-4 && Math.abs(m.vel) < 5e-3;
      if (settled) {
        m.pos = m.target;
        m.vel = 0;
      }
      draw();
      m.frame = settled || m.dragging ? 0 : requestAnimationFrame(tick);
    };
    m.frame = requestAnimationFrame(tick);
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const created = createGlassRenderer(canvas);
    if (!created) {
      setWebgl(false);
      return;
    }
    renderer.current = created;
    const fit = () => {
      created.resize(window.devicePixelRatio || 1);
      draw();
    };
    const onLost = (event: Event) => {
      event.preventDefault();
      setWebgl(false);
    };
    fit();
    window.addEventListener("resize", fit); // also fires when the zoom (device pixel ratio) changes
    canvas.addEventListener("webglcontextlost", onLost);
    const m = motion.current;
    return () => {
      cancelAnimationFrame(m.frame);
      m.frame = 0;
      window.removeEventListener("resize", fit);
      canvas.removeEventListener("webglcontextlost", onLost);
      created.dispose();
      renderer.current = null;
    };
  }, [draw]);

  // Follow the theme, whether it changed here or elsewhere (system setting, another tab).
  useEffect(() => {
    const m = motion.current;
    m.target = positionOf(theme);
    if (m.dragging) return;
    if (reducedMotion) {
      m.pos = m.target;
      m.vel = 0;
      draw();
    } else {
      animate();
    }
  }, [theme, reducedMotion, draw, animate]);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !webgl) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const x = event.clientX;
    drag.current = { pointer: event.pointerId, startX: x, startPos: motion.current.pos, moved: false, lastX: x, lastTime: event.timeStamp, velocity: 0 };
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d || d.pointer !== event.pointerId) return;
    const dx = event.clientX - d.startX;
    if (!d.moved && Math.abs(dx) < DRAG_START) return;
    d.moved = true;
    const m = motion.current;
    m.dragging = true;
    m.pos = Math.min(1, Math.max(0, d.startPos + dx / TRAVEL)); // scrubs the morph directly
    m.vel = 0;
    const elapsed = Math.max(1, event.timeStamp - d.lastTime);
    d.velocity = (event.clientX - d.lastX) / elapsed;
    d.lastX = event.clientX;
    d.lastTime = event.timeStamp;
    draw();
  }

  function onPointerEnd(event: PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d || d.pointer !== event.pointerId) return;
    drag.current = null;
    if (!d.moved) return; // a plain press: the click handler switches
    dragEndedAt.current = event.timeStamp;
    const m = motion.current;
    m.dragging = false;
    const side = Math.abs(d.velocity) > FLICK ? (d.velocity > 0 ? 1 : 0) : m.pos >= 0.5 ? 1 : 0;
    m.target = side;
    m.vel = Math.max(-6, Math.min(6, (d.velocity * 1000) / TRAVEL)); // carry the throw into the spring
    const next: Theme = side === 1 ? "light" : "dark";
    if (next !== theme) onChange(next);
    if (view.current.reducedMotion) {
      m.pos = side;
      m.vel = 0;
      draw();
    } else {
      animate();
    }
  }

  return (
    <button
      type="button"
      className={`glass-toggle${webgl ? "" : " glass-toggle--plain"}`}
      style={{ width: TOGGLE.width, height: TOGGLE.height, borderRadius: TOGGLE.radius }}
      aria-label="Dark mode"
      aria-pressed={theme === "dark"}
      onClick={(event) => {
        if (event.timeStamp - dragEndedAt.current < 500) return; // the click that ends a drag
        onChange(theme === "dark" ? "light" : "dark");
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      {webgl ? (
        <canvas
          ref={canvasRef}
          className="glass-toggle-canvas"
          aria-hidden="true"
          style={{ left: -TOGGLE.spill, top: -TOGGLE.spill, width: CANVAS.width, height: CANVAS.height }}
        />
      ) : (
        <span className="glass-toggle-knob" aria-hidden="true" />
      )}
    </button>
  );
}
