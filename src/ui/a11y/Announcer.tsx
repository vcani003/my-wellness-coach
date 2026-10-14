"use client";
/**
 * The app's ONE polite live region (frontend.md §6): it speaks once per turn (reply + receipt
 * summary) and at most once per sync for the other person's changes, without moving focus.
 * Everything else that updates (the chat log, widgets) stays silent.
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

const AnnounceContext = createContext<(text: string) => void>(() => {});

export function useAnnounce() {
  return useContext(AnnounceContext);
}

export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const announce = useCallback((text: string) => {
    // Clear first so the same words can be announced twice in a row.
    setMessage("");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(text), 50);
  }, []);
  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="announcer">
        {message}
      </div>
    </AnnounceContext.Provider>
  );
}
