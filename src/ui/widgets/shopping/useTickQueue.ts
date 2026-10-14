"use client";
/** React wiring for the tick queue: one queue per kitchen, flushed on app open and on reconnect (SL4 Rec). */
import { useEffect, useSyncExternalStore } from "react";
import { useKitchenActions, type KitchenActions } from "@/ui/sync/KitchenActionsContext";
import { createTickQueue, type PendingTick, type TickQueue } from "./tick-queue";

const queues = new Map<string, { queue: TickQueue; actions: { current: KitchenActions } }>();
const EMPTY: ReadonlyMap<string, PendingTick> = new Map();

function queueFor(actions: KitchenActions) {
  let entry = queues.get(actions.kitchenId);
  if (!entry) {
    const ref = { current: actions };
    const queue = createTickQueue({
      storageKey: `shopping.pendingTicks.${actions.kitchenId}`,
      async submit(id, ticked) {
        const res = await ref.current.tickShopping(id, ticked);
        if (!res.ok) return "refused";
        ref.current.showOwn(res.result);
        // Already in the state you wanted (e.g. someone else ticked it too) counts as saved.
        const row = res.result.state.shoppingList.find((i) => i.id === id);
        return res.result.applied.length || (row && Boolean(row.ticked) === ticked) ? "saved" : "refused";
      },
    });
    entry = { queue, actions: ref };
    queues.set(actions.kitchenId, entry);
  }
  return entry;
}

/** Keep the queue's server calls pointed at the latest actions (version, tap IDs). */
function updateActions(actions: KitchenActions) {
  const entry = queues.get(actions.kitchenId);
  if (entry) entry.actions.current = actions;
}

let flushing = false;

export function useTickQueue(): { queue: TickQueue; pending: ReadonlyMap<string, PendingTick> } {
  const actions = useKitchenActions();
  const entry = queueFor(actions);
  useEffect(() => updateActions(actions));
  const pending = useSyncExternalStore(entry.queue.subscribe, entry.queue.getPending, () => EMPTY);

  useEffect(() => {
    const flush = () => {
      if (flushing) return;
      flushing = true;
      void entry.queue.flush().finally(() => {
        flushing = false;
      });
    };
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [entry]);

  return { queue: entry.queue, pending };
}
