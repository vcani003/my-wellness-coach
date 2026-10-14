/** The FAKE interpreter's message patterns (milestone 2 stand-in, not the real AI). */
import { describe, expect, it } from "vitest";
import { createFakeInterpreter } from "@/ai/fake";
import { matchIntent, splitList } from "@/ai/fake/patterns";
import { request } from "@/ai/eval/fixtures";

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
    ["The old eggs are gone", "oldGone", ["eggs"]],
    ["the older milk is gone.", "oldGone", ["milk"]],
    ["I defrosted the chicken", "defrosted", ["chicken"]],
    ["Just thawed the shrimp", "defrosted", ["shrimp"]],
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
    expect(matchIntent("Is it going to rain?").kind).toBe("unknown");
    expect(matchIntent("hello").kind).toBe("unknown");
  });

  it("meal phrases (0005, 0013): ideas, the Nth one, add that to my plan, start cooking, I made it", () => {
    expect(matchIntent("What can I make tonight?").kind).toBe("mealIdeas");
    expect(matchIntent("the second one")).toEqual({ kind: "meal", action: "meal_choose", label: "d2" });
    expect(matchIntent("Let's do the first one!")).toEqual({ kind: "meal", action: "meal_choose", label: "d1" });
    expect(matchIntent("add that to my meal plan")).toEqual({ kind: "meal", action: "meal_plan", label: "last_chosen" });
    expect(matchIntent("start cooking")).toEqual({ kind: "meal", action: "meal_start_cooking", label: "last_chosen" });
    expect(matchIntent("I made it!")).toEqual({ kind: "meal", action: "meal_done", label: "last_chosen" });
  });
});

describe("fake interpreter replies", () => {
  // Tester run 2026-10-14: "the chicken thighs is in the freezer now". A plural name is one target,
  // so the reply never picks "is"/"are" from the count; it uses verb-first wording instead.
  it.each([
    ["I froze the chicken thighs", "All set: moved the chicken thighs to the freezer."],
    ["The old eggs are gone", "Got it: marked the older eggs as gone."],
    ["I defrosted the chicken thighs", "Noted: marked the chicken thighs as defrosted."],
    ["The yogurt is running low", "Noted: marked the yogurt as running low."],
  ])("%s → %s", async (text, reply) => {
    const result = await createFakeInterpreter().interpret(request(text));
    expect(result.reply).toBe(reply);
    expect(result.reply).not.toMatch(/\b(is|are)\b/);
  });
});
