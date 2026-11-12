import type { Theme } from "../lib/hooks";
import { useStore } from "../state/StoreContext";
import { SearchBox } from "./SearchBox";
import { Sharks } from "./Sharks";

export const EXAMPLES = ["bicycle spoke made by injection molding", "tire tread with sipes", "trailer hitch coupling"];
const SAMPLE_SIZE = 640; // patents in the sample dataset (backend /health)

export function Landing({ theme }: { theme: Theme }) {
  const store = useStore();
  return (
    <main className="landing">
      <Sharks theme={theme} />
      <div className="landing-content">
        <h1 className="headline">describe the invention</h1>
        <SearchBox
          query=""
          variant="hero"
          autoFocus
          onSubmit={(query) => {
            if (query.trim()) store.submitQuery(query);
          }}
        />
        <div className="examples" role="group" aria-label="Example searches">
          {EXAMPLES.map((example) => (
            <button key={example} type="button" className="example" onClick={() => store.submitQuery(example)}>
              {example}
            </button>
          ))}
        </div>
        <a
          className="browse-link"
          href="?browse=1"
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return; // new tab etc.
            event.preventDefault();
            store.browseAll();
          }}
        >
          browse all {SAMPLE_SIZE} patents
        </a>
      </div>
    </main>
  );
}
