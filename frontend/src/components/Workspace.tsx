import { useCallback, useEffect, useState } from "react";
import type { SearchResponse } from "../api/types";
import { formatMs, resultSummary } from "../lib/format";
import type { Theme } from "../lib/hooks";
import { normalizeClassification } from "../state/search";
import type { SearchStore } from "../state/store";
import { useSnapshot, useStore } from "../state/StoreContext";
import { ClassificationView } from "./ClassificationView";
import { FilterChips } from "./FilterChips";
import { NoResults } from "./NoResults";
import { ResultsList } from "./ResultsList";
import { SaveSearch } from "./SavedSearches";
import { SearchBox } from "./SearchBox";
import { Timeline } from "./Timeline";

/**
 * Latency: the store noted performance.now() when the change was triggered. After the
 * response that answers it has rendered (this effect), wait for the next frame and then a
 * task, so the browser has painted, and report back.
 */
function useLatencyProbe(store: SearchStore, response: SearchResponse | null, requestId: number | null) {
  useEffect(() => {
    if (!response || requestId === null) return;
    const record = response.total > 0; // the no-results state animates sharks; leave it out
    let timer = 0;
    const frame = requestAnimationFrame(() => {
      timer = window.setTimeout(() => store.completeMeasurement(requestId, record), 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [store, response, requestId]);
}

function KeywordFilter({ onSubmit }: { onSubmit: (keywords: string) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <form
      className="keyword-filter"
      onSubmit={(event) => {
        event.preventDefault();
        if (!draft.trim()) return;
        onSubmit(draft);
        setDraft("");
      }}
    >
      <label htmlFor="keyword-filter" className="visually-hidden">
        Only patents whose title or abstract contains these words
      </label>
      <input
        id="keyword-filter"
        className="small-input"
        value={draft}
        placeholder="Must include words"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setDraft("");
        }}
      />
    </form>
  );
}

export function Workspace({ theme }: { theme: Theme }) {
  const store = useStore();
  const { state, response, responseId, pending, error, latency } = useSnapshot();
  useLatencyProbe(store, response, responseId);

  const onFilterClass = useCallback((code: string | null) => store.setFilters({ classification: code ?? undefined }), [store]);
  const onSelectWeeks = useCallback(
    (from: string | undefined, to: string | undefined) => store.setFilters({ weekFrom: from, weekTo: to }),
    [store],
  );
  const onFilterWeek = useCallback((week: string) => store.setFilters({ weekFrom: week, weekTo: week }), [store]);

  const noResults = response !== null && response.total === 0;

  return (
    <main className="workspace">
      <h1 className="visually-hidden">Patent search</h1>
      <div className="toolbar">
        <SearchBox query={state.query} variant="compact" onSubmit={store.submitQuery} />
        <div className="summary">
          <p className="count" aria-live="polite" aria-atomic="true">
            {response ? resultSummary(response.total, response.result_set_size) : "Searching…"}
          </p>
          {pending && response && (
            <span className="updating">
              <span className="updating-dot" aria-hidden="true" />
              Updating
            </span>
          )}
          {!pending && !noResults && latency.last !== null && (
            <span className="latency">updated in {formatMs(latency.last)}</span>
          )}
          <SaveSearch state={state} />
        </div>
        {!noResults && (
          <div className="filter-row">
            <FilterChips filters={state.filters} onRemove={store.removeFilter} onClear={store.clearFilters} />
            <KeywordFilter onSubmit={(keywords) => store.setFilters({ keywords })} />
          </div>
        )}
      </div>

      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
          <button type="button" className="button" onClick={store.retry}>
            Try again
          </button>
        </div>
      )}

      {response === null ? (
        !error && <p className="loading muted">Loading results…</p>
      ) : noResults ? (
        <NoResults
          theme={theme}
          filters={state.filters}
          pending={pending}
          onRemove={store.removeFilter}
          onClear={store.clearFilters}
        />
      ) : (
        <div className="views" data-pending={pending} aria-busy={pending}>
          <ClassificationView
            nodes={response.facets.classification}
            selected={normalizeClassification(response.filters.classification) ?? null}
            onSelect={onFilterClass}
          />
          <div className="views-main">
            <Timeline
              weeks={response.facets.weeks}
              from={response.filters.week_from}
              to={response.filters.week_to}
              onSelect={onSelectWeeks}
            />
            <ResultsList
              results={response.results}
              total={response.total}
              limit={state.limit}
              onShowMore={store.showMore}
              onFilterClass={onFilterClass}
              onFilterWeek={onFilterWeek}
            />
          </div>
        </div>
      )}
    </main>
  );
}
