import { useEffect, useId, useRef, useState } from "react";
import { filterChips, type SearchState } from "../state/search";
import { savedSearches, useSavedSearches, type SavedSearch } from "../state/saved";
import { useStore } from "../state/StoreContext";

function describe(saved: Pick<SavedSearch, "query" | "filters">): string {
  const parts = [saved.query ? `“${saved.query}”` : "All patents", ...filterChips(saved.filters).map((c) => c.label)];
  return parts.join(" · ");
}

/** "Save this search": names the current {query, filters} and stores it. */
export function SaveSearch({ state }: { state: SearchState }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const inputId = useId();

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 2500);
    return () => window.clearTimeout(timer);
  }, [message]);

  return (
    <div className="save-search">
      {open ? (
        <form
          className="save-form"
          onSubmit={(event) => {
            event.preventDefault();
            const stored = savedSearches.add(name, state.query, state.filters);
            setOpen(false);
            setMessage(stored ? "Saved" : "Saved for this visit only (browser storage is unavailable)");
          }}
        >
          <label htmlFor={inputId} className="visually-hidden">
            Name for this search
          </label>
          <input
            id={inputId}
            className="small-input"
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
            }}
          />
          <button type="submit" className="button">
            Save
          </button>
          <button type="button" className="text-button" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setName(state.query || "All patents");
            setOpen(true);
          }}
        >
          Save this search
        </button>
      )}
      <span role="status" className="muted">
        {message}
      </span>
    </div>
  );
}

/** A small list in the header that restores any saved search. */
export function SavedSearchesMenu() {
  const store = useStore();
  const saved = useSavedSearches();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="saved" ref={root}>
      <button
        type="button"
        className="text-button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        Saved searches{saved.length > 0 && <span className="mono"> {saved.length}</span>}
      </button>
      {open && (
        <div id={panelId} className="saved-panel">
          {saved.length === 0 ? (
            <p className="muted">Nothing saved yet. Use “Save this search” after searching.</p>
          ) : (
            <ul className="saved-list">
              {saved.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="saved-restore"
                    onClick={() => {
                      setOpen(false);
                      store.restore(item.query, item.filters);
                    }}
                  >
                    <span className="saved-name">{item.name}</span>
                    <span className="saved-summary muted">{describe(item)}</span>
                  </button>
                  <button
                    type="button"
                    className="saved-remove"
                    aria-label={`Remove saved search ${item.name}`}
                    onClick={() => savedSearches.remove(item.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
