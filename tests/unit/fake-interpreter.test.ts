/** The FAKE interpreter's message patterns (milestone 2 stand-in, not the real AI). */
import { describe, expect, it } from "vitest";
import { createFakeInterpreter, FALLBACK_REPLY, SAMPLE_REPLY, STAND_IN_DECLINE_REPLY } from "@/ai/fake";
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
    expect(matchIntent("hello").kind).toBe("unknown");
  });

  it("meal phrases it still does (0005, 0013): add that to my plan, start cooking, I made it", () => {
    expect(matchIntent("add that to my meal plan")).toEqual({ kind: "meal", action: "meal_plan", label: "last_chosen" });
    expect(matchIntent("start cooking")).toEqual({ kind: "meal", action: "meal_start_cooking", label: "last_chosen" });
    expect(matchIntent("I made it!")).toEqual({ kind: "meal", action: "meal_done", label: "last_chosen" });
  });

  // 0059 PF10: "stand in ai shouldnt be able to answer. only the real model can."
  it.each([
    "Is it going to rain?",
    "How much eggs do I need?",
    "what are the measurements?",
    "When should I start cooking?",
    "What can I make tonight?",
    "any other ideas?",
    "suggest something for dinner",
    "the second one",
    "Let's do the first one!",
    "I want to make pad thai",
    "i was thinking a chicken curry, with coconut milk. I have potatoes",
    "let's make a chicken curry",
    "give me a recipe for banana bread",
    "remove the yogurt from the curry",
  ])("PF10: %s → needs the real AI", (text) => {
    expect(matchIntent(text).kind).toBe("needsRealAI");
  });

  it.each([
    ["make me a sample recipe", undefined],
    ["Make me a sample recipe.", undefined],
    ["sample recipe for chicken curry", "chicken curry"],
    ["can you make a sample recipe for a pasta bake?", "pasta bake"],
    ["give me a sample stir-fry recipe", "stir-fry"],
  ])("PF10: %s → a sample recipe (%s)", (text, dish) => {
    expect(matchIntent(text)).toEqual(dish ? { kind: "sample", dish } : { kind: "sample" });
  });

  it("the staples and week questions it answers by code are not declined", () => {
    expect(matchIntent("what staples do I need?").kind).toBe("staplesQuestion");
    expect(matchIntent("What are we eating this week?").kind).toBe("weekPlan");
    expect(matchIntent("what do we need for this week?").kind).toBe("weekNeeds");
  });

  // Regression (preview, 2026-10-17): "5-6 large eggs" kept the amount in the name, and
  // "the ingredients needed to make this" became an item.
  it.each([
    ["I bought 5-6 large eggs", "large eggs", { asSaid: "5-6" }],
    ["I bought 5 - 6 large eggs", "large eggs", { asSaid: "5-6" }],
    ["I got 2 x eggs", "eggs", { asSaid: "2", amount: 2 }],
    ["I got 2x avocados", "avocados", { asSaid: "2", amount: 2 }],
    ["I bought a dozen eggs", "eggs", { asSaid: "a dozen", amount: 12 }],
    ["I bought half a dozen eggs", "eggs", { asSaid: "half a dozen", amount: 6 }],
    ["I bought two avocados", "avocados", { asSaid: "two", amount: 2 }],
    ["I bought 1.5 kg of rice", "rice", { asSaid: "1.5 kg", amount: 1.5, unit: "kg" }],
  ])("PF10: %s → %s with the amount as quantity", (text, name, quantity) => {
    const intent = matchIntent(text);
    expect(intent.kind === "bought" && intent.items.map((i) => ({ name: i.name, quantity: i.quantity }))).toEqual([{ name, quantity }]);
  });

  it.each(["I got the ingredients needed to make this", "I bought everything", "we got all the stuff", "I bought groceries"])(
    "PF10: %s names no food → no item",
    (text) => {
      const intent = matchIntent(text);
      expect(intent.kind === "bought" && intent.items).toEqual([]);
    },
  );

  it("'remove the milk from the fridge' is still a kitchen removal", () => {
    const intent = matchIntent("remove the milk from the fridge");
    expect(intent.kind === "throwOut" && intent.targets.map((t) => t.name)).toEqual(["milk"]);
  });

  it("PF10: a real food next to a non-food phrase is still added", () => {
    const intent = matchIntent("I bought milk and the ingredients for the curry");
    expect(intent.kind === "bought" && intent.items.map((i) => i.name)).toEqual(["milk"]);
  });
});

describe("the stand-in's replies (0059 PF10)", () => {
  it.each(["How much eggs do I need?", "What can I make tonight?", "I want to make pad thai", "no garlic", "skip step 2", "swap the chicken for tofu", "make it vegetarian"])(
    "%s → the decline line, no change",
    async (text) => {
      expect(await createFakeInterpreter().interpret(request(text))).toEqual({ kind: "answer", proposal: null, reply: STAND_IN_DECLINE_REPLY });
    },
  );

  it("the decline line is exactly Vero's wording", () => {
    expect(STAND_IN_DECLINE_REPLY).toBe("That needs the real AI (Claude). I'm only the stand-in.");
  });

  it("'I got the ingredients needed to make this' → the help text, no change (regression)", async () => {
    expect(await createFakeInterpreter().interpret(request("I got the ingredients needed to make this"))).toEqual({ kind: "answer", proposal: null, reply: FALLBACK_REPLY });
  });

  it("the help text lists what it does and mentions the sample recipe", () => {
    expect(FALLBACK_REPLY).toMatch(/stand-in/);
    expect(FALLBACK_REPLY).toMatch(/make me a sample recipe/);
  });

  it("'make me a sample recipe' → chooses a meal titled 'Sample recipe (stand-in)', and its recipe follows", async () => {
    const r = await createFakeInterpreter().interpret(request("make me a sample recipe"));
    expect(r.reply).toBe(SAMPLE_REPLY);
    expect(r.proposal?.operations).toMatchObject([{ type: "meal.choose", target: { title: "Sample recipe (stand-in)" } }]);
    expect(r.followUps).toMatchObject([{ kind: "recipe" }]);
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
