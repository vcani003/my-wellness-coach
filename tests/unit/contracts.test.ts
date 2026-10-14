/** The shared Zod contract (backend-data.md §6) accepts what it should and refuses what it shouldn't. */
import { describe, expect, it } from "vitest";
import { ProposedChange, StreamEvent } from "@/contracts";
import { parseEnv } from "@/lib/env";
import { computeAllergenFlags } from "@/shared/profile/allergens";
import { standardName } from "@/shared/text";

const base = {
  proposalId: "msg-1",
  kitchenId: "k1",
  basedOnVersion: 0,
  source: { via: "chat", messageId: "msg-1" },
};
const fact = (value: unknown) => ({ value, basis: "said", confidence: "high" });

describe("ProposedChange", () => {
  it("accepts every operation type", () => {
    const operations = [
      { opId: "1", type: "item.add", evidence: "eggs", fields: { name: fact("eggs"), quantity: null, location: fact("fridge") } },
      { opId: "2", type: "item.update", evidence: "x", target: { name: "eggs" }, fields: {}, clear: ["location"] },
      { opId: "3", type: "item.use", evidence: "x", target: { itemId: "i1" }, fields: { stock: fact("low") } },
      { opId: "4", type: "item.remove", evidence: "x", target: { name: "eggs" } },
      { opId: "5", type: "meal.choose", evidence: "x", target: { ideaId: "idea" } },
      { opId: "6", type: "meal.plan", evidence: "x", target: { mealId: "m" } },
      { opId: "7", type: "meal.transition", evidence: "x", target: { mealId: "m" }, to: "done", note: "n" },
      { opId: "8", type: "recipe.save", evidence: "x", target: { mealId: "m" }, source: "ai", text: "t", ingredients: [{ name: "salt", basic: true }], steps: ["s"], basicsAssumed: ["salt"] },
      { opId: "9", type: "checklist.tick", evidence: "x", target: { mealId: "m" }, ingredient: "onion", ticked: true },
      { opId: "10", type: "review.queue", evidence: "x", kind: "after-cooking", mealId: "m", items: [{ name: "spinach" }] },
      { opId: "11", type: "review.resolve", evidence: "x", target: { reviewId: "r" }, outcome: "skipped" },
      { opId: "12", type: "profile.restriction.add", evidence: "x", fields: { kind: "allergy", subject: fact("peanuts") } },
      { opId: "13", type: "profile.restriction.update", evidence: "x", fields: { kind: "allergy", subject: fact("peanuts"), note: fact("n") } },
      { opId: "14", type: "profile.restriction.remove", evidence: "x", fields: { kind: "diet", subject: fact("vegan") }, forUserId: "u2" },
      { opId: "15", type: "profile.preference.save", evidence: "x", fields: { statement: fact("spicy") }, confirmedByMessageId: "m2" },
      { opId: "16", type: "profile.preference.remove", evidence: "x", fields: { statement: fact("spicy") } },
      { opId: "17", type: "changeset.revert", evidence: "x", target: { changeSetId: "cs" } },
    ];
    const parsed = ProposedChange.safeParse({
      ...base,
      operations,
      clarification: { question: "Which one?", options: [{ label: "A", reply: "a" }] },
      offer: { kind: "preference", statement: "spicy" },
      notes: [{ code: "ASSUMED_BASICS", params: { list: "salt" }, text: "Assumed salt" }],
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("refuses clearing the name, a target with both forms, and >4 clarification options", () => {
    const bad = [
      [{ opId: "1", type: "item.update", target: { name: "x" }, fields: {}, clear: ["name"] }],
      [{ opId: "1", type: "item.use", target: { name: "x", itemId: "y" }, fields: {} }],
    ];
    for (const operations of bad) expect(ProposedChange.safeParse({ ...base, operations }).success).toBe(false);
    const options = Array.from({ length: 5 }, (_, i) => ({ label: `${i}`, reply: `${i}` }));
    expect(ProposedChange.safeParse({ ...base, operations: [], clarification: { question: "?", options } }).success).toBe(false);
  });

  it("refuses an unknown basis or confidence", () => {
    const operations = [{ opId: "1", type: "item.add", fields: { name: { value: "x", basis: "guessed", confidence: "high" } } }];
    expect(ProposedChange.safeParse({ ...base, operations }).success).toBe(false);
  });
});

describe("StreamEvent", () => {
  it("parses each event type", () => {
    const events = [
      { type: "ack", turnId: "t", messageId: "m" },
      { type: "status", phase: "interpreting" },
      { type: "clarification", question: "?", options: [] },
      { type: "offer", offerId: "o", statement: "s" },
      { type: "notes", notes: [] },
      { type: "text", delta: "Hi" },
      { type: "idea", setId: "s", basedOnVersion: 3, idea: { ideaId: "i", name: "n", why: "w", uses: [], missing: [], allergenFlags: [] } },
      { type: "recipe", mealId: "m", part: "step", data: { text: "Boil" } },
      { type: "recipe.saved", mealId: "m", recipeId: "r", version: 1, newVersion: 4 },
      { type: "done", turnId: "t", assistantMessageId: "a" },
      { type: "error", reason: { code: "SAVE_FAILED", params: {}, text: "x" }, changed: false, retryable: true },
    ];
    for (const e of events) expect(StreamEvent.safeParse(e).success, e.type).toBe(true);
    expect(StreamEvent.safeParse({ type: "nope" }).success).toBe(false);
  });
});

describe("helpers", () => {
  it("standard names", () => {
    expect(standardName("Chicken Thighs")).toBe("chicken thigh");
    expect(standardName("tomatoes")).toBe("tomato");
    expect(standardName("berries")).toBe("berry");
    expect(standardName("hummus")).toBe("hummus");
    expect(standardName("  Eggs! ")).toBe("egg");
  });

  it("allergen matching uses categories and whole words", () => {
    const r = (subject: string) => ({
      id: subject, userId: "u", kind: "allergy" as const, subject: { value: subject, basis: "said" as const, confidence: "high" as const },
      subjectKey: subject, createdAt: "", createdBy: "", updatedAt: "", updatedBy: "",
    });
    expect(computeAllergenFlags(["Shrimp tacos", "rice"], [r("seafood")]).map((f) => f.ingredient)).toEqual(["Shrimp tacos"]);
    expect(computeAllergenFlags(["peanut butter", "butternut squash"], [r("peanuts")]).map((f) => f.ingredient)).toEqual(["peanut butter"]);
    expect(computeAllergenFlags(["eggplant"], [r("eggs")])).toEqual([]);
  });

  it("env: Neon URL optional; bad values fail with names only", () => {
    expect(parseEnv({}).PGLITE_DIR).toBe(".data/pglite");
    expect(parseEnv({ DATABASE_URL: "" }).DATABASE_URL).toBeUndefined();
    expect(() => parseEnv({ DATABASE_URL: "not a url secret123" })).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ DATABASE_URL: "not a url secret123" })).not.toThrow(/secret123/);
  });
});
