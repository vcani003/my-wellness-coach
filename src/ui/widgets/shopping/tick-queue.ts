/**
 * Ticks on the shopping list (ux.md §10, SL4 Rec). Framework-free so it can be unit-tested.
 *
 * - A tick shows at once (ticks aren't AI-interpreted) and is saved in the background.
 * - If the save can't reach the server (no signal at the store), the tick is kept on this phone
 *   (localStorage) and marked "Not synced yet"; it is sent again when the phone is back online
 *   or the app is opened again. Only ticks work offline; everything else stays read-only (0017).
 * - If the server says no, the box goes back and the row says "Couldn't save that · Retry".
 * - Saves go one at a time, so each is based on the latest version (two quick taps on the same
 *   row would otherwise make the second look stale to the server), and a tap that a newer tap
 *   on the same row has replaced is never sent.
 */
export type TickStatus = "saving" | "queued" | "failed";
export interface PendingTick {
  ticked: boolean;
  status: TickStatus;
}

/** What one save attempt came back with. */
export type TickOutcome = "saved" | "refused" | "unreachable";

export interface TickQueueOptions {
  storageKey: string;
  submit: (id: string, ticked: boolean) => Promise<TickOutcome>;
  isOnline?: () => boolean;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
}

function safeStorage(): TickQueueOptions["storage"] {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function createTickQueue(opts: TickQueueOptions) {
  const storage = opts.storage === undefined ? safeStorage() : opts.storage;
  const isOnline = opts.isOnline ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
  let pending: ReadonlyMap<string, PendingTick> = new Map();
  const listeners = new Set<() => void>();
  let chain: Promise<void> = Promise.resolve();

  const persist = () => {
    try {
      const queued = [...pending].filter(([, p]) => p.status === "queued").map(([id, p]) => [id, p.ticked]);
      if (queued.length) storage?.setItem(opts.storageKey, JSON.stringify(queued));
      else storage?.removeItem(opts.storageKey);
    } catch {
      // Storage full or blocked: the tick still shows; it just won't survive a reload.
    }
  };
  const set = (id: string, value: PendingTick | null) => {
    const next = new Map(pending);
    if (value) next.set(id, value);
    else next.delete(id);
    pending = next;
    persist();
    for (const l of listeners) l();
  };

  // Ticks kept on this phone from an earlier visit.
  try {
    const raw = storage?.getItem(opts.storageKey);
    const saved: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(saved)) {
      pending = new Map(
        saved
          .filter((e): e is [string, boolean] => Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "boolean")
          .map(([id, ticked]) => [id, { ticked, status: "queued" as const }]),
      );
    }
  } catch {
    pending = new Map();
  }

  const send = async (id: string, ticked: boolean) => {
    if (!isOnline()) {
      set(id, { ticked, status: "queued" });
      return;
    }
    set(id, { ticked, status: "saving" });
    const mine = pending.get(id);
    const run = async () => {
      if (pending.get(id) !== mine) return; // replaced by a newer tap on this row
      let outcome: TickOutcome;
      try {
        outcome = await opts.submit(id, ticked);
      } catch {
        outcome = "unreachable";
      }
      if (pending.get(id) !== mine) return; // a newer tap wins; it's queued behind this one
      if (outcome === "saved") set(id, null);
      else set(id, { ticked, status: outcome === "unreachable" ? "queued" : "failed" });
    };
    const next = chain.then(run);
    chain = next.catch(() => {});
    return next;
  };

  return {
    getPending: () => pending,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Tap on a row's box. */
    tick: (id: string, ticked: boolean) => send(id, ticked),
    /** "Retry" after a refusal. */
    retry(id: string) {
      const p = pending.get(id);
      return p ? send(id, p.ticked) : Promise.resolve();
    },
    /** Forget a refused tick (the box goes back to what the server has). */
    dismiss(id: string) {
      if (pending.get(id)?.status === "failed") set(id, null);
    },
    /** Resolves when every save started so far has finished (before "Done shopping" adds). */
    idle: () => chain,
    /** Send everything kept on this phone (on reconnect or app open). */
    async flush() {
      for (const [id, p] of pending) if (p.status === "queued") await send(id, p.ticked);
    },
    /** Rows no longer on the list can't be ticked: drop their pending ticks. */
    prune(openIds: ReadonlySet<string>) {
      for (const id of pending.keys()) if (!openIds.has(id)) set(id, null);
    },
  };
}

export type TickQueue = ReturnType<typeof createTickQueue>;
