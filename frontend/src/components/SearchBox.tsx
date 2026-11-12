import { useId, useState } from "react";

export const SEARCH_INPUT_ID = "search-input";
export const PLACEHOLDER = "bicycle spoke made by injection molding";

interface Props {
  query: string;
  onSubmit: (query: string) => void;
  variant: "hero" | "compact";
  autoFocus?: boolean;
}

/** Typing only edits a draft; Enter submits it and Esc clears it. */
export function SearchBox({ query, onSubmit, variant, autoFocus }: Props) {
  const [draft, setDraft] = useState(query);
  const [shown, setShown] = useState(query);
  if (query !== shown) {
    // The query changed from outside (back/forward, a saved search): show it.
    setShown(query);
    setDraft(query);
  }
  const hintId = useId();

  return (
    <form
      role="search"
      className={`search search--${variant}`}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft);
      }}
    >
      <label htmlFor={SEARCH_INPUT_ID} className="visually-hidden">
        Describe the invention
      </label>
      <input
        id={SEARCH_INPUT_ID}
        type="search"
        value={draft}
        placeholder={PLACEHOLDER}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        autoFocus={autoFocus}
        aria-describedby={hintId}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft("");
          }
        }}
      />
      <span className="search-hints" aria-hidden="true">
        <kbd>↵</kbd> search · <kbd>esc</kbd> clear
      </span>
      <span id={hintId} className="visually-hidden">
        Press Enter to search and Escape to clear.
      </span>
    </form>
  );
}
