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
import { createContext, Fragment, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type AnimationEvent, type ReactNode } from "react";

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
  leaving,
  children,
}: {
  kind?: AppearKind;
  as?: "div" | "span" | "p" | "li";
  className?: string;
  /** In a `useLeaving` list: this one is on its way out. */
  leaving?: boolean;
  children: ReactNode;
}) {
  const appear = useAppear(kind);
  return (
    <Tag className={className} {...appear} {...leaveProps(leaving)}>
      {children}
    </Tag>
  );
}

/** How long a leaving row stays drawn: --motion-duration-exit (160 ms) plus a frame of slack. */
export const LEAVE_MS = 200;

export interface Present<T> {
  item: T;
  /** Gone from the data: drawn a moment longer while it eases out, never tappable or announced. */
  leaving: boolean;
}

interface Leaving<T> {
  key: string;
  item: T;
  index: number;
}

/**
 * A list whose removed entries ease out instead of vanishing (rows used up, removed, ticked off,
 * moved to another group). Returns the current items plus, for a moment, the ones that just left,
 * at the place they were. Spread `leaveProps(leaving)` on each row.
 * The gone row is found in a layout effect, so the frame without it is never painted.
 */
export function useLeaving<T>(items: readonly T[], keyOf: (item: T) => string, ms = LEAVE_MS): Present<T>[] {
  const last = useRef<readonly T[]>(items);
  const [leaving, setLeaving] = useState<Leaving<T>[]>([]);
  useLayoutEffect(() => {
    const prev = last.current;
    last.current = items;
    if (prev === items) return;
    const keys = new Set(items.map(keyOf));
    const gone: Leaving<T>[] = [];
    prev.forEach((item, index) => {
      const key = keyOf(item);
      if (!keys.has(key)) gone.push({ key, item, index });
    });
    setLeaving((l) => {
      // Back again (Undo) → not leaving; a fresh removal replaces an older one with the same key.
      const kept = l.filter((x) => !keys.has(x.key) && !gone.some((g) => g.key === x.key));
      if (gone.length === 0 && kept.length === l.length) return l;
      return [...kept, ...gone];
    });
  }, [items, keyOf]);
  useEffect(() => {
    if (leaving.length === 0) return;
    const batch = leaving;
    const timer = setTimeout(() => setLeaving((l) => l.filter((x) => !batch.includes(x))), ms);
    return () => clearTimeout(timer);
  }, [leaving, ms]);

  const out: Present<T>[] = items.map((item) => ({ item, leaving: false }));
  for (const l of [...leaving].sort((a, b) => a.index - b.index)) {
    out.splice(Math.min(l.index, out.length), 0, { item: l.item, leaving: true });
  }
  return out;
}

/** On a leaving row: eases out (globals.css [data-leave]); inert and hidden from assistive tech. */
export function leaveProps(leaving: boolean | undefined): { "data-leave"?: ""; inert?: boolean; "aria-hidden"?: true } {
  return leaving ? { "data-leave": "", inert: true, "aria-hidden": true } : {};
}

/** `useLeaving` as a component, for lists rendered inside a map (one hook per list). */
export function LeavingList<T>({
  items,
  keyOf,
  children,
}: {
  items: readonly T[];
  /** Stable (module-level), so the list isn't re-checked on every render. */
  keyOf: (item: T) => string;
  children: (item: T, leaving: boolean) => ReactNode;
}) {
  const present = useLeaving(items, keyOf);
  return present.map((p) => <Fragment key={keyOf(p.item)}>{children(p.item, p.leaving)}</Fragment>);
}
