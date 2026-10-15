/**
 * The Kitchen OS places (0042) replace the old widget workspace (its reducer and tests were
 * retired with `src/ui/workspace/`). The rules it guarded still hold, in their new form:
 * - only YOUR own turn points anywhere: a change that concerns another place gives a
 *   "Kitchen updated · Show" cue, and the page you're on never moves (0035 f);
 * - the other person's changes never produce a cue (the shell never calls `cueTarget` for them);
 * - "New" / "Updated" marks come from your own ApplyResult only, until your next message;
 * - "reopen where you left off" (the list waiting at the store, ux.md §10) replaces restoreFocus;
 * - the shell knows no food: each place says which refs it wants (0004).
 */
import { describe, expect, it } from "vitest";
import type { ChangeRef } from "@/contracts/apply-result";
import { rankUseItUp } from "@/ai/meals/use-it-up";
import { marksFrom } from "@/ui/app/marks";
import { cueTarget, parseLastPlace, placeForHost, placeForPath, placesFor, resumePlace, RESUME_WINDOW_MS } from "@/ui/places/model";
import { places, TODAY_PLACE_ID } from "@/ui/places/registry";
import { KITCHEN_WIDGET_ID } from "@/ui/widgets/kitchen";
import { useItUpRows } from "@/ui/widgets/kitchen/model";
import { MEAL_IDEAS_WIDGET_ID, MEAL_PLAN_WIDGET_ID } from "@/ui/widgets/meals";
import { SHOPPING_WIDGET_ID } from "@/ui/widgets/shopping/ShoppingWidget";
import { item, said } from "../support/kitchen-rows";

const ref = (kind: ChangeRef["kind"], id: string, change: ChangeRef["change"] = "added"): ChangeRef => ({ kind, id, change });

describe("the places registry (0042 dock, 0004 seam)", () => {
  it("has the five places in dock order, each with its own route", () => {
    expect(places.map((p) => [p.id, p.href])).toEqual([
      ["today", "/"],
      ["kitchen", "/kitchen"],
      ["plan", "/plan"],
      ["meals", "/meals"],
      ["list", "/list"],
    ]);
    expect(TODAY_PLACE_ID).toBe("today");
  });

  it("marks the right place for a URL: the Recipe belongs to Meals; Settings belongs to none", () => {
    expect(placeForPath(places, "/")?.id).toBe("today");
    expect(placeForPath(places, "/kitchen")?.id).toBe("kitchen");
    expect(placeForPath(places, "/plan")?.id).toBe("plan");
    expect(placeForPath(places, "/meals")?.id).toBe("meals");
    expect(placeForPath(places, "/recipe/m1")?.id).toBe("meals");
    expect(placeForPath(places, "/list")?.id).toBe("list");
    expect(placeForPath(places, "/settings")).toBeNull();
    expect(placeForPath(places, null)).toBeNull();
  });

  it("each place wants only its own refs; Today wants none (it summarises)", () => {
    expect(placesFor(places, [ref("item", "i1")]).map((p) => p.id)).toEqual(["kitchen"]);
    expect(placesFor(places, [ref("meal", "m1")]).map((p) => p.id)).toEqual(["plan"]);
    expect(placesFor(places, [ref("shopping", "s1")]).map((p) => p.id)).toEqual(["list"]);
    expect(placesFor(places, [ref("profile", "p1"), ref("tick", "t1")])).toEqual([]);
  });

  it("domain screen IDs map to their place (focusWidget / touched keep working)", () => {
    expect(placeForHost(places, KITCHEN_WIDGET_ID)?.id).toBe("kitchen");
    expect(placeForHost(places, MEAL_PLAN_WIDGET_ID)?.id).toBe("plan");
    expect(placeForHost(places, MEAL_IDEAS_WIDGET_ID)?.id).toBe("meals");
    expect(placeForHost(places, SHOPPING_WIDGET_ID)?.id).toBe("list");
    expect(placeForHost(places, "fitness.steps")).toBeNull();
  });
});

describe("your own change: a cue, never a jump (0035 f)", () => {
  it("points at the place the change concerns when you're somewhere else", () => {
    expect(cueTarget(places, [ref("item", "i1")], "today")?.id).toBe("kitchen");
    expect(cueTarget(places, [ref("shopping", "s1")], "kitchen")?.id).toBe("list");
  });

  it("says nothing when you're already looking at a place it concerns", () => {
    expect(cueTarget(places, [ref("item", "i1")], "kitchen")).toBeNull();
    expect(cueTarget(places, [ref("item", "i1"), ref("shopping", "s1")], "list")).toBeNull();
  });

  it("several places: the first in dock order", () => {
    expect(cueTarget(places, [ref("shopping", "s1"), ref("item", "i1")], "today")?.id).toBe("kitchen");
  });

  it("Full chat covers the page, so the shell passes no current place and the cue shows", () => {
    expect(cueTarget(places, [ref("item", "i1")], null)?.id).toBe("kitchen");
  });

  it("a change nobody shows (a profile edit) gives no cue", () => {
    expect(cueTarget(places, [ref("profile", "p1")], "today")).toBeNull();
  });
});

describe("New / Updated marks (ux.md §1)", () => {
  const op = (refs: ChangeRef[]) => ({ opId: "o", summary: { key: "x" }, refs }) as never;

  it("added rows are New, changed rows Updated, removed rows nothing", () => {
    expect(marksFrom({ applied: [op([ref("item", "a"), ref("item", "b", "updated"), ref("item", "c", "removed")])] })).toEqual({
      a: "new",
      b: "updated",
    });
  });

  it("New wins when one change adds and another updates the same row", () => {
    expect(marksFrom({ applied: [op([ref("shopping", "s", "added")]), op([ref("shopping", "s", "updated")])] })).toEqual({ s: "new" });
    expect(marksFrom({ applied: [op([ref("meal", "m", "updated")]), op([ref("meal", "m", "added")])] })).toEqual({ m: "new" });
  });

  it("refs that aren't rows on screen (ticks, reviews, profiles) get no mark", () => {
    expect(marksFrom({ applied: [op([ref("tick", "t"), ref("review", "r"), ref("profile", "p")])] })).toEqual({});
  });
});

describe("reopen where you left off (ux.md §10)", () => {
  const ids = places.map((p) => p.id);
  const now = 1_000_000_000_000;

  it("reopens a recent place, but not Today, an unknown place or an old visit", () => {
    expect(resumePlace({ id: "list", at: now - 60_000 }, now, ids, "today")).toBe("list");
    expect(resumePlace({ id: "today", at: now }, now, ids, "today")).toBeNull();
    expect(resumePlace({ id: "fitness", at: now }, now, ids, "today")).toBeNull();
    expect(resumePlace({ id: "list", at: now - RESUME_WINDOW_MS }, now, ids, "today")).toBeNull();
    expect(resumePlace({ id: "list", at: now + 60_000 }, now, ids, "today")).toBeNull();
    expect(resumePlace(null, now, ids, "today")).toBeNull();
  });

  it("unreadable storage just means Today", () => {
    expect(parseLastPlace(null)).toBeNull();
    expect(parseLastPlace("{nope")).toBeNull();
    expect(parseLastPlace(JSON.stringify({ id: 3, at: "x" }))).toBeNull();
    expect(parseLastPlace(JSON.stringify({ id: "list", at: 5 }))).toEqual({ id: "list", at: 5 });
  });
});

describe("Today's Use it up matches the meal AI's ranking (0025)", () => {
  const NOW = new Date("2026-10-20T12:00:00.000Z");
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
  const fridge = said("fridge" as const);
  const items = [
    item("old-milk", "milk", { location: fridge, addedAt: daysAgo(6) }),
    item("new-milk", "yogurt", { location: fridge, addedAt: daysAgo(1) }),
    item("leftovers", "leftover curry", { location: fridge, addedAt: daysAgo(2) }),
    item("thawed", "chicken", { location: fridge, addedAt: daysAgo(10), defrostedOn: said(daysAgo(1)) }),
    item("legacy-thaw", "prawns", { location: fridge, addedAt: daysAgo(2), frozen: said(false) }),
    item("pantry-rice", "rice", { location: said("pantry" as const), addedAt: daysAgo(40) }),
    item("low-only", "fish sauce", { location: said("pantry" as const), stock: said("low" as const) }),
    item("gone", "eggs", { location: fridge, addedAt: daysAgo(9), stock: said("out" as const) }),
  ];

  it("lists exactly the items the AI treats as needing using up (Low alone doesn't count)", () => {
    const ai = rankUseItUp({ items: items.filter((i) => i.stock?.value !== "out") }, NOW)
      .filter((u) => u.perishable)
      .map((u) => u.itemId)
      .sort();
    const ui = useItUpRows(items, NOW, Infinity)
      .map((r) => r.item.id)
      .sort();
    expect(ui).toEqual(ai);
    expect(ui).toEqual(["leftovers", "legacy-thaw", "old-milk", "thawed"]);
  });

  it("most urgent first, at most three", () => {
    expect(useItUpRows(items, NOW).map((r) => r.item.id)).toEqual(["thawed", "leftovers", "legacy-thaw"]);
  });
});
