/**
 * Showing, ordering and focusing widgets: one pure reducer plus one pure selector
 * (frontend.md §2, ux.md §2). Rules:
 * - the focused widget moves to the top only right after YOUR message;
 * - phone expands only the focused widget; desktop expands all (each still collapsible);
 * - the other person's changes never reorder or move focus;
 * - `session` widgets can be closed; `lasting` ones stay.
 */
import type { ChangeRef } from "@/contracts/apply-result";
import type { KitchenState } from "@/contracts/kitchen-state";
import type { Layout, WidgetDef } from "./types";

export interface WorkspaceState {
  /** Widget IDs moved to the top by your turns, most recent first. */
  order: string[];
  focused: string | null;
  /** Explicit expand/collapse choices since the last turn. */
  toggled: Record<string, boolean>;
  closed: string[];
  /** Widgets also changed by your last turn, but not focused: they get an "Updated" dot. */
  updated: string[];
}

export const initialWorkspace: WorkspaceState = { order: [], focused: null, toggled: {}, closed: [], updated: [] };

export type WorkspaceEvent =
  /** Your turn saved changes; `focus` = widget IDs wanting focus, in receipt order. */
  | { type: "turnApplied"; focus: string[] }
  | { type: "remoteChange" }
  | { type: "userToggled"; id: string; expanded: boolean }
  | { type: "userClosed"; id: string }
  | { type: "messageSent" };

export function workspaceReducer(state: WorkspaceState, event: WorkspaceEvent): WorkspaceState {
  switch (event.type) {
    case "turnApplied": {
      const [first, ...rest] = event.focus;
      if (!first) return state;
      return {
        order: [first, ...state.order.filter((id) => id !== first)],
        focused: first,
        toggled: {},
        closed: state.closed.filter((id) => !event.focus.includes(id)),
        updated: rest.filter((id) => id !== first),
      };
    }
    case "remoteChange":
      return state; // never reorder, refocus or expand for someone else's change
    case "userToggled":
      return { ...state, toggled: { ...state.toggled, [event.id]: event.expanded } };
    case "userClosed":
      return { ...state, closed: [...new Set([...state.closed, event.id])], focused: state.focused === event.id ? null : state.focused };
    case "messageSent":
      return state.updated.length ? { ...state, updated: [] } : state;
  }
}

/** Widget IDs that want focus for these saved changes, in receipt order, without repeats. */
export function focusFor(registry: readonly WidgetDef[], refs: readonly ChangeRef[]): string[] {
  const out: string[] = [];
  for (const ref of refs) {
    const w = registry.find((def) => def.wantsFocus(ref));
    if (w && !out.includes(w.id)) out.push(w.id);
  }
  return out;
}

export interface VisibleWidget {
  def: WidgetDef;
  expanded: boolean;
  updated: boolean;
}

export function selectWidgets(
  state: WorkspaceState,
  ctx: { registry: readonly WidgetDef[]; data: KitchenState | null; layout: Layout },
): VisibleWidget[] {
  const present = ctx.registry.filter(
    (w) => !(w.lifetime === "session" && state.closed.includes(w.id)) && w.isPresent(ctx.data),
  );
  const rank = (id: string) => {
    const i = state.order.indexOf(id);
    return i === -1 ? state.order.length + ctx.registry.findIndex((w) => w.id === id) : i;
  };
  const ordered = [...present].sort((a, b) => rank(a.id) - rank(b.id));
  // On a phone only one widget is open: the focused one, else the first.
  const phoneOpen = ordered.some((w) => w.id === state.focused) ? state.focused : ordered[0]?.id;
  return ordered.map((def) => ({
    def,
    expanded: state.toggled[def.id] ?? (ctx.layout === "desktop" || def.id === phoneOpen),
    updated: state.updated.includes(def.id),
  }));
}
