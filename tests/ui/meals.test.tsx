// @vitest-environment jsdom
/**
 * Meal screens (ux.md §3, §5; decisions 0009, 0013, 0019): the session reducer the stream feeds,
 * Meal ideas cards with the allergen badge, the Recipe's one checklist with shared ticks, the Meal
 * plan's Cancel with Undo, and "Update your kitchen".
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useReducer, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/app/actions";
import type { KitchenState, MealRow, RecipeView } from "@/contracts/kitchen-state";
import type { StreamEvent } from "@/contracts/stream";
import { AnnouncerProvider } from "@/ui/a11y/Announcer";
import { KitchenActionsProvider, type KitchenActions } from "@/ui/sync/KitchenActionsContext";
import { KitchenDataProvider } from "@/ui/sync/KitchenDataContext";
import { MealIdeasWidget } from "@/ui/widgets/meals/MealIdeasWidget";
import { MealPlanWidget } from "@/ui/widgets/meals/MealPlanWidget";
import { MealsProvider, type MealActions, type MealNotice } from "@/ui/widgets/meals/MealsContext";
import { RecipeScreen } from "@/ui/widgets/meals/RecipeScreen";
import { initialMealsSession, mealsReducer, type MealsSession } from "@/ui/widgets/meals/session";
import { UpdateKitchenSheet } from "@/ui/widgets/meals/UpdateKitchenSheet";
import { fakeActions, saved } from "../support/fake-actions";
import { renderWithIntl } from "../support/intl";
import { item, kitchen, LEVI, T0, VERO } from "../support/kitchen-rows";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const NOW = new Date("2026-10-17T12:00:00.000Z");
const audit = { createdAt: T0, createdBy: VERO, updatedAt: T0, updatedBy: VERO };
const SHRIMP_FLAG = { ingredient: "shrimp", userId: "levi", subject: "seafood", note: "can eat shellfish if medicine is on hand" };

const meal = (id: string, title: string, status: MealRow["status"], extra: Partial<MealRow> = {}): MealRow => ({
  id,
  title,
  status,
  chosenAt: T0,
  allergenFlags: [],
  ...audit,
  ...extra,
});

const ok = (state: KitchenState, code = "NO_CHANGE") => vi.fn(async (): Promise<ActionResult> => saved(state, code));

function fakeMealActions(overrides: Partial<MealActions> = {}): MealActions {
  const refused = async (): Promise<ActionResult> => ({ ok: false, reason: { code: "SAVE_FAILED", params: {}, text: "x" }, retryable: true });
  return {
    choose: vi.fn(async () => true),
    retryRecipe: vi.fn(async () => true),
    addToPlan: vi.fn(refused),
    startCooking: vi.fn(refused),
    cancel: vi.fn(refused),
    finishCooking: vi.fn(async () => ({ ok: false as const, reason: { code: "SAVE_FAILED", params: {}, text: "x" }, retryable: true })),
    submitUpdateKitchen: vi.fn(refused),
    updateKitchenLater: vi.fn(refused),
    skipUpdateKitchen: vi.fn(refused),
    tick: vi.fn(refused),
    addNeedsToList: vi.fn(refused),
    openRecipe: vi.fn(),
    closeRecipe: vi.fn(),
    useOwnRecipe: vi.fn(),
    showSaved: vi.fn(),
    ...overrides,
  };
}

/** Renders `children` with real reducers for the meal session and fakes for every server call. */
function Harness({
  state,
  session: start,
  actions,
  kitchenActions,
  onNotice,
  children,
}: {
  state: KitchenState;
  session: MealsSession;
  actions: MealActions;
  kitchenActions: KitchenActions;
  onNotice?: (n: MealNotice | null) => void;
  children: ReactNode;
}) {
  const [session, dispatch] = useReducer(mealsReducer, start);
  return (
    <AnnouncerProvider>
      <KitchenActionsProvider value={kitchenActions}>
        <KitchenDataProvider value={{ me: VERO, snapshot: { state, status: "ok", syncedAt: NOW.getTime() }, marks: {}, remoteIds: new Set(), now: NOW, turn: 0 }}>
          <MealsProvider
            value={{
              session,
              dispatch,
              actions,
              members: [
                { userId: "vero", displayName: "Vero" },
                { userId: "levi", displayName: "Levi" },
              ],
              notice: null,
              setNotice: onNotice ?? (() => {}),
              openUpdateKitchen: (request) => dispatch({ type: "openUpdateKitchen", request }),
            }}
          >
            {children}
          </MealsProvider>
        </KitchenDataProvider>
      </KitchenActionsProvider>
    </AnnouncerProvider>
  );
}

function show(ui: ReactNode, opts: { state?: KitchenState; session?: MealsSession; actions?: MealActions; kitchenActions?: KitchenActions; onNotice?: (n: MealNotice | null) => void } = {}) {
  const actions = opts.actions ?? fakeMealActions();
  const kitchenActions = opts.kitchenActions ?? fakeActions();
  renderWithIntl(
    <Harness state={opts.state ?? kitchen([])} session={opts.session ?? initialMealsSession} actions={actions} kitchenActions={kitchenActions} onNotice={opts.onNotice}>
      {ui}
    </Harness>,
  );
  return { actions, kitchenActions };
}

const feed = (events: StreamEvent[], key = "m1", start: MealsSession = initialMealsSession) =>
  events.reduce((s, event) => mealsReducer(s, { type: "stream", key, event }), start);

const idea = (ideaId: string, name: string, extra: Partial<{ uses: string[]; missing: string[]; allergenFlags: (typeof SHRIMP_FLAG)[] }> = {}) => ({
  type: "idea" as const,
  setId: "m1:ideas",
  basedOnVersion: 3,
  idea: { ideaId, name, why: `Why ${name}`, uses: [], missing: [], allergenFlags: [], ...extra },
});

describe("meal session reducer (the turn stream)", () => {
  it("ideas stream in card order; a new request replaces them; ideas.dropped removes the set", () => {
    let s = feed([{ type: "status", phase: "ideas" }]);
    expect(s.ideas?.status).toBe("loading");
    s = feed([idea("i1", "Omelette"), idea("i2", "Soup"), idea("i1", "Omelette")], "m1", s);
    expect(s.ideas?.ideas.map((i) => i.name)).toEqual(["Omelette", "Soup"]);
    s = feed([{ type: "notes", notes: [{ code: "BASICS_ASSUMED", params: { basics: "salt" }, text: "Assumes salt." }] }], "m1", s);
    expect(s.ideas?.notes).toHaveLength(1);
    s = mealsReducer(s, { type: "streamEnded", key: "m1" });
    expect(s.ideas?.status).toBe("ready");
    expect(feed([{ type: "ideas.dropped", setId: "m1:ideas" }], "m2", s).ideas).toBeNull();
    // A later request: "Finding ideas…" replaces the old cards.
    expect(feed([{ type: "status", phase: "ideas" }], "m3", s).ideas?.ideas).toEqual([]);
  });

  it("recipe parts with no recipe.saved by the end are dropped; saved ones stay", () => {
    const parts: StreamEvent[] = [
      { type: "recipe", mealId: "meal1", part: "meta", data: { title: "Omelette", summary: "", servings: "2", source: "ai", allergenFlags: [] } },
      { type: "recipe", mealId: "meal1", part: "ingredient", data: { index: 1, name: "feta", amount: null, itemId: null, group: "need", allergenFlags: [] } },
      { type: "recipe", mealId: "meal1", part: "ingredient", data: { index: 0, name: "eggs", amount: "3", itemId: "eggs", group: "kitchen", allergenFlags: [] } },
      { type: "recipe", mealId: "meal1", part: "ingredient", data: { nonsense: true } }, // dropped, never thrown (0018)
      { type: "recipe", mealId: "meal1", part: "step", data: { index: 0, text: "Whisk." } },
    ];
    const writing = feed(parts);
    expect(writing.recipes.meal1.ingredients.map((i) => i.name)).toEqual(["eggs", "feta"]);
    const failed = mealsReducer(writing, { type: "streamEnded", key: "m1" });
    expect(failed.recipes.meal1).toMatchObject({ status: "failed", ingredients: [], steps: [], title: "Omelette" });

    const done = feed([{ type: "recipe.saved", mealId: "meal1", recipeId: "r1", version: 1, newVersion: 7 }], "m1", writing);
    expect(mealsReducer(done, { type: "streamEnded", key: "m1" }).recipes.meal1).toMatchObject({ status: "saved", version: 1 });
  });

  it("update-kitchen opens the sheet's request", () => {
    const s = feed([{ type: "update-kitchen", mealId: "meal1", title: "Omelette", items: [{ itemId: "eggs", name: "eggs" }] }]);
    expect(s.updateKitchen).toEqual({ mealId: "meal1", title: "Omelette", items: [{ itemId: "eggs", name: "eggs" }] });
  });
});

describe("Meal ideas widget", () => {
  const state = kitchen([item("eggs", "eggs"), item("spinach", "spinach")]);

  it("shows name, why, Uses and Missing; the allergen badge says whose allergy and their note", async () => {
    const session = feed([idea("i1", "Spinach omelette", { uses: ["eggs", "spinach"], missing: ["feta"] }), idea("i2", "Shrimp tacos", { missing: ["shrimp"], allergenFlags: [SHRIMP_FLAG] })]);
    show(<MealIdeasWidget />, { state, session });
    const [first, second] = screen.getAllByRole("listitem");
    expect(within(first).getByRole("heading", { name: "Spinach omelette" })).toBeInTheDocument();
    expect(first).toHaveTextContent("Why Spinach omelette");
    expect(first).toHaveTextContent("Useseggs and spinach");
    expect(first).toHaveTextContent("Missingfeta");
    expect(within(first).queryByRole("button", { name: /^Allergy/ })).not.toBeInTheDocument();

    // The badge is quiet until tapped, but its name already carries the details (no advice, no "safe").
    const badge = within(second).getByRole("button", { name: /^Allergy: Contains shrimp: Levi's seafood allergy\./ });
    expect(badge).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(badge);
    expect(badge).toHaveAttribute("aria-expanded", "true");
    expect(second).toHaveTextContent("Contains shrimp: Levi's seafood allergy.");
    expect(second).toHaveTextContent("Their note: can eat shellfish if medicine is on hand");
    expect(second.textContent).not.toMatch(/safe/i);
  });

  it("Choose calls choose; a chosen card says Chosen and opens its recipe; a failed choose says so", async () => {
    const session = feed([idea("i1", "Spinach omelette"), idea("i2", "Soup")]);
    const chosenState = { ...state, meals: [meal("meal1", "Spinach omelette", "chosen", { ideaId: "i1" })] };
    const { actions } = show(<MealIdeasWidget />, { state: chosenState, session: mealsReducer(session, { type: "chooseFailed", ideaId: "i2" }) });
    const [first, second] = screen.getAllByRole("listitem");
    expect(first).toHaveTextContent("Chosen");
    await userEvent.click(within(first).getByRole("button", { name: "Open recipe: Spinach omelette" }));
    expect(actions.openRecipe).toHaveBeenCalledWith("meal1", { focus: true });
    expect(within(second).getByRole("alert")).toHaveTextContent("Couldn't choose that, so nothing changed.");
    await userEvent.click(within(second).getByRole("button", { name: "Choose Soup" }));
    expect(actions.choose).toHaveBeenCalledWith("i2");
  });

  it("shows 'Finding ideas…' before the first card", () => {
    show(<MealIdeasWidget />, { state, session: feed([{ type: "status", phase: "ideas" }]) });
    expect(screen.getByText("Finding ideas from your kitchen…")).toBeInTheDocument();
  });
});

describe("Recipe", () => {
  const omelette = meal("meal1", "Spinach omelette", "chosen", { allergenFlags: [] });
  const view: RecipeView = {
    id: "rec1",
    meal: { id: "meal1", title: "Spinach omelette" },
    version: 1,
    source: "ai",
    text: "",
    ingredients: [
      { name: "eggs", amount: "3", item: { id: "eggs", name: "eggs" } },
      { name: "feta", amount: "50 g" },
      { name: "shrimp" },
      { name: "salt", basic: true },
    ],
    steps: ["Whisk the eggs.", "Cook."],
    basicsAssumed: ["salt"],
    allergenFlags: [SHRIMP_FLAG],
    ...audit,
  };
  const state: KitchenState = {
    ...kitchen([item("eggs", "eggs")]),
    meals: [omelette],
    ticks: [{ meal: { id: "meal1", title: "Spinach omelette" }, ingredient: "feta", ...audit, createdBy: LEVI, updatedBy: LEVI }],
  };

  it("one checklist in two groups, amounts, who ticked, the allergy on its ingredient, the basics note, then steps", () => {
    show(<RecipeScreen mealId="meal1" initialRecipe={view} />, { state });
    expect(screen.getByRole("heading", { level: 2, name: "Spinach omelette" })).toBeInTheDocument();
    expect(screen.getByText("Suggested recipe")).toBeInTheDocument();
    const kitchenGroup = screen.getByRole("group", { name: "In your kitchen" });
    const need = screen.getByRole("group", { name: "Need" });
    expect(within(kitchenGroup).getAllByRole("checkbox").map((c) => c.getAttribute("aria-label"))).toEqual(["Eggs", "Salt"]);
    expect(kitchenGroup).toHaveTextContent("3");
    expect(within(need).getByRole("checkbox", { name: "Feta, ticked by Levi" })).toBeChecked();
    expect(need).toHaveTextContent("ticked by Levi");
    expect(need).toHaveTextContent("50 g");
    expect(within(need).getByRole("button", { name: /^Allergy: Contains shrimp/ })).toBeInTheDocument();
    expect(screen.getByText("Assumes salt. Tell me if you don't have them.")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Whisk the eggs.", "Cook."]);
    expect(screen.getByRole("button", { name: "Add to plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start cooking" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Done cooking" })).not.toBeInTheDocument();
  });

  it("a tick shows at once and is saved; a refused tick goes back and offers Retry", async () => {
    const tick = vi.fn(async (): Promise<ActionResult> => ({ ok: false, reason: { code: "STALE_TARGET", params: {}, text: "x" }, retryable: true }));
    const { actions } = show(<RecipeScreen mealId="meal1" initialRecipe={view} />, { state, actions: fakeMealActions({ tick }) });
    await userEvent.click(screen.getByRole("checkbox", { name: "Eggs" }));
    expect(actions.tick).toHaveBeenCalledWith("meal1", "eggs", true);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save that.");
    expect(screen.getByRole("checkbox", { name: "Eggs" })).not.toBeChecked();
  });

  it("Add Need items to shopping list, with Undo; Use my own recipe readies the chat", async () => {
    const kitchenActions = fakeActions({ undo: ok(state, "UNDONE") });
    const actions = fakeMealActions({ addNeedsToList: ok(state, "SHOPPING_ADDED") });
    show(<RecipeScreen mealId="meal1" initialRecipe={view} />, { state, actions, kitchenActions });
    await userEvent.click(screen.getByRole("button", { name: "Add Need items to shopping list" }));
    expect(actions.addNeedsToList).toHaveBeenCalledWith("meal1");
    expect(await screen.findByText("Added the Need items to your shopping list.", { ignore: '[data-testid="announcer"]' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Undo: added the Need items to your shopping list" }));
    expect(kitchenActions.undo).toHaveBeenCalled();
    expect(await screen.findByText("Undone. Your list is as it was.", { ignore: '[data-testid="announcer"]' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Use my own recipe" }));
    expect(actions.useOwnRecipe).toHaveBeenCalledWith("Spinach omelette");
  });

  it("while writing it says so and ticks wait; parts never saved become 'Try again'", async () => {
    const writing = feed([{ type: "recipe", mealId: "meal1", part: "ingredient", data: { index: 0, name: "eggs", amount: null, itemId: "eggs", group: "kitchen", allergenFlags: [] } }]);
    const { actions } = show(<RecipeScreen mealId="meal1" initialRecipe={null} />, { state, session: writing });
    expect(screen.getByText("Writing your recipe…")).toHaveAttribute("role", "status");
    expect(screen.getByRole("checkbox", { name: "Eggs" })).toBeDisabled();
    cleanup();

    show(<RecipeScreen mealId="meal1" initialRecipe={null} />, { state, session: mealsReducer(writing, { type: "streamEnded", key: "m1" }), actions });
    expect(screen.getByText("I couldn't finish the recipe, so nothing was saved.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(actions.retryRecipe).toHaveBeenCalledWith("meal1");
  });

  it("cooking: Done cooking goes back to the workspace and opens Update your kitchen", async () => {
    const cooking = { ...state, meals: [{ ...omelette, status: "cooking" as const }], plan: ["meal1"] };
    const finishCooking = vi.fn(async () => ({ ok: true as const, result: (saved(cooking) as { ok: true; result: never }).result, updateKitchen: { mealId: "meal1", title: "Spinach omelette", items: [{ itemId: "eggs", name: "eggs" }] } }));
    const { actions } = show(
      <>
        <RecipeScreen mealId="meal1" initialRecipe={view} />
        <UpdateKitchenSheet />
      </>,
      { state: cooking, actions: fakeMealActions({ finishCooking }) },
    );
    expect(screen.getByText("Cooking")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Done cooking" }));
    expect(actions.closeRecipe).toHaveBeenCalled();
    expect(await screen.findByRole("dialog", { name: "Update your kitchen" })).toHaveTextContent("Cooked: Spinach omelette");
  });
});

describe("Meal plan widget", () => {
  const state: KitchenState = {
    ...kitchen([]),
    meals: [meal("a", "Soup", "planned"), meal("b", "Omelette", "cooking", { createdBy: LEVI })],
    plan: ["a", "b"],
  };

  it("cooking meals first, labelled; each has its buttons; Levi's says so", () => {
    show(<MealPlanWidget />, { state });
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Omelette");
    expect(rows[0]).toHaveTextContent("Cooking");
    expect(rows[0]).toHaveTextContent("Added by Levi");
    expect(within(rows[0]).getByRole("button", { name: "Done cooking Omelette" })).toBeInTheDocument();
    expect(within(rows[1]).getByRole("button", { name: "Start cooking Soup" })).toBeInTheDocument();
    expect(within(rows[1]).getByRole("button", { name: "Cancel Soup" })).toBeInTheDocument();
  });

  it("Cancel leaves 'cancelled · Undo' in its place; Undo puts it back", async () => {
    const after = { ...state, meals: [state.meals[1]], plan: ["b"] };
    const actions = fakeMealActions({ cancel: ok(after, "MEAL_STATUS") });
    const kitchenActions = fakeActions({ undo: ok(state, "UNDONE") });
    // The plan re-renders with the state the cancel returned (as the app would).
    function Live() {
      const [s, setS] = useReducer((_: KitchenState, n: KitchenState) => n, state);
      const wired = { ...actions, showSaved: (r: { state: KitchenState }) => setS(r.state) } as MealActions;
      return (
        <Harness state={s} session={initialMealsSession} actions={wired} kitchenActions={kitchenActions}>
          <MealPlanWidget />
        </Harness>
      );
    }
    renderWithIntl(<Live />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel Soup" }));
    expect(await screen.findByText("Soup cancelled", { ignore: '[data-testid="announcer"]' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Undo: cancelled Soup" }));
    expect(await screen.findByRole("button", { name: "Start cooking Soup" })).toBeInTheDocument();
    expect(kitchenActions.undo).toHaveBeenCalled();
  });
});

describe("Update your kitchen sheet", () => {
  const prompt = { mealId: "meal1", title: "Spinach omelette", items: [{ itemId: "eggs", name: "eggs" }, { itemId: "spinach", name: "spinach" }] };
  const open = (reviewId?: string) => mealsReducer(initialMealsSession, { type: "openUpdateKitchen", request: { ...prompt, ...(reviewId ? { reviewId } : {}) } });

  it("each ingredient starts at Still have some; Done saves Running low / Out and the note, with Undo", async () => {
    const notices: (MealNotice | null)[] = [];
    const actions = fakeMealActions({ submitUpdateKitchen: ok(kitchen([]), "ITEM_LOW") });
    show(<UpdateKitchenSheet />, { session: open(), actions, onNotice: (n) => notices.push(n) });
    const sheet = screen.getByRole("dialog", { name: "Update your kitchen" });
    expect(sheet).toHaveTextContent("Cooked: Spinach omelette");
    const eggs = within(sheet).getByRole("radiogroup", { name: "Eggs" });
    const spinach = within(sheet).getByRole("radiogroup", { name: "Spinach" });
    expect(within(eggs).getByRole("radio", { name: "Still have some" })).toBeChecked();
    await userEvent.click(within(eggs).getByText("Running low"));
    await userEvent.click(within(spinach).getByText("Out"));
    await userEvent.type(within(sheet).getByRole("textbox", { name: /Anything to remember about what you used\?/ }), "Used the big pack");
    await userEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(actions.submitUpdateKitchen).toHaveBeenCalledWith({
      mealId: "meal1",
      items: [
        { itemId: "eggs", stock: "low" },
        { itemId: "spinach", stock: "out" },
      ],
      note: "Used the big pack",
    });
    expect(notices.at(-1)).toMatchObject({ text: "Updated your kitchen after Spinach omelette: 1 running low and 1 out.", undo: { label: "Undo: kitchen update after Spinach omelette" } });
  });

  it("Do later (and Esc) saves it to To review; Skip on a fresh sheet changes nothing", async () => {
    const actions = fakeMealActions({ updateKitchenLater: ok(kitchen([]), "REVIEW_QUEUED") });
    show(<UpdateKitchenSheet />, { session: open(), actions });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(actions.updateKitchenLater).toHaveBeenCalledWith({ mealId: "meal1", items: prompt.items }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    cleanup();

    const fresh = fakeMealActions();
    show(<UpdateKitchenSheet />, { session: open(), actions: fresh });
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fresh.skipUpdateKitchen).not.toHaveBeenCalled();
    expect(fresh.submitUpdateKitchen).not.toHaveBeenCalled();
  });

  it("from a To review card: Skip closes the card, Do later just closes, Done closes it in the same change", async () => {
    const actions = fakeMealActions({ skipUpdateKitchen: ok(kitchen([]), "REVIEW_RESOLVED"), submitUpdateKitchen: ok(kitchen([])) });
    show(<UpdateKitchenSheet />, { session: open("r1"), actions });
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(actions.skipUpdateKitchen).toHaveBeenCalledWith("r1"));
    cleanup();

    show(<UpdateKitchenSheet />, { session: open("r1"), actions });
    await userEvent.click(screen.getByRole("button", { name: "Do later" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(actions.updateKitchenLater).not.toHaveBeenCalled();
    cleanup();

    show(<UpdateKitchenSheet />, { session: open("r1"), actions });
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(actions.submitUpdateKitchen).toHaveBeenCalledWith(expect.objectContaining({ reviewId: "r1" })));
  });

  it("a failed Done keeps the sheet open with a plain error", async () => {
    show(<UpdateKitchenSheet />, { session: open() });
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Eggs" })).getByText("Out"));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't update your kitchen, so nothing changed.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("Choose stream and the Recipe URL", () => {
  const body = (lines: unknown[]) =>
    new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines.map((l) => JSON.stringify(l)).join("\n") + "\n")); c.close(); } }));

  it("passes every valid event on and says how it ended; never throws", async () => {
    const { streamChoose } = await import("@/ui/widgets/meals/choose-stream");
    const seen: string[] = [];
    const done = await streamChoose({
      kitchenId: "k1",
      key: "tap1",
      target: { ideaId: "i1" },
      onEvent: (e) => seen.push(e.type),
      fetchImpl: async () => body([{ type: "ack", turnId: "t", messageId: "m" }, { type: "bogus" }, { type: "done", turnId: "t", assistantMessageId: "t" }]),
    });
    expect(done).toBe("done");
    expect(seen).toEqual(["ack", "done"]);
    expect(await streamChoose({ kitchenId: "k1", key: "t2", target: { mealId: "m1" }, onEvent: () => {}, fetchImpl: async () => { throw new Error("offline"); } })).toBe("notSent");
    expect(await streamChoose({ kitchenId: "k1", key: "t3", target: { mealId: "m1" }, onEvent: () => {}, fetchImpl: async () => body([{ type: "ack", turnId: "t", messageId: "m" }]) })).toBe("cut");
  });

  it("reads the open meal from the URL", async () => {
    const { recipeMealId } = await import("@/ui/widgets/meals/useMealsController");
    expect(recipeMealId("/recipe/meal%201")).toBe("meal 1");
    expect(recipeMealId("/")).toBeNull();
    expect(recipeMealId("/recipe/")).toBeNull();
  });
});
