// The single source of truth: { query, filters } plus the page size. Everything here is
// pure, so the store, the URL and the tests all share the same rules.

import type { SearchParams } from "../api/types";
import { formatDay, formatRange } from "../lib/format";

export interface Filters {
  classification?: string; // any level: "B", "B60", "B60B", "B60B 27", or "Unclassified"
  weekFrom?: string; // inclusive, YYYY-MM-DD
  weekTo?: string; // inclusive, YYYY-MM-DD
  title?: string; // exact title, ignoring case and spacing
  keywords?: string; // every word must appear in the title or abstract
}

/** One chip per key; the week range is one filter even though it is two parameters. */
export type FilterKey = "classification" | "weeks" | "keywords" | "title";

export interface SearchState {
  started: boolean; // false = the landing page
  query: string; // "" = browse mode
  filters: Filters;
  limit: number; // "Show more" raises it in steps of PAGE_SIZE
}

export const PAGE_SIZE = 20;
export const MAX_LIMIT = 100; // the API's maximum
export const UNCLASSIFIED = "Unclassified";

export const LANDING: SearchState = { started: false, query: "", filters: {}, limit: PAGE_SIZE };

// --- normalizing input (URL, saved searches) the same way the backend does ----------------

const CODE = /^[A-H](\d{2}([A-Z](\d{1,4})?)?)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "b60b27" -> "B60B 27", like backend/index.py normalize_prefix. Invalid codes become undefined. */
export function normalizeClassification(value: string | null | undefined): string | undefined {
  const raw = (value ?? "").trim();
  if (!raw) return undefined;
  if (raw.toLowerCase() === UNCLASSIFIED.toLowerCase()) return UNCLASSIFIED;
  const compact = raw.replace(/\s+/g, "").toUpperCase();
  if (!CODE.test(compact)) return undefined;
  return compact.length <= 4 ? compact : `${compact.slice(0, 4)} ${Number.parseInt(compact.slice(4), 10)}`;
}

/** Every level from the broadest down: "B60B 27" -> ["B", "B60", "B60B", "B60B 27"]. */
export function classificationPath(code: string): string[] {
  if (code === UNCLASSIFIED) return [UNCLASSIFIED];
  const path = [code.slice(0, 1)];
  if (code.length >= 3) path.push(code.slice(0, 3));
  if (code.length >= 4) path.push(code.slice(0, 4));
  if (code.length > 4) path.push(code);
  return path;
}

export function classificationParent(code: string): string | undefined {
  const path = classificationPath(code);
  return path.length > 1 ? path[path.length - 2] : undefined;
}

function normalizeWeek(value: string | null | undefined): string | undefined {
  const raw = (value ?? "").trim();
  if (!ISO_DATE.test(raw) || Number.isNaN(Date.parse(raw))) return undefined;
  return raw;
}

function normalizeText(value: string | null | undefined): string | undefined {
  const raw = (value ?? "").trim().replace(/\s+/g, " ");
  return raw || undefined;
}

export function cleanFilters(filters: Filters): Filters {
  let weekFrom = normalizeWeek(filters.weekFrom);
  let weekTo = normalizeWeek(filters.weekTo);
  if (weekFrom && weekTo && weekFrom > weekTo) [weekFrom, weekTo] = [weekTo, weekFrom];
  const clean: Filters = {
    classification: normalizeClassification(filters.classification),
    weekFrom,
    weekTo,
    title: normalizeText(filters.title),
    keywords: normalizeText(filters.keywords),
  };
  for (const key of Object.keys(clean) as (keyof Filters)[]) if (clean[key] === undefined) delete clean[key];
  return clean;
}

export function hasFilters(filters: Filters): boolean {
  return Object.keys(cleanFilters(filters)).length > 0;
}

// --- state transitions: each is one user action ------------------------------------------

/** A new query keeps the current filters. */
export function withQuery(state: SearchState, query: string): SearchState {
  return { started: true, query: query.trim(), filters: state.filters, limit: PAGE_SIZE };
}

export function withFilters(state: SearchState, patch: Partial<Filters>): SearchState {
  return { ...state, started: true, filters: cleanFilters({ ...state.filters, ...patch }), limit: PAGE_SIZE };
}

export function withoutFilter(state: SearchState, key: FilterKey): SearchState {
  const patches: Record<FilterKey, Partial<Filters>> = {
    classification: { classification: undefined },
    weeks: { weekFrom: undefined, weekTo: undefined },
    keywords: { keywords: undefined },
    title: { title: undefined },
  };
  return withFilters(state, patches[key]);
}

export function withoutFilters(state: SearchState): SearchState {
  return { ...state, started: true, filters: {}, limit: PAGE_SIZE };
}

export function withMore(state: SearchState): SearchState {
  return { ...state, limit: Math.min(MAX_LIMIT, state.limit + PAGE_SIZE) };
}

export function browseAll(): SearchState {
  return { started: true, query: "", filters: {}, limit: PAGE_SIZE };
}

export function restored(query: string, filters: Filters): SearchState {
  return { started: true, query: query.trim(), filters: cleanFilters(filters), limit: PAGE_SIZE };
}

// --- URL and API parameters ------------------------------------------------------------

/** URL query string for a state. Uses the API's own parameter names so links read the same. */
export function stateToParams(state: SearchState): URLSearchParams {
  const params = new URLSearchParams();
  if (!state.started) return params;
  const { classification, weekFrom, weekTo, title, keywords } = state.filters;
  if (state.query) params.set("q", state.query);
  if (classification) params.set("classification", classification);
  if (weekFrom) params.set("week_from", weekFrom);
  if (weekTo) params.set("week_to", weekTo);
  if (title) params.set("title", title);
  if (keywords) params.set("keywords", keywords);
  if (state.limit !== PAGE_SIZE) params.set("limit", String(state.limit));
  if ([...params.keys()].length === 0) params.set("browse", "1"); // browse mode with nothing else set
  return params;
}

export function parseParams(params: URLSearchParams): SearchState {
  const filters = cleanFilters({
    classification: params.get("classification") ?? undefined,
    weekFrom: params.get("week_from") ?? undefined,
    weekTo: params.get("week_to") ?? undefined,
    title: params.get("title") ?? undefined,
    keywords: params.get("keywords") ?? undefined,
  });
  const query = (params.get("q") ?? "").trim();
  const requested = Number.parseInt(params.get("limit") ?? "", 10);
  const limit = Number.isFinite(requested) ? Math.min(MAX_LIMIT, Math.max(1, requested)) : PAGE_SIZE;
  const started =
    query !== "" || Object.keys(filters).length > 0 || params.has("q") || params.has("browse") || params.has("limit");
  return started ? { started, query, filters, limit } : LANDING;
}

/** Two states are the same search exactly when they serialize the same. */
export function stateKey(state: SearchState): string {
  return stateToParams(state).toString();
}

export function toApiParams(state: SearchState): SearchParams {
  const { classification, weekFrom, weekTo, title, keywords } = state.filters;
  return {
    q: state.query,
    classification,
    week_from: weekFrom,
    week_to: weekTo,
    title,
    keywords,
    limit: state.limit,
  };
}

// --- chips --------------------------------------------------------------------------------

export interface Chip {
  key: FilterKey;
  label: string;
}

export function weekLabel(from: string | undefined, to: string | undefined): string {
  if (from && to) return from === to ? `Week of ${formatDay(from)}` : formatRange(from, to);
  if (from) return `From ${formatDay(from)}`;
  if (to) return `Until ${formatDay(to)}`;
  return "All weeks";
}

export function filterChips(filters: Filters): Chip[] {
  const chips: Chip[] = [];
  if (filters.classification) chips.push({ key: "classification", label: `Class ${filters.classification}` });
  if (filters.weekFrom || filters.weekTo) chips.push({ key: "weeks", label: weekLabel(filters.weekFrom, filters.weekTo) });
  if (filters.keywords) chips.push({ key: "keywords", label: `Words: ${filters.keywords}` });
  if (filters.title) chips.push({ key: "title", label: `Title: ${filters.title}` });
  return chips;
}
