"use client";
/**
 * Things that arrive ease in instead of popping (0059 PF16; frontend.md §6a).
 *
 * `<AppearScope>` wraps a part of the screen (the conversation, a place). Whatever mounts inside it
 * AFTER the scope's first render, a new message, a receipt, a row someone just added, carries
 * `data-appear` for one entrance animation (globals.css), then drops it. What was already there
 * when the scope opened (saved chat, a place's rows on arrival) just shows: the place itself has its
 * own entrance. Outside any scope nothing animates.
 *
 * Only opacity and transform move ("grow" also eases the height where the browser can animate to
 * `auto`), so nothing is delayed for screen readers: the content is in the page from the start.
 * Reduced motion: a fade only.
 */
import { createContext, useCallback, useContext, useEffect, useState, type AnimationEvent, type ReactNode } from "react";

/** rise: fade + a small lift (messages, cards). fade: opacity only (status lines). grow: rows in a list. */
export type AppearKind = "rise" | "fade" | "grow";

/** Whether a scope has had its first render; flipped once, after that render commits. */
class ScopeState {
  ready = false;
  set(ready: boolean) {
    this.ready = ready;
  }
}

const AppearContext = createContext<ScopeState | null>(null);

export function AppearScope({ children }: { children: ReactNode }) {
  // One object for the scope's life; children that mount after the first commit see `ready`.
  const [scope] = useState(() => new ScopeState());
  useEffect(() => {
    scope.set(true);
    return () => scope.set(false);
  }, [scope]);
  return <AppearContext.Provider value={scope}>{children}</AppearContext.Provider>;
}

export interface AppearProps {
  "data-appear"?: AppearKind;
  onAnimationEnd?: (e: AnimationEvent<HTMLElement>) => void;
}

/**
 * Spread onto the element that should ease in. `enabled: false` (e.g. a message redrawn from saved
 * chat) never animates.
 */
export function useAppear(kind: AppearKind = "rise", enabled = true): AppearProps {
  const scope = useContext(AppearContext);
  const [on, setOn] = useState(() => enabled && Boolean(scope?.ready));
  const done = useCallback((e: AnimationEvent<HTMLElement>) => {
    // Only this element's own entrance: children (Lumi's hop) bubble their animations up too.
    if (e.target === e.currentTarget) setOn(false);
  }, []);
  return on ? { "data-appear": kind, onAnimationEnd: done } : {};
}

/** The same, as a wrapper element, for a block that has no single element of its own. */
export function Appear({
  kind = "rise",
  as: Tag = "div",
  className,
  children,
}: {
  kind?: AppearKind;
  as?: "div" | "span" | "p" | "li";
  className?: string;
  children: ReactNode;
}) {
  const appear = useAppear(kind);
  return (
    <Tag className={className} {...appear}>
      {children}
    </Tag>
  );
}
