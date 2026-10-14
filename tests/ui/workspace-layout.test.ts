/** The pure widget selection / order / focus rules (0004, ux.md §2, frontend.md §2). */
import { describe, expect, it, vi } from "vitest";
import type { ChangeRef } from "@/contracts/apply-result";
import { focusFor, initialWorkspace, selectWidgets, workspaceReducer, type WorkspaceState } from "@/ui/workspace/layout";
import { registry } from "@/ui/workspace/registry";
import type { WidgetDef } from "@/ui/workspace/types";
import { kitchen } from "../support/kitchen-rows";

const Noop = () => null;
const def = (id: string, extra: Partial<WidgetDef> = {}): WidgetDef => ({
  id,
  domain: id.split(".")[0],
  lifetime: "lasting",
  titleKey: id,
  isPresent: () => true,
  wantsFocus: () => false,
  Component: Noop,
  ...extra,
});

// A pretend future registry: Kitchen, a Meal plan that wants meal refs, and a session widget.
const kitchenW = def("kitchen.items", { wantsFocus: (r) => r.kind === "item" });
const planW = def("kitchen.plan", { wantsFocus: (r) => r.kind === "meal" });
const ideasW = def("kitchen.ideas", { lifetime: "session", isPresent: () => true });
const fitnessW = def("fitness.today", { isPresent: () => false });
const reg = [kitchenW, planW, ideasW, fitnessW];
const ref = (kind: ChangeRef["kind"]): ChangeRef => ({ kind, id: `${kind}-1`, change: "updated" });
const ids = (s: WorkspaceState, layout: "phone" | "desktop") =>
  selectWidgets(s, { registry: reg, data: kitchen([]), layout }).map((w) => [w.def.id, w.expanded, w.updated] as const);

describe("workspace selection", () => {
  it("starts in registry order; phone expands only the first, desktop expands all; absent widgets are hidden", () => {
    expect(ids(initialWorkspace, "phone")).toEqual([
      ["kitchen.items", true, false],
      ["kitchen.plan", false, false],
      ["kitchen.ideas", false, false],
    ]);
    expect(ids(initialWorkspace, "desktop").every(([, expanded]) => expanded)).toBe(true);
  });

  it("after your message the focused widget moves to the top and is the one expanded on phone", () => {
    const s = workspaceReducer(initialWorkspace, { type: "turnApplied", focus: ["kitchen.plan"] });
    expect(ids(s, "phone")).toEqual([
      ["kitchen.plan", true, false],
      ["kitchen.items", false, false],
      ["kitchen.ideas", false, false],
    ]);
  });

  it("several widgets changed: the first in the receipt is focused, the others get an Updated dot until your next message", () => {
    let s = workspaceReducer(initialWorkspace, { type: "turnApplied", focus: ["kitchen.plan", "kitchen.items"] });
    expect(ids(s, "phone")[0]).toEqual(["kitchen.plan", true, false]);
    expect(ids(s, "phone")[1]).toEqual(["kitchen.items", false, true]);
    s = workspaceReducer(s, { type: "messageSent" });
    expect(ids(s, "phone")[1]).toEqual(["kitchen.items", false, false]);
  });

  it("the other person's changes never reorder or refocus", () => {
    const s = workspaceReducer(initialWorkspace, { type: "turnApplied", focus: ["kitchen.plan"] });
    expect(workspaceReducer(s, { type: "remoteChange" })).toBe(s);
  });

  it("a user toggle sticks until the next turn", () => {
    let s = workspaceReducer(initialWorkspace, { type: "userToggled", id: "kitchen.items", expanded: false });
    expect(ids(s, "desktop")[0]).toEqual(["kitchen.items", false, false]);
    s = workspaceReducer(s, { type: "turnApplied", focus: ["kitchen.items"] });
    expect(ids(s, "desktop")[0]).toEqual(["kitchen.items", true, false]);
  });

  it("session widgets can be closed; lasting ones can't; a later turn that needs it brings it back", () => {
    let s = workspaceReducer(initialWorkspace, { type: "userClosed", id: "kitchen.ideas" });
    s = workspaceReducer(s, { type: "userClosed", id: "kitchen.items" });
    expect(ids(s, "desktop").map(([id]) => id)).toEqual(["kitchen.items", "kitchen.plan"]);
    s = workspaceReducer(s, { type: "turnApplied", focus: ["kitchen.ideas"] });
    expect(ids(s, "desktop").map(([id]) => id)[0]).toBe("kitchen.ideas");
  });

  it("focusFor follows receipt order without repeats and ignores refs nobody wants", () => {
    expect(focusFor(reg, [ref("meal"), ref("item"), ref("meal"), ref("profile")])).toEqual(["kitchen.plan", "kitchen.items"]);
    expect(focusFor(reg, [])).toEqual([]);
  });

  it("the real registry: Kitchen is always present (empty state) and wants item changes", () => {
    expect(registry.map((w) => w.id)).toEqual(["kitchen.items", "shopping.list", "meals.ideas", "meals.plan"]);
    expect(registry[0].isPresent(null)).toBe(true);
    expect(focusFor(registry, [ref("item")])).toEqual(["kitchen.items"]);
    expect(focusFor(registry, [ref("profile")])).toEqual([]);
  });

  it("the real registry: Meal ideas live in the session (not KitchenState) and can be closed; the plan wants meal changes", () => {
    const ideas = registry.find((w) => w.id === "meals.ideas")!;
    const plan = registry.find((w) => w.id === "meals.plan")!;
    expect(ideas.lifetime).toBe("session");
    expect(ideas.isPresent(kitchen([]), {})).toBe(false);
    expect(ideas.isPresent(kitchen([]), { "meals.ideas": { ideas: [] } })).toBe(true);
    expect(plan.isPresent({ ...kitchen([]), kitchenId: "k-plan" })).toBe(false);
    expect(plan.isPresent({ ...kitchen([]), kitchenId: "k-plan", plan: ["m1"] })).toBe(true);
    expect(focusFor(registry, [ref("meal")])).toEqual(["meals.plan"]);
    // A closed session widget stays closed until a turn focuses it again.
    const data = kitchen([]);
    const session = { "meals.ideas": { ideas: [] } };
    const closed = workspaceReducer(initialWorkspace, { type: "userClosed", id: "meals.ideas" });
    expect(selectWidgets(closed, { registry, data, layout: "phone", session }).map((w) => w.def.id)).not.toContain("meals.ideas");
    const back = workspaceReducer(closed, { type: "turnApplied", focus: ["meals.ideas"] });
    expect(selectWidgets(back, { registry, data, layout: "phone", session })[0].def.id).toBe("meals.ideas");
  });

  it("the real registry: the Shopping list appears on its first item, stays once emptied, and wants list changes", () => {
    const shopping = registry.find((w) => w.id === "shopping.list")!;
    const empty = { ...kitchen([]), kitchenId: "k-shop" };
    const withItem = { ...empty, shoppingList: [shoppingRow("s1", "garlic")] };
    vi.stubGlobal("window", {}); // in the browser
    try {
      expect(shopping.isPresent(null)).toBe(false);
      expect(shopping.isPresent(empty)).toBe(false);
      expect(shopping.isPresent(withItem)).toBe(true);
      expect(shopping.isPresent(empty)).toBe(true); // emptied this session: "Your list is clear"
    } finally {
      vi.unstubAllGlobals();
    }
    expect(focusFor(registry, [ref("shopping")])).toEqual(["shopping.list"]);
  });

  // Regression: "seen this session" lived in server memory too, so after one request with items
  // the server rendered an empty list for everyone and the page failed to hydrate.
  it("on the server, the Shopping list shows only when it has items (no memory across requests)", () => {
    const shopping = registry.find((w) => w.id === "shopping.list")!;
    const empty = { ...kitchen([]), kitchenId: "k-server" };
    expect(shopping.isPresent({ ...empty, shoppingList: [shoppingRow("s1", "garlic")] })).toBe(true);
    expect(shopping.isPresent(empty)).toBe(false);
  });

  it("restoreFocus puts the last-used widget on top and open on a phone, only before anything else happened", () => {
    const data = { ...kitchen([]), shoppingList: [shoppingRow("s1", "garlic")] };
    const restored = workspaceReducer(initialWorkspace, { type: "restoreFocus", id: "shopping.list" });
    const phone = selectWidgets(restored, { registry, data, layout: "phone" });
    expect(phone.map((w) => [w.def.id, w.expanded])).toEqual([
      ["shopping.list", true],
      ["kitchen.items", false],
    ]);
    const afterTurn = workspaceReducer(initialWorkspace, { type: "turnApplied", focus: ["kitchen.items"] });
    expect(workspaceReducer(afterTurn, { type: "restoreFocus", id: "shopping.list" })).toBe(afterTurn);
  });
});

function shoppingRow(id: string, name: string) {
  const at = "2026-10-14T10:00:00.000Z";
  const by = { id: "vero", name: "Vero" };
  return {
    id,
    name: { value: name, basis: "said" as const, confidence: "high" as const },
    standardName: name,
    source: "chat" as const,
    createdAt: at,
    createdBy: by,
    updatedAt: at,
    updatedBy: by,
  };
}
