import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { readString, writeString } from "./storage";

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () =>
    typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false,
  );
}

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribeVisibility, () => document.visibilityState !== "hidden");
}

export type Theme = "light" | "dark";
const THEME_KEY = "patent-search.theme";

/** Follows prefers-color-scheme until the visitor picks one; the pick is remembered. */
export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void } {
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const [choice, setChoice] = useState<Theme | null>(() => {
    const saved = readString(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : null;
  });
  const theme: Theme = choice ?? (systemDark ? "dark" : "light");

  useEffect(() => {
    const root = document.documentElement;
    if (choice) root.dataset.theme = choice;
    else delete root.dataset.theme;
  }, [choice]);

  const setTheme = useCallback((next: Theme) => {
    setChoice(next);
    writeString(THEME_KEY, next);
  }, []);

  return { theme, setTheme };
}
