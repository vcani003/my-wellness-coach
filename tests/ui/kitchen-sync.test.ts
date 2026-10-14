/** useKitchenSync's engine (backend-data.md §6): timing, remote diffs, own changes, failures. */
import { describe, expect, it, vi } from "vitest";
import { createKitchenSync, diffRemote, pollDelay, POLL_ACTIVE_MS, POLL_IDLE_MS } from "@/ui/sync/kitchen-sync";
import { item, kitchen, LEVI } from "../support/kitchen-rows";

describe("poll timing", () => {
  it("15 s while active, 60 s after 5 idle minutes, paused while hidden", () => {
    expect(pollDelay({ hidden: false, idleMs: 0 })).toBe(POLL_ACTIVE_MS);
    expect(pollDelay({ hidden: false, idleMs: 4 * 60_000 })).toBe(15_000);
    expect(pollDelay({ hidden: false, idleMs: 5 * 60_000 })).toBe(POLL_IDLE_MS);
    expect(pollDelay({ hidden: true, idleMs: 0 })).toBeNull();
  });
});

describe("diffRemote", () => {
  it("reports rows someone else added or changed, not mine", () => {
    const prev = kitchen([item("eggs", "eggs")]);
    const next = kitchen(
      [
        item("eggs", "eggs", { updatedAt: "2026-10-14T11:00:00.000Z" }), // changed by me
        item("milk", "milk", { createdBy: LEVI, updatedBy: LEVI }),
      ],
      2,
    );
    expect(diffRemote(prev, next, "vero")).toEqual({ ids: ["milk"], actorNames: ["Levi"] });
  });

  it("a missing person still counts as a remote change", () => {
    const next = kitchen([item("x", "x", { updatedBy: { id: "gone", missing: true } })]);
    expect(diffRemote(null, next, "vero").ids).toEqual(["x"]);
  });
});

describe("createKitchenSync", () => {
  const setup = (responses: Record<string, unknown>, initial = kitchen([item("eggs", "eggs")], 1)) => {
    const fetchJson = vi.fn(async (url: string) => {
      const key = url.endsWith("/version") ? "version" : "state";
      const value = responses[key];
      if (value instanceof Error) throw value;
      return value;
    });
    return { sync: createKitchenSync({ kitchenId: "k1", meId: "vero", initial, fetchJson, now: () => 1000 }), fetchJson };
  };

  it("same version → no state reload", async () => {
    const { sync, fetchJson } = setup({ version: { version: 1 } });
    await sync.check();
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(sync.getSnapshot().status).toBe("ok");
  });

  it("higher version → reloads and tells listeners what the other person changed", async () => {
    const remote = kitchen([item("eggs", "eggs"), item("milk", "milk", { createdBy: LEVI, updatedBy: LEVI })], 2);
    const { sync } = setup({ version: { version: 2 }, state: remote });
    const seen: string[][] = [];
    sync.onRemoteChange((c) => seen.push(c.actorNames));
    await sync.check();
    expect(sync.getSnapshot().state?.version).toBe(2);
    expect(seen).toEqual([["Levi"]]);
  });

  it("your own ApplyResult state shows at once and is never replaced by an older poll", async () => {
    const { sync } = setup({ version: { version: 3 }, state: kitchen([], 2) });
    sync.applyOwn(kitchen([item("eggs", "eggs"), item("yogurt", "yogurt")], 3));
    await sync.check();
    expect(sync.getSnapshot().state?.items.map((i) => i.id)).toEqual(["eggs", "yogurt"]);
  });

  it("a failed poll keeps what's on screen and marks it stale; with nothing on screen it's an error", async () => {
    const { sync } = setup({ version: new Error("offline") });
    await sync.check();
    expect(sync.getSnapshot()).toMatchObject({ status: "stale", syncedAt: 1000 });
    const empty = setup({ state: new Error("offline") }, null as never);
    expect(empty.sync.getSnapshot().status).toBe("loading");
    await empty.sync.refresh();
    expect(empty.sync.getSnapshot().status).toBe("error");
  });

  it("a state that fails the contract is dropped, not shown (0018)", async () => {
    const { sync } = setup({ version: { version: 5 }, state: { nonsense: true } });
    await sync.check();
    expect(sync.getSnapshot()).toMatchObject({ status: "stale" });
    expect(sync.getSnapshot().state?.version).toBe(1);
  });
});
