// @vitest-environment jsdom
/**
 * 0052 on the client: a recipe edited in chat shows "Updated the Chicken curry recipe: removed
 * potatoes" with Undo; the Undo button hands its follow-up events (the restored recipe, the card)
 * to the app; and the Recipe screen shows the version the Undo brought back, not the undone one.
 */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApplyResult } from "@/contracts/apply-result";
import type { RecipeView } from "@/contracts/kitchen-state";
import type { StreamEvent } from "@/contracts/stream";
import { undoChange } from "@/app/actions";
import type { Receipt as ReceiptModel } from "@/ui/chat/chat-reducer";
import { Receipt } from "@/ui/chat/Receipt";
import { useChat, type TurnCallbacks } from "@/ui/chat/useChat";
import { pickRecipe } from "@/ui/widgets/meals/recipe-model";
import { initialMealsSession, mealsReducer, type MealsSession } from "@/ui/widgets/meals/session";
import { renderWithIntl } from "../support/intl";

vi.mock("@/app/actions", () => ({ undoChange: vi.fn() }));
afterEach(cleanup);

const updated = (params: Record<string, string>) => ({
  code: "RECIPE_UPDATED",
  params: { title: "Chicken curry", version: 2, removed: "", added: "", ...params },
  text: "Updated the Chicken curry recipe",
});
const receipt = (summary: ReturnType<typeof updated>): ReceiptModel => ({
  changeSetId: "cs-recipe",
  newVersion: 9,
  undoable: true,
  applied: [
    {
      opId: "op1",
      summary,
      refs: [
        { kind: "recipe", id: "r2", change: "added" },
        { kind: "meal", id: "meal1", change: "updated" },
      ],
    },
  ],
  rejected: [],
  undo: "idle",
});

describe("the recipe edit's receipt (0052)", () => {
  it("says what changed, with an Undo named for it", async () => {
    const onUndo = vi.fn();
    renderWithIntl(<Receipt receipt={receipt(updated({ what: "removed", removed: "potatoes" }))} onUndo={onUndo} />);
    const card = screen.getByRole("region", { name: "What changed" });
    expect(card).toHaveTextContent("Updated the Chicken curry recipe: removed potatoes");
    await userEvent.click(screen.getByRole("button", { name: "Undo: Updated the Chicken curry recipe: removed potatoes" }));
    expect(onUndo).toHaveBeenCalledWith("cs-recipe");
  });

  it.each([
    [{ what: "added", added: "coconut milk" }, "Updated the Chicken curry recipe: added coconut milk"],
    [{ what: "both", removed: "chicken thighs", added: "tofu" }, "Updated the Chicken curry recipe: removed chicken thighs, added tofu"],
    [{ what: "other" }, "Updated the Chicken curry recipe"],
  ])("%o → %s", (params, text) => {
    renderWithIntl(<Receipt receipt={receipt(updated(params))} onUndo={() => {}} />);
    expect(screen.getByRole("listitem")).toHaveTextContent(new RegExp(`^${text}$`));
  });
});

describe("the Undo button hands its events to the app (0052)", () => {
  it("onUndone gets the result, the events and a key for them", async () => {
    const events: StreamEvent[] = [{ type: "recipe.saved", mealId: "meal1", recipeId: "r1", version: 1, newVersion: 10 }];
    const result = { changeSetId: "cs-undo", newVersion: 10, undoable: false, applied: [{ opId: "undo", summary: { code: "UNDONE", params: {}, text: "" }, refs: [] }], rejected: [] } as unknown as ApplyResult;
    vi.mocked(undoChange).mockResolvedValue({ ok: true, result, events });
    const onUndone = vi.fn();
    const callbacks: TurnCallbacks = { onApplied() {}, onTurnEnd() {}, onUndone, onUndoRefused() {} };
    const { result: hook } = renderHook(() => useChat({ kitchenId: "k1", getVersion: () => 9, callbacks, initialHistory: { messages: [], nextCursor: null } }));
    await act(() => hook.current.undo("cs-recipe"));
    expect(onUndone).toHaveBeenCalledWith(result, events, expect.stringMatching(/^undo:cs-recipe:/));
  });
});

describe("after Undo the Recipe shows the version it brought back (0052)", () => {
  const ing = (name: string, index: number) => ({ index, name, amount: null, itemId: null, group: "need", allergenFlags: [] });
  const recipe = (version: number, names: string[], key: string): StreamEvent[] => [
    { type: "recipe", mealId: "meal1", part: "meta", data: { title: "Chicken curry", summary: "", servings: null, source: "ai", allergenFlags: [] } },
    ...names.map((n, i): StreamEvent => ({ type: "recipe", mealId: "meal1", part: "ingredient", data: ing(n, i) })),
    { type: "recipe", mealId: "meal1", part: "step", data: { index: 0, text: `Cook (${key}).` } },
    { type: "recipe.saved", mealId: "meal1", recipeId: `r${version}`, version, newVersion: version + 5 },
  ];
  const run = (events: StreamEvent[], key: string, start: MealsSession) =>
    mealsReducer(events.reduce((s, event) => mealsReducer(s, { type: "stream", key, event }), start), { type: "streamEnded", key });
  /** The page was loaded while v2 was the latest (the server read it). */
  const staleView: RecipeView = {
    id: "r2",
    meal: { id: "meal1", title: "Chicken curry" },
    version: 2,
    source: "ai",
    text: "",
    ingredients: [{ name: "chicken thighs" }],
    steps: ["Cook (v2)."],
    basicsAssumed: [],
    allergenFlags: [],
    createdAt: "2026-10-16T10:00:00.000Z",
    createdBy: { id: "u-ana", name: "Ana" },
    updatedAt: "2026-10-16T10:00:00.000Z",
    updatedBy: { id: "u-ana", name: "Ana" },
  };

  it("the Undo's restored v1 wins over the undone v2, whether the v2 came from the session or the server", () => {
    const v2 = run(recipe(2, ["chicken thighs"], "v2"), "chat-1", initialMealsSession);
    const restored = run(recipe(1, ["chicken thighs", "potatoes"], "v1"), "undo:cs:1", v2);
    expect(restored.recipes.meal1).toMatchObject({ status: "saved", version: 1 });
    const shown = pickRecipe(restored.recipes.meal1, staleView, { version: 1 });
    expect(shown?.ingredients.map((i) => i.name)).toEqual(["chicken thighs", "potatoes"]);
    expect(shown?.version).toBe(1);
  });

  it("before any Undo the newest still wins, as before", () => {
    const v1 = run(recipe(1, ["chicken thighs", "potatoes"], "v1"), "tap-1", initialMealsSession);
    expect(pickRecipe(v1.recipes.meal1, staleView, { version: 2 })?.version).toBe(2);
    expect(pickRecipe(v1.recipes.meal1, staleView)?.version).toBe(2);
  });
});
