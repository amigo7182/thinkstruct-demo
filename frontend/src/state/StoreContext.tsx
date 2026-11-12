import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { SearchStore, Snapshot } from "./store";

const StoreContext = createContext<SearchStore | null>(null);

export function StoreProvider({ store, children }: { store: SearchStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): SearchStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside <StoreProvider>");
  return store;
}

export function useSnapshot(): Snapshot {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
