import { DebugPanel } from "./components/DebugPanel";
import { GlassToggle } from "./components/GlassToggle";
import { Landing } from "./components/Landing";
import { SavedSearchesMenu } from "./components/SavedSearches";
import { Workspace } from "./components/Workspace";
import { useTheme } from "./lib/hooks";
import type { SearchStore } from "./state/store";
import { StoreProvider, useSnapshot, useStore } from "./state/StoreContext";

function Shell() {
  const store = useStore();
  const { state, debug } = useSnapshot();
  const { theme, setTheme } = useTheme();

  return (
    <div className="app">
      <header className="topbar">
        {state.started && (
          <button type="button" className="wordmark" onClick={store.goHome}>
            patent search
          </button>
        )}
        <div className="topbar-actions">
          <SavedSearchesMenu />
          <GlassToggle theme={theme} onChange={setTheme} />
        </div>
      </header>
      {state.started ? <Workspace theme={theme} /> : <Landing theme={theme} />}
      {debug.enabled && <DebugPanel />}
    </div>
  );
}

export function App({ store }: { store: SearchStore }) {
  return (
    <StoreProvider store={store}>
      <Shell />
    </StoreProvider>
  );
}
