"use client";
import { useSyncExternalStore } from "react";

/** True once the browser confirms the query; false during server rendering. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** The ~900 px breakpoint from ux.md §1 (matches `--breakpoint-desk`). */
export const DESKTOP_QUERY = "(min-width: 56.25rem)";
