/**
 * Keeps the kitchen on screen up to date (backend-data.md §6, frontend.md §3). Framework-free so
 * it can be unit-tested; `useKitchenSync` wires it to React and the browser.
 *
 * - Your own changes arrive in the ApplyResult (`applyOwn`), so they show immediately.
 * - The other person's changes are found by polling `/version`: every 15 s while visible, every
 *   60 s after 5 idle minutes, immediately on return, paused while hidden. A higher version
 *   reloads the state.
 * Swapping polling for live updates later only changes this file and the hook.
 */
import type { ChangeSetSummary } from "@/contracts/apply-result";
import { KitchenState } from "@/contracts/kitchen-state";
import { parseChanges } from "./shared-cues";

export const POLL_ACTIVE_MS = 15_000;
export const POLL_IDLE_MS = 60_000;
export const IDLE_AFTER_MS = 5 * 60_000;

/** How long until the next version check; null = paused (tab hidden). */
export function pollDelay({ hidden, idleMs }: { hidden: boolean; idleMs: number }): number | null {
  if (hidden) return null;
  return idleMs >= IDLE_AFTER_MS ? POLL_IDLE_MS : POLL_ACTIVE_MS;
}

export interface RemoteChange {
  /** Item and shopping-list IDs added or changed by someone else. */
  ids: string[];
  /** Their display names (for "Levi updated the kitchen"). */
  actorNames: string[];
  /**
   * Kitchen items that were on screen and are gone now (used up or removed). The state can't say
   * who did it, so the live cue asks `/changes` (ux.md §6). Your own removals arrive through
   * `applyOwn`, never here.
   */
  removedIds: string[];
  /** The versions on screen before and after this sync. */
  fromVersion: number;
  toVersion: number;
}

/** What changed between two states that wasn't done by `meId`. */
export function diffRemote(prev: KitchenState | null, next: KitchenState, meId: string): RemoteChange {
  const before = new Map([...(prev?.items ?? []), ...(prev?.shoppingList ?? [])].map((i) => [i.id, i.updatedAt]));
  const ids: string[] = [];
  const names = new Set<string>();
  for (const item of [...next.items, ...next.shoppingList]) {
    if (before.get(item.id) === item.updatedAt) continue;
    if ("missing" in item.updatedBy) {
      ids.push(item.id);
      continue;
    }
    if (item.updatedBy.id === meId) continue;
    ids.push(item.id);
    names.add(item.updatedBy.name);
  }
  const still = new Set(next.items.map((i) => i.id));
  const removedIds = (prev?.items ?? []).filter((i) => !still.has(i.id)).map((i) => i.id);
  return { ids, actorNames: [...names], removedIds, fromVersion: prev?.version ?? 0, toVersion: next.version };
}

export type SyncStatus = "loading" | "ok" | "stale" | "error";

export interface SyncSnapshot {
  state: KitchenState | null;
  status: SyncStatus;
  /** When the state on screen was last confirmed current (ms since epoch). */
  syncedAt: number | null;
}

export interface KitchenSyncOptions {
  kitchenId: string;
  meId: string;
  initial: KitchenState | null;
  fetchJson?: (url: string) => Promise<unknown>;
  now?: () => number;
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
  return res.json();
}

export function createKitchenSync(opts: KitchenSyncOptions) {
  const fetchJson = opts.fetchJson ?? defaultFetchJson;
  const now = opts.now ?? Date.now;
  const base = `/api/kitchens/${encodeURIComponent(opts.kitchenId)}`;
  let snap: SyncSnapshot = {
    state: opts.initial,
    status: opts.initial ? "ok" : "loading",
    syncedAt: opts.initial ? now() : null,
  };
  const listeners = new Set<() => void>();
  const remoteListeners = new Set<(change: RemoteChange) => void>();
  let inflight: Promise<void> | null = null;

  const set = (next: Partial<SyncSnapshot>) => {
    snap = { ...snap, ...next };
    for (const l of listeners) l();
  };
  const failed = () => set({ status: snap.state ? "stale" : "error" });

  const accept = (raw: unknown, remote: boolean) => {
    const parsed = KitchenState.safeParse(raw);
    if (!parsed.success) {
      console.error("kitchen.sync: state failed its schema; keeping what's on screen");
      failed();
      return;
    }
    const next = parsed.data;
    if (snap.state && next.version < snap.state.version) return; // older than what we show
    const change = remote ? diffRemote(snap.state, next, opts.meId) : null;
    set({ state: next, status: "ok", syncedAt: now() });
    if (change && (change.ids.length || change.removedIds.length)) for (const l of remoteListeners) l(change);
  };

  const run = (task: () => Promise<void>) => {
    inflight ??= task().finally(() => {
      inflight = null;
    });
    return inflight;
  };

  return {
    getSnapshot: () => snap,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Called when someone else's changes arrive (at most once per sync). */
    onRemoteChange(listener: (change: RemoteChange) => void) {
      remoteListeners.add(listener);
      return () => void remoteListeners.delete(listener);
    },
    /** Your own saved change: show it now, and don't refetch it on the next poll. */
    applyOwn(state: KitchenState) {
      accept(state, false);
    },
    /** Reload the full state (first load, Retry). */
    refresh() {
      if (!snap.state) set({ status: "loading" });
      return run(async () => {
        try {
          accept(await fetchJson(`${base}/state`), Boolean(snap.state));
        } catch {
          failed();
        }
      });
    },
    /** One poll: cheap version check, full reload only if it moved. */
    check() {
      return run(async () => {
        try {
          const { version } = (await fetchJson(`${base}/version`)) as { version: number };
          if (snap.state && version <= snap.state.version) {
            set({ status: "ok", syncedAt: now() });
            return;
          }
          accept(await fetchJson(`${base}/state`), Boolean(snap.state));
        } catch {
          failed();
        }
      });
    },
    /** Change-set summaries after `since` (`/changes`), or null if that failed (0018). */
    async changesSince(since: number): Promise<ChangeSetSummary[] | null> {
      try {
        return parseChanges(await fetchJson(`${base}/changes?since=${encodeURIComponent(String(since))}`));
      } catch {
        return null;
      }
    },
    markOffline() {
      if (snap.state) set({ status: "stale" });
    },
  };
}

export type KitchenSync = ReturnType<typeof createKitchenSync>;
