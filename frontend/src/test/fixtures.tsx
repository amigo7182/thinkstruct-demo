import { act, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import type { AppliedFilters, ClassificationNode, Result, SearchResponse, WeekCount } from "../api/types";
import { App } from "../App";
import { SearchStore } from "../state/store";

/** The sample's 64 publication weeks: Thursdays from 2024-02-15 to 2025-05-01. */
export const WEEKS: string[] = Array.from({ length: 64 }, (_, i) =>
  new Date(Date.UTC(2024, 1, 15 + 7 * i)).toISOString().slice(0, 10),
);

export const NO_FILTERS: AppliedFilters = { classification: null, week_from: null, week_to: null, title: null, keywords: null };

export function weeks(counts: Record<string, number> = {}, fallback = 0): WeekCount[] {
  return WEEKS.map((week) => ({ week, count: counts[week] ?? fallback }));
}

export function node(code: string, count: number, children: ClassificationNode[] = []): ClassificationNode {
  return { code, count, children };
}

export function result(doc: string, title: string, overrides: Partial<Result> = {}): Result {
  return {
    doc_number: doc,
    title,
    title_spans: [],
    classification: "B60B2700FI",
    classification_levels: ["B", "B60", "B60B", "B60B 27"],
    week: WEEKS[0],
    score: 0.5,
    match: { kind: "claim", number: 1, text: `Passage of ${title}`, spans: [] },
    ...overrides,
  };
}

export function response(overrides: Partial<SearchResponse> = {}): SearchResponse {
  return {
    request_id: null,
    query: "spoke",
    filters: NO_FILTERS,
    total: 1,
    result_set_size: 100,
    results: [],
    facets: { classification: [], weeks: weeks() },
    timing_ms: { total: 1 },
    ...overrides,
  };
}

export interface Call {
  params: URLSearchParams;
  signal: AbortSignal;
  id: number;
  /** Answer this request (request_id is filled in), then let React render and paint. */
  respond: (body: Partial<SearchResponse>) => Promise<void>;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30)); // past rAF + a task

/**
 * Renders the app at `url` with a fetch that never answers by itself: each test resolves
 * requests when and in whatever order it likes. It ignores abort signals on purpose, so a
 * late answer to an old request really arrives and must be dropped by the id check.
 */
export function setup(url: string) {
  window.history.replaceState(null, "", url);
  const calls: Call[] = [];
  const fetchMock = vi.fn(
    (input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        const params = new URL(String(input)).searchParams;
        const id = Number(params.get("request_id"));
        calls.push({
          params,
          signal: init!.signal!,
          id,
          respond: async (body) => {
            const json = response({ ...body, request_id: body.request_id ?? id }); // echoed, like the backend
            await act(async () => {
              resolve({ ok: true, status: 200, json: async () => json } as Response);
              await settle();
            });
          },
        });
      }),
  );
  const store = new SearchStore({ fetch: fetchMock as unknown as typeof fetch, apiBase: "http://api.test" });
  store.start();
  const view = render(<App store={store} />);
  return { store, calls, fetchMock, view };
}

/** The filter and query parameters of a request (not limit, request_id or delay_ms). */
export function filterParams(call: Call): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of call.params) if (!["limit", "request_id", "delay_ms"].includes(key)) out[key] = value;
  return out;
}

export function classButton(code: string) {
  return screen.getByRole("button", { name: new RegExp(`^${code}: \\d+ patents?$`) });
}

/** Every text the page has shown since this was called. */
export function watchText(): () => string {
  const seen = [document.body.textContent ?? ""];
  const observer = new MutationObserver(() => seen.push(document.body.textContent ?? ""));
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  return () => {
    observer.disconnect();
    return seen.join("\n");
  };
}

/** A query response: B › B60 › {B60B 77 › B60B 27 14, B60C 23}, one patent a week. */
export const INITIAL = response({
  total: 100,
  facets: {
    classification: [node("B", 100, [node("B60", 100, [node("B60B", 77, [node("B60B 27", 14)]), node("B60C", 23)])])],
    weeks: weeks({}, 1),
  },
  results: [result("20240000001", "Initial spoke wheel")],
});
