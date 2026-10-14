"use client";
/**
 * See all's "By place | By type" choice (CAT1 Rec), remembered per device. Best effort: with
 * private mode or blocked storage it lasts until the page reloads, and By place is the default
 * (0018). The server always renders By place; the stored choice applies once the page is live.
 */
import { useCallback, useSyncExternalStore } from "react";

export type KitchenView = "place" | "type";
export const KITCHEN_VIEW_KEY = "kitchen.seeAll.view";

let memory: KitchenView | null = null;
const listeners = new Set<() => void>();

function read(): KitchenView {
  try {
    const stored = window.localStorage.getItem(KITCHEN_VIEW_KEY);
    if (stored === "place" || stored === "type") return stored;
  } catch {
    // Storage blocked: fall through to this page's memory.
  }
  return memory ?? "place";
}

function write(view: KitchenView) {
  memory = view;
  try {
    window.localStorage.setItem(KITCHEN_VIEW_KEY, view);
  } catch {
    // Storage blocked: remembered for this page only.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KITCHEN_VIEW_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useKitchenView(): [KitchenView, (view: KitchenView) => void] {
  const view = useSyncExternalStore(subscribe, read, () => "place" as const);
  return [view, useCallback((next: KitchenView) => write(next), [])];
}

/** Tests only: forget the in-memory fallback. */
export function resetKitchenViewMemory() {
  memory = null;
}
