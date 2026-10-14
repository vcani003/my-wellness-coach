/** The FAKE interpreter's message patterns (milestone 2 stand-in, not the real AI). */
import { describe, expect, it } from "vitest";
import { matchIntent, splitList } from "@/ai/fake/patterns";

describe("fake interpreter patterns", () => {
  it("splits shopping lists, keeping each piece exactly as typed (it's the evidence)", () => {
    expect(splitList("eggs, chicken thighs, spinach and yogurt")).toEqual(["eggs", "chicken thighs", "spinach", "yogurt"]);
    expect(splitList("milk, bread, and 2 lbs of chicken.")).toEqual(["milk", "bread", "2 lbs of chicken"]);
  });

  it.each([
    ["I bought eggs, chicken thighs, spinach and yogurt", "bought", ["eggs", "chicken thighs", "spinach", "yogurt"]],
    ["We got some milk and the bread!", "bought", ["milk", "bread"]],
    ["I froze the chicken", "froze", ["chicken"]],
    ["I used the rest of the spinach.", "usedUp", ["spinach"]],
    ["finished the yogurt", "usedUp", ["yogurt"]],
    ["We're out of milk", "usedUp", ["milk"]],
    ["The yogurt is running low", "low", ["yogurt"]],
    ["the milk's running low", "low", ["milk"]],
    ["We're running low on eggs", "low", ["eggs"]],
  ])("%s → %s", (text, kind, names) => {
    const intent = matchIntent(text);
    expect(intent.kind).toBe(kind);
    const segs = "items" in intent ? intent.items : "targets" in intent ? intent.targets : [];
    expect(segs.map((s) => s.name)).toEqual(names);
    for (const s of segs) expect(text.toLowerCase()).toContain(s.raw.toLowerCase());
  });

  it("reads a simple quantity as said", () => {
    const intent = matchIntent("I bought 2 lbs of chicken");
    expect(intent.kind === "bought" && intent.items[0]).toEqual({
      raw: "2 lbs of chicken",
      name: "chicken",
      quantity: { asSaid: "2 lbs", amount: 2, unit: "lbs" },
    });
  });

  it("undo, and anything else is not understood", () => {
    expect(matchIntent("undo").kind).toBe("undo");
    expect(matchIntent("Undo that.").kind).toBe("undo");
    expect(matchIntent("What can I make tonight?").kind).toBe("unknown");
    expect(matchIntent("hello").kind).toBe("unknown");
  });
});
