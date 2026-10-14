/** `apply` is pure and forgiving: odd histories never throw (0018). */
import { describe, expect, it } from "vitest";
import { apply, emptyKitchen, replay } from "@/domains/kitchen/state";
import type { EventEnvelope } from "@/shared/events/types";

const event = (type: string, payload: unknown, n = 1): EventEnvelope => ({
  id: `e${n}`,
  stream: "kitchen:k1",
  seq: n,
  type,
  v: 1,
  actor: "vero",
  via: "chat",
  recordedAt: "2026-10-14T18:00:00.000Z",
  occurredAt: null,
  changeSetId: `cs${n}`,
  sourceMessageId: null,
  reverses: null,
  corrects: null,
  payload,
});

describe("apply", () => {
  it("ignores events about missing entities and unknown event types", () => {
    const state = emptyKitchen();
    expect(apply(state, event("item.updated", { itemId: "nope", set: {}, clear: [] }))).toBe(state);
    expect(apply(state, event("item.used", { itemId: "nope" }))).toBe(state);
    expect(apply(state, event("meal.transitioned", { mealId: "nope", from: "chosen", to: "planned" }))).toBe(state);
    expect(apply(state, event("some.future.event", {}))).toBe(state);
  });

  it("does not mutate the previous state", () => {
    const s0 = emptyKitchen();
    const s1 = apply(s0, event("item.added", { itemId: "i1", name: { value: "eggs", basis: "said", confidence: "high" }, standardName: "egg" }));
    expect(s0.items).toEqual({});
    expect(Object.keys(s1.items)).toEqual(["i1"]);
  });

  it("uses the date the user gave for 'added X days ago'", () => {
    const s = replay([
      event("item.added", {
        itemId: "i1",
        name: { value: "bread", basis: "said", confidence: "high" },
        standardName: "bread",
        occurredAt: { value: "2026-10-13T09:00:00-07:00", basis: "said", confidence: "medium" },
      }),
    ]);
    expect(s.items.i1.addedAt).toBe("2026-10-13T16:00:00.000Z");
    expect(s.items.i1.createdAt).toBe("2026-10-14T18:00:00.000Z");
  });
});
