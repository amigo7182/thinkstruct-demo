// Saved searches: {name, query, filters} in localStorage. If storage is unavailable they
// still work for the current visit, and the UI says so.

import { useSyncExternalStore } from "react";
import { readJson, writeJson } from "../lib/storage";
import { cleanFilters, type Filters } from "./search";

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  filters: Filters;
  savedAt: string;
}

const KEY = "patent-search.saved.v1";
const MAX_SAVED = 30;

function isSavedSearch(value: unknown): value is SavedSearch {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.query === "string" &&
    typeof v.filters === "object" &&
    v.filters !== null &&
    typeof v.savedAt === "string"
  );
}

function load(): SavedSearch[] {
  const value = readJson(KEY);
  if (!Array.isArray(value)) return [];
  return value.filter(isSavedSearch).map((s) => ({ ...s, filters: cleanFilters(s.filters) }));
}

let items: SavedSearch[] = load();
let persisted = true;
const listeners = new Set<() => void>();

function emit(next: SavedSearch[]) {
  items = next;
  persisted = writeJson(KEY, items);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Keep tabs in sync.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    items = load();
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export const savedSearches = {
  /** Returns false when the browser refused to store it (it is still kept for this visit). */
  add(name: string, query: string, filters: Filters): boolean {
    const entry: SavedSearch = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim() || "Untitled search",
      query: query.trim(),
      filters: cleanFilters(filters),
      savedAt: new Date().toISOString(),
    };
    emit([entry, ...items.filter((s) => s.name !== entry.name)].slice(0, MAX_SAVED));
    return persisted;
  },
  remove(id: string) {
    emit(items.filter((s) => s.id !== id));
  },
  /** For tests: re-read storage. */
  reload() {
    items = load();
    for (const listener of listeners) listener();
  },
};

export function useSavedSearches(): SavedSearch[] {
  return useSyncExternalStore(subscribe, () => items);
}
