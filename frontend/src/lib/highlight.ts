import type { Span } from "../api/types";

export interface Segment {
  text: string;
  marked: boolean;
}

/** Clamp, sort and merge spans so overlapping or out-of-range input still renders correctly. */
export function normalizeSpans(spans: readonly Span[], length: number): Span[] {
  const clean = spans
    .map(([start, end]): Span => [Math.max(0, Math.min(start, length)), Math.max(0, Math.min(end, length))])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  const merged: Span[] = [];
  for (const span of clean) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }
  return merged;
}

/** Slice text into plain and highlighted segments (rendered as text and <mark>, never as HTML). */
export function splitHighlights(text: string, spans: readonly Span[]): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  for (const [start, end] of normalizeSpans(spans, text.length)) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), marked: false });
    segments.push({ text: text.slice(start, end), marked: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), marked: false });
  return segments;
}

export interface Excerpt {
  text: string;
  spans: Span[];
  clippedStart: boolean;
  clippedEnd: boolean;
}

/**
 * A window of a long passage that starts a little before the first highlight,
 * cut at word boundaries, with spans shifted to match.
 */
export function excerpt(text: string, spans: readonly Span[], maxLength = 320, lead = 80): Excerpt {
  const all = normalizeSpans(spans, text.length);
  if (text.length <= maxLength) return { text, spans: all, clippedStart: false, clippedEnd: false };

  let start = Math.max(0, (all[0]?.[0] ?? 0) - lead);
  if (start > 0) {
    const space = text.indexOf(" ", start);
    start = space === -1 || space > (all[0]?.[0] ?? start) ? start : space + 1;
  }
  let end = Math.min(text.length, start + maxLength);
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > start) end = space;
  }
  const shifted = all
    .filter(([s, e]) => s >= start && e <= end)
    .map(([s, e]): Span => [s - start, e - start]);
  return { text: text.slice(start, end), spans: shifted, clippedStart: start > 0, clippedEnd: end < text.length };
}
