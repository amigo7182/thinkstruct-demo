// The one place that talks to the API. Every state change sends exactly one /search
// request; each request gets an increasing id and its own AbortController, and only the
// response to the latest id is ever applied. All views render from that one response.
//
// It lives outside React (read with useSyncExternalStore), so React StrictMode's double
// effects can't send duplicate requests.

import { API_BASE, fetchSearch, isAbortError } from "../api/client";
import type { SearchResponse } from "../api/types";
import {
  browseAll,
  LANDING,
  parseParams,
  restored,
  stateKey,
  stateToParams,
  toApiParams,
  withFilters,
  withMore,
  withoutFilter,
  withoutFilters,
  withQuery,
  type FilterKey,
  type Filters,
  type SearchState,
} from "./search";

export type ChangeKind = "query" | "filter" | "more" | "history" | "restore" | "retry";

export interface LatencySample {
  ms: number; // trigger -> response rendered and painted
  kind: ChangeKind;
  requestId: number;
  at: string; // ISO time
}

export interface DebugState {
  enabled: boolean; // ?debug=1
  delayMs: number; // passed to the API as delay_ms
  randomDelay: boolean; // each request waits a random 0..delayMs, so answers arrive out of order
  keepOlderRequests: boolean; // don't abort older requests, to show the id check alone keeps them out
  sent: number;
  applied: number;
  aborted: number;
  discarded: number; // answers to older requests that arrived anyway and were dropped
}

export interface Snapshot {
  state: SearchState;
  response: SearchResponse | null; // the latest applied response; kept (dimmed) while a newer one is pending
  responseId: number | null; // the request that response answers
  pending: boolean;
  error: string | null;
  latency: { last: number | null; samples: LatencySample[] };
  debug: DebugState;
}

export const MAX_SAMPLES = 100;

type HistoryMode = "push" | "replace";

export interface StoreOptions {
  fetch?: typeof fetch;
  apiBase?: string;
  now?: () => number;
}

export class SearchStore {
  private snapshot: Snapshot;
  private readonly listeners = new Set<() => void>();
  private readonly fetchImpl: typeof fetch;
  private readonly apiBase: string;
  private readonly now: () => number;
  private requestSeq = 0;
  private latestRequestId = 0; // 0 = no request should be applied (e.g. back on the landing page)
  private controller: AbortController | null = null;
  private measurement: { requestId: number; startedAt: number; kind: ChangeKind } | null = null;
  private running = false;

  constructor(options: StoreOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input, init) => window.fetch(input, init));
    this.apiBase = options.apiBase ?? API_BASE;
    this.now = options.now ?? (() => performance.now());
    const params = new URLSearchParams(window.location.search);
    this.snapshot = {
      state: parseParams(params),
      response: null,
      responseId: null,
      pending: false,
      error: null,
      latency: { last: null, samples: [] },
      debug: {
        enabled: params.get("debug") === "1",
        delayMs: 0,
        randomDelay: false,
        keepOlderRequests: false,
        sent: 0,
        applied: 0,
        aborted: 0,
        discarded: 0,
      },
    };
  }

  // --- useSyncExternalStore -------------------------------------------------------------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  private update(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private updateDebug(patch: Partial<DebugState>) {
    this.update({ debug: { ...this.snapshot.debug, ...patch } });
  }

  /** Start listening to back/forward and load the state the URL describes. */
  start() {
    if (this.running) return;
    this.running = true;
    window.addEventListener("popstate", this.onPopState);
    if (this.snapshot.state.started) this.request(null);
  }

  stop() {
    this.running = false;
    window.removeEventListener("popstate", this.onPopState);
    this.abortInFlight();
  }

  // --- user actions -------------------------------------------------------------------

  submitQuery = (query: string) => this.change(withQuery(this.snapshot.state, query), "query");
  setFilters = (patch: Partial<Filters>) => this.change(withFilters(this.snapshot.state, patch), "filter");
  removeFilter = (key: FilterKey) => this.change(withoutFilter(this.snapshot.state, key), "filter");
  clearFilters = () => this.change(withoutFilters(this.snapshot.state), "filter");
  showMore = () => this.change(withMore(this.snapshot.state), "more", "replace");
  browseAll = () => this.change(browseAll(), "query");
  restore = (query: string, filters: Filters) => this.change(restored(query, filters), "restore");
  goHome = () => this.change(LANDING, "query");
  retry = () => this.request("retry");

  setDelay = (delayMs: number) => this.updateDebug({ delayMs: Math.max(0, Math.min(5000, Math.round(delayMs))) });
  setRandomDelay = (randomDelay: boolean) => this.updateDebug({ randomDelay });
  setKeepOlderRequests = (keepOlderRequests: boolean) => this.updateDebug({ keepOlderRequests });

  private change(next: SearchState, kind: ChangeKind, history: HistoryMode = "push") {
    const startedAt = this.now(); // the moment the user triggered the change
    if (stateKey(next) === stateKey(this.snapshot.state)) return; // nothing changed, nothing to fetch
    this.update({ state: next });
    this.writeUrl(next, history);
    this.load(next, kind, startedAt);
  }

  private onPopState = () => {
    const startedAt = this.now();
    const next = parseParams(new URLSearchParams(window.location.search));
    if (stateKey(next) === stateKey(this.snapshot.state)) return;
    this.update({ state: next });
    this.load(next, "history", startedAt);
  };

  private load(state: SearchState, kind: ChangeKind, startedAt: number) {
    if (state.started) {
      this.request(kind, startedAt);
    } else {
      this.abortInFlight();
      this.latestRequestId = 0;
      this.measurement = null;
      this.update({ response: null, responseId: null, pending: false, error: null });
    }
  }

  private writeUrl(state: SearchState, mode: HistoryMode) {
    const params = stateToParams(state);
    if (this.snapshot.debug.enabled) params.set("debug", "1");
    const qs = params.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
    if (mode === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }

  private abortInFlight() {
    this.controller?.abort();
    this.controller = null;
  }

  // --- the request path -------------------------------------------------------------

  private request(kind: ChangeKind | null, startedAt = this.now()) {
    const id = ++this.requestSeq;
    this.latestRequestId = id;
    const { debug, state } = this.snapshot;
    if (!debug.keepOlderRequests) this.abortInFlight();
    const controller = new AbortController();
    this.controller = controller;
    this.measurement = kind ? { requestId: id, startedAt, kind } : null;

    const delay = debug.delayMs > 0 ? (debug.randomDelay ? Math.round(Math.random() * debug.delayMs) : debug.delayMs) : 0;
    this.update({ pending: true, error: null, debug: { ...debug, sent: debug.sent + 1 } });

    fetchSearch(this.fetchImpl, this.apiBase, { ...toApiParams(state), request_id: id, delay_ms: delay || undefined }, controller.signal)
      .then((response) => {
        // Only the answer to the newest request may be shown, however late or early it arrives.
        if (id !== this.latestRequestId || (response.request_id !== null && response.request_id !== id)) {
          this.updateDebug({ discarded: this.snapshot.debug.discarded + 1 });
          return;
        }
        if (this.controller === controller) this.controller = null;
        this.update({
          response,
          responseId: id,
          pending: false,
          error: null,
          debug: { ...this.snapshot.debug, applied: this.snapshot.debug.applied + 1 },
        });
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) {
          this.updateDebug({ aborted: this.snapshot.debug.aborted + 1 });
          return;
        }
        if (id !== this.latestRequestId) {
          this.updateDebug({ discarded: this.snapshot.debug.discarded + 1 });
          return;
        }
        if (this.measurement?.requestId === id) this.measurement = null;
        this.update({ pending: false, error: error instanceof Error ? error.message : String(error) });
      });
  }

  // --- latency ---------------------------------------------------------------------

  /**
   * Called once the response to `requestId` has rendered and the browser has painted it.
   * `record` is false when the sharks are animating, so they can't distort the numbers.
   */
  completeMeasurement(requestId: number, record: boolean) {
    const measurement = this.measurement;
    if (!measurement || measurement.requestId !== requestId) return;
    this.measurement = null;
    if (!record || this.snapshot.debug.delayMs > 0) {
      this.update({ latency: { ...this.snapshot.latency, last: null } });
      return;
    }
    const ms = this.now() - measurement.startedAt;
    const sample: LatencySample = {
      ms: Math.round(ms * 10) / 10,
      kind: measurement.kind,
      requestId,
      at: new Date().toISOString(),
    };
    this.update({ latency: { last: ms, samples: [...this.snapshot.latency.samples, sample].slice(-MAX_SAMPLES) } });
  }
}
