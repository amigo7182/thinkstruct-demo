import { useEffect, useRef } from "react";
import { filterChips, type FilterKey, type Filters } from "../state/search";
import { SEARCH_INPUT_ID } from "./SearchBox";

interface Props {
  filters: Filters;
  onRemove: (key: FilterKey) => void;
  onClear: () => void;
}

/** One chip per active filter; removing one keeps the others. Focus moves to a neighbour. */
export function FilterChips({ filters, onRemove, onClear }: Props) {
  const chips = filterChips(filters);
  const buttons = useRef(new Map<FilterKey, HTMLButtonElement>());
  const focusNext = useRef<FilterKey | "search" | null>(null);

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    if (target === "search") document.getElementById(SEARCH_INPUT_ID)?.focus();
    else buttons.current.get(target)?.focus();
  });

  if (chips.length === 0) return null;

  return (
    <div className="chips" role="group" aria-label="Active filters">
      {chips.map((chip, index) => (
        <button
          key={chip.key}
          ref={(el) => {
            if (el) buttons.current.set(chip.key, el);
            else buttons.current.delete(chip.key);
          }}
          type="button"
          className="chip"
          aria-label={`Remove filter: ${chip.label}`}
          onClick={() => {
            const neighbour = chips[index + 1] ?? chips[index - 1];
            focusNext.current = neighbour ? neighbour.key : "search";
            onRemove(chip.key);
          }}
        >
          <span>{chip.label}</span>
          <span className="chip-x" aria-hidden="true">
            ×
          </span>
        </button>
      ))}
      <button
        type="button"
        className="text-button"
        onClick={() => {
          focusNext.current = "search";
          onClear();
        }}
      >
        Clear all
      </button>
    </div>
  );
}
