import type { Theme } from "../lib/hooks";
import type { FilterKey, Filters } from "../state/search";
import { FilterChips } from "./FilterChips";
import { Sharks } from "./Sharks";

interface Props {
  theme: Theme;
  filters: Filters;
  pending: boolean;
  onRemove: (key: FilterKey) => void;
  onClear: () => void;
}

export function NoResults({ theme, filters, pending, onRemove, onClear }: Props) {
  return (
    <section className="no-results" data-pending={pending} aria-busy={pending}>
      <Sharks theme={theme} />
      <div className="no-results-content">
        <h2 className="no-results-title">No patents in this part of the sea.</h2>
        <FilterChips filters={filters} onRemove={onRemove} onClear={onClear} />
        <p className="muted">Remove a filter to widen the results.</p>
      </div>
    </section>
  );
}
