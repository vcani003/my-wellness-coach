"use client";
/**
 * React + browser wiring for the kitchen sync (backend-data.md §6): polls while visible, slows
 * down when idle, checks immediately on return or reconnect, pauses while hidden.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { KitchenState } from "@/contracts/kitchen-state";
import { createKitchenSync, pollDelay, type KitchenSync, type SyncSnapshot } from "./kitchen-sync";

export function useKitchenSync(opts: {
  kitchenId: string;
  meId: string;
  initial: KitchenState | null;
}): { sync: KitchenSync; snapshot: SyncSnapshot } {
  const [sync] = useState(() => createKitchenSync(opts));
  const snapshot = useSyncExternalStore(sync.subscribe, sync.getSnapshot, sync.getSnapshot);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastActivity = Date.now();

    const schedule = () => {
      clearTimeout(timer);
      const delay = pollDelay({ hidden: document.hidden, idleMs: Date.now() - lastActivity });
      if (delay !== null) timer = setTimeout(() => void sync.check().finally(schedule), delay);
    };
    const checkNow = () => void sync.check().finally(schedule);
    const onVisibility = () => (document.hidden ? clearTimeout(timer) : checkNow());
    const onActivity = () => {
      const wasIdle = pollDelay({ hidden: false, idleMs: Date.now() - lastActivity }) !== pollDelay({ hidden: false, idleMs: 0 });
      lastActivity = Date.now();
      if (wasIdle) checkNow();
    };
    const onOffline = () => sync.markOffline();

    if (!sync.getSnapshot().state) void sync.refresh().finally(schedule);
    else schedule();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", checkNow);
    window.addEventListener("offline", onOffline);
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", checkNow);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, [sync]);

  return { sync, snapshot };
}
