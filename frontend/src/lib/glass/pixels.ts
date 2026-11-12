// The toggle's icons: a 9×9 pixel matrix. Every moon pixel is paired with a sun pixel by
// angle around the centre, and the morph between them is a pure function of the knob's
// position, so dragging halfway holds the swarm mid-flight.

export const GRID = 9;
const HALF = (GRID - 1) / 2;
export const MAX_PIXELS = 32; // the shader's uniform array size

export type Cell = readonly [x: number, y: number]; // grid units from the centre, y down

function cells(test: (x: number, y: number) => boolean): Cell[] {
  const out: Cell[] = [];
  for (let y = -HALF; y <= HALF; y++) for (let x = -HALF; x <= HALF; x++) if (test(x, y)) out.push([x, y]);
  return out;
}

/** A crescent opening to the top right, with two stars. */
export const MOON = cells((x, y) => {
  const lit = (x + 0.4) ** 2 + (y - 0.3) ** 2 <= 3.7 ** 2;
  const cut = (x - 1.7) ** 2 + (y + 0.9) ** 2 <= 2.9 ** 2;
  const star = (x === 3 && y === -3) || (x === 4 && y === -1);
  return (lit && !cut) || star;
});

/** A round core with eight rays. */
export const SUN = cells(
  (x, y) =>
    x * x + y * y <= 5 || (Math.abs(x) === 4 && y === 0) || (x === 0 && Math.abs(y) === 4) || (Math.abs(x) === 3 && Math.abs(y) === 3),
);

const angleOf = ([x, y]: Cell) => Math.atan2(y, x);
const radiusOf = ([x, y]: Cell) => Math.hypot(x, y);

function byAngle(set: Cell[]): Cell[] {
  return [...set].sort((a, b) => angleOf(a) - angleOf(b) || radiusOf(a) - radiusOf(b));
}

/** Deterministic 0..1 noise, so every pixel keeps its own stagger, swirl and spring. */
function hash(i: number, salt: number): number {
  const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export const MAX_DELAY = 0.38; // the last pixel starts moving at 38% of the way

export interface Pair {
  moon: Cell;
  sun: Cell;
  delay: number; // 0..MAX_DELAY of the knob's travel before this pixel starts
  swirl: number; // extra radians it turns through mid-flight
  spring: number; // overshoot of its settle
}

/** Both icons sorted by angle and resampled to the same count, so each moon pixel has a sun pixel. */
export function pairPixels(moon: Cell[] = MOON, sun: Cell[] = SUN): Pair[] {
  const a = byAngle(moon);
  const b = byAngle(sun);
  const n = Math.max(a.length, b.length);
  return Array.from({ length: n }, (_, i) => ({
    moon: a[Math.floor((i * a.length) / n)],
    sun: b[Math.floor((i * b.length) / n)],
    delay: hash(i, 1) * MAX_DELAY,
    swirl: 0.7 + hash(i, 2) * 1.1,
    spring: 1.1 + hash(i, 3) * 1.6,
  }));
}

export const PAIRS = pairPixels();

export interface PixelState {
  x: number; // grid units from the centre
  y: number;
  size: number; // fraction of a cell
  sun: number; // colour: 0 = moon, 1 = sun
}

/** An ease-out with overshoot: 0 at t=0, exactly 1 at t=1. */
function springOut(t: number, overshoot: number): number {
  const u = t - 1;
  return 1 + (overshoot + 1) * u * u * u + overshoot * u * u;
}

function shortestTurn(from: number, to: number): number {
  let d = (to - from) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Where every pixel is when the knob is at `position` (0 = night/moon, 1 = day/sun).
 * Each pixel travels on its own: it starts after its delay, swirls around the centre
 * on the way, and overshoots a little before settling.
 */
export function morph(position: number, pairs: Pair[] = PAIRS): PixelState[] {
  const p = Math.min(1, Math.max(0, position));
  return pairs.map(({ moon, sun, delay, swirl, spring }) => {
    const t = Math.min(1, Math.max(0, (p - delay) / (1 - MAX_DELAY)));
    const f = springOut(t, spring);
    const flight = Math.sin(Math.PI * t); // 0 at both ends, 1 mid-way
    const angle = angleOf(moon) + shortestTurn(angleOf(moon), angleOf(sun)) * f + swirl * flight;
    const radius = radiusOf(moon) + (radiusOf(sun) - radiusOf(moon)) * f + 0.45 * flight;
    const settled = t === 0 ? moon : t === 1 ? sun : null; // land exactly on the grid
    return {
      x: settled ? settled[0] : Math.cos(angle) * radius,
      y: settled ? settled[1] : Math.sin(angle) * radius,
      size: 0.74 - 0.2 * flight,
      sun: t < 0.35 ? 0 : t > 0.65 ? 1 : (t - 0.35) / 0.3,
    };
  });
}
