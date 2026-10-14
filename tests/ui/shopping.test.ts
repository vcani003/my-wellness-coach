/** Shopping list UI logic (ux.md §10): grouping, grouped receipt lines, and the tick queue (SL4 Rec). */
import { describe, expect, it } from "vitest";
import type { AppliedOp } from "@/contracts/apply-result";
import { receiptLines, SHOPPING_GROUP } from "@/ui/chat/receipt-lines";
import { ANYWHERE, groupShopping, withGhosts } from "@/ui/widgets/shopping/model";
import { createTickQueue, type TickOutcome } from "@/ui/widgets/shopping/tick-queue";

const said = (value: string) => ({ value, basis: "said" as const, confidence: "high" as const });
const row = (id: string, store?: string) => ({ item: { id, store: store ? said(store) : undefined } });

describe("groupShopping", () => {
  it("groups by store in order of first use, Anywhere last, matching stores ignoring case", () => {
    const groups = groupShopping([row("1"), row("2", "MD Oriental"), row("3", "Publix"), row("4", "md oriental")]);
    expect(groups.map((g) => [g.key, g.rows.map((r) => r.item.id)])).toEqual([
      ["MD Oriental", ["2", "4"]],
      ["Publix", ["3"]],
      [ANYWHERE, ["1"]],
    ]);
  });

  it("rows ticked when the app opened sit at the bottom of their group; others keep their order", () => {
    const groups = groupShopping([row("1", "A"), row("2", "A"), row("3", "A")], new Set(["1"]));
    expect(groups[0].rows.map((r) => r.item.id)).toEqual(["2", "3", "1"]);
  });

  it("puts removed-row notes back where the row was", () => {
    expect(withGhosts(["a", "c"], [{ index: 1, row: "b" }])).toEqual(["a", "b", "c"]);
  });
});

describe("receiptLines", () => {
  const add = (opId: string, name: string, store?: string): AppliedOp => ({
    opId,
    summary: store
      ? { code: "SHOPPING_ADDED_STORE", params: { name, store }, text: "" }
      : { code: "SHOPPING_ADDED", params: { name }, text: "" },
    refs: [{ kind: "shopping", id: opId, change: "added" }],
  });

  it("joins runs of adds to the same store into one line; singles and other changes stay as they are", () => {
    const lines = receiptLines(
      [
        { opId: "r", summary: { code: "ITEM_ADDED", params: { name: "pho" }, text: "" }, refs: [] },
        add("1", "garlic", "MD"),
        add("2", "ginger", "MD"),
        add("3", "oatmilk", "Publix"),
        add("4", "hoisin"),
        add("5", "limes"),
      ],
      "Anywhere",
    );
    expect(lines.map((l) => [l.summary.code, l.summary.params])).toEqual([
      ["ITEM_ADDED", { name: "pho" }],
      [SHOPPING_GROUP, { store: "MD", names: "garlic, ginger" }],
      ["SHOPPING_ADDED_STORE", { name: "oatmilk", store: "Publix" }],
      [SHOPPING_GROUP, { store: "Anywhere", names: "hoisin, limes" }],
    ]);
  });
});

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

describe("tick queue", () => {
  it("a tick with no signal is kept on the phone as 'queued' and sent when back online", async () => {
    const storage = memoryStorage();
    let online = false;
    const sent: [string, boolean][] = [];
    const q = createTickQueue({
      storageKey: "k",
      storage,
      isOnline: () => online,
      submit: async (id, ticked) => (sent.push([id, ticked]), "saved"),
    });
    await q.tick("garlic", true);
    expect(q.getPending().get("garlic")).toEqual({ ticked: true, status: "queued" });
    expect(sent).toEqual([]);

    // A reload while offline still has it.
    const reloaded = createTickQueue({ storageKey: "k", storage, isOnline: () => online, submit: async () => "saved" });
    expect(reloaded.getPending().get("garlic")).toEqual({ ticked: true, status: "queued" });

    online = true;
    await q.flush();
    expect(sent).toEqual([["garlic", true]]);
    expect(q.getPending().size).toBe(0);
    expect(storage.data.size).toBe(0);
  });

  it("a save that can't reach the server is queued; one the server refuses puts the box back with Retry", async () => {
    let outcome: TickOutcome = "unreachable";
    const q = createTickQueue({ storageKey: "k", storage: memoryStorage(), isOnline: () => true, submit: async () => outcome });
    await q.tick("a", true);
    expect(q.getPending().get("a")?.status).toBe("queued");
    outcome = "refused";
    await q.tick("b", true);
    expect(q.getPending().get("b")?.status).toBe("failed");
    outcome = "saved";
    await q.retry("b");
    expect(q.getPending().has("b")).toBe(false);
  });

  // Regression: two quick taps on one row sent two saves at once; the second was based on an old
  // version, so the server called it stale and the box snapped back.
  it("saves go one at a time, and a tap replaced by a newer tap on the same row is never sent", async () => {
    const calls: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const q = createTickQueue({
      storageKey: "k",
      storage: memoryStorage(),
      isOnline: () => true,
      submit: async (id, ticked) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        calls.push(`${id}:${ticked}`);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return "saved";
      },
    });
    const first = q.tick("ginger", false);
    const second = q.tick("ginger", true);
    const other = q.tick("garlic", true);
    await Promise.all([first, second, other]);
    expect(maxInFlight).toBe(1);
    expect(calls).toEqual(["ginger:true", "garlic:true"]);
    expect(q.getPending().size).toBe(0);
  });
});
