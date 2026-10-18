// @vitest-environment jsdom
/**
 * The dated week plan (0045 KOS1, 0058) and "Add this week's missing ingredients" (KOS12) on the
 * Plan place: the rolling 7-day week (all-undated kitchens too), the day pill (window limits,
 * No day, receipt with Undo, failures, offline), the week-needs sheet in every state, and plan
 * days formatted by locale in receipts.
 */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useReducer, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/app/actions";
import type { ApplyResult } from "@/contracts/apply-result";
import type { KitchenState, MealRow } from "@/contracts/kitchen-state";
import type { WeekNeeds } from "@/contracts/week-plan";
import { AnnouncerProvider } from "@/ui/a11y/Announcer";
import { formatPlanDay } from "@/ui/plan-day-format";
import { KitchenActionsProvider, type KitchenActions } from "@/ui/sync/KitchenActionsContext";
import { KitchenDataProvider } from "@/ui/sync/KitchenDataContext";
import { deviceTimeZone, withTimeZone } from "@/ui/sync/time-zone";
import { PlanPlace } from "@/ui/widgets/meals/MealPlanWidget";
import { RecipeScreen } from "@/ui/widgets/meals/RecipeScreen";
import { MealsProvider, type MealActions } from "@/ui/widgets/meals/MealsContext";
import { initialMealsSession, mealsReducer } from "@/ui/widgets/meals/session";
import { chosenNeedNames, dayOptions, noRecipeTitles, preselectedNeeds, relativeDay, undatedFirst } from "@/ui/widgets/meals/week-model";
import { buildWeekPlan } from "@/shared/week-plan";
import { fakeActions } from "../support/fake-actions";
import { fakeMealActions } from "../support/fake-meal-actions";
import { renderWithIntl } from "../support/intl";
import { kitchen, T0 } from "../support/kitchen-rows";

const ANA = { id: "ana", name: "Ana" };
// Friday Oct 16 at 16:00 UTC: Oct 16 in every zone from UTC−12 to UTC+7, so "today" is the same
// whatever zone the test machine is in.
const NOW = new Date("2026-10-16T16:00:00.000Z");
const TODAY = "2026-10-16";
const audit = { createdAt: T0, createdBy: ANA, updatedAt: T0, updatedBy: ANA };

const meal = (id: string, title: string, extra: Partial<MealRow> = {}): MealRow => ({
  id,
  title,
  status: "planned",
  chosenAt: T0,
  allergenFlags: [],
  ...audit,
  ...extra,
});

const planOf = (meals: MealRow[], version = 1): KitchenState => ({ ...kitchen([], version), meals, plan: meals.map((m) => m.id) });

let n = 0;
function applied(state: KitchenState, code: string, params: Record<string, string>, extra: Partial<ApplyResult> = {}): ActionResult {
  return {
    ok: true,
    result: {
      changeSetId: `cs-${++n}`,
      newVersion: state.version,
      undoable: true,
      applied: [{ opId: "op", summary: { code, params, text: code }, refs: [{ kind: "meal", id: "a", change: "updated" }] }],
      rejected: [],
      state,
      ...extra,
    },
  };
}

const refused: ActionResult = { ok: false, reason: { code: "SAVE_FAILED", params: {}, text: "x" }, retryable: true };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The Plan place with a live state: a saved change re-renders it, as the app does. */
function Live({ start, actions, kitchenActions, ui }: { start: KitchenState; actions: MealActions; kitchenActions: KitchenActions; ui?: ReactNode }) {
  const [state, setState] = useReducer((_: KitchenState, next: KitchenState) => next, start);
  const [session, dispatch] = useReducer(mealsReducer, initialMealsSession);
  const wired: MealActions = { ...actions, showSaved: (r) => setState(r.state) };
  const wiredKitchen: KitchenActions = { ...kitchenActions, showOwn: (r) => setState(r.state) };
  return (
    <AnnouncerProvider>
      <KitchenActionsProvider value={wiredKitchen}>
        <KitchenDataProvider value={{ me: ANA, snapshot: { state, status: "ok", syncedAt: NOW.getTime() }, marks: {}, remoteIds: new Set(), now: NOW, turn: 0 }}>
          <MealsProvider
            value={{
              session,
              dispatch,
              actions: wired,
              members: [{ userId: "ana", displayName: "Ana" }],
              notice: null,
              setNotice: () => {},
              openUpdateKitchen: () => {},
            }}
          >
            {ui ?? <PlanPlace />}
          </MealsProvider>
        </KitchenDataProvider>
      </KitchenActionsProvider>
    </AnnouncerProvider>
  );
}

function show(start: KitchenState, opts: { actions?: Partial<MealActions>; kitchen?: Partial<KitchenActions>; ui?: ReactNode } = {}) {
  const actions = fakeMealActions(opts.actions);
  const kitchenActions = fakeActions(opts.kitchen);
  renderWithIntl(<Live start={start} actions={actions} kitchenActions={kitchenActions} ui={opts.ui} />);
  return { actions, kitchenActions };
}

const plan = () => screen.getByRole("region", { name: "The next 7 days" });
const day = (date: string) => document.querySelector<HTMLElement>(`[data-day="${date}"]`)!;
const notAnnouncer = { ignore: '[data-testid="announcer"]' };

function setOnline(online: boolean) {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(online);
}

describe("week model (pure)", () => {
  it("relative days, the picker's window, and when No day yet leads", () => {
    expect(relativeDay("2026-10-16", TODAY)).toBe("today");
    expect(relativeDay("2026-10-17", TODAY)).toBe("tomorrow");
    expect(relativeDay("2026-10-15", TODAY)).toBe("yesterday");
    expect(relativeDay("2026-10-18", TODAY)).toBeNull();
    const week = buildWeekPlan(planOf([meal("a", "Soup")]), TODAY);
    const days = dayOptions(week.window);
    expect(days[0]).toBe("2026-10-15");
    expect(days.at(-1)).toBe("2026-11-06");
    expect(days).toHaveLength(23);
    expect(undatedFirst(week)).toBe(true);
    expect(undatedFirst(buildWeekPlan(planOf([meal("a", "Soup"), meal("b", "Pho", { plannedFor: "2026-10-30" })]), TODAY))).toBe(false);
  });

  it("week needs: pre-selects what isn't on the list; Add sends recipe names; meals with no recipe", () => {
    const needs: WeekNeeds = {
      from: TODAY,
      to: "2026-10-22",
      includeUndated: true,
      meals: [
        { mealId: "a", title: "Curry", hasRecipe: true },
        { mealId: "b", title: "Tacos", hasRecipe: false },
      ],
      items: [
        { name: "Coconut milk", standardName: "coconut milk", meals: [{ mealId: "a", title: "Curry" }], onList: false },
        { name: "fish sauce", standardName: "fish sauce", meals: [{ mealId: "a", title: "Curry" }], onList: true },
      ],
    };
    const selected = preselectedNeeds(needs);
    expect([...selected]).toEqual(["coconut milk"]);
    expect(chosenNeedNames(needs, new Set(["coconut milk", "fish sauce"]))).toEqual(["Coconut milk"]);
    expect(noRecipeTitles(needs)).toEqual(["Tacos"]);
  });

  it("formats a plan day by locale, never shifted by a time zone", () => {
    expect(formatPlanDay("2026-10-20", "en", "short")).toBe("Tue, Oct 20");
    expect(formatPlanDay("2026-10-20", "en", "long")).toBe("Tuesday, October 20");
    expect(formatPlanDay("2026-10-20", "fr", "long")).toBe("mardi 20 octobre");
    expect(formatPlanDay("not a day", "en")).toBe("not a day");
  });

  it("the device time zone goes with each request", () => {
    expect(deviceTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(withTimeZone()).toEqual({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  });
});

describe("week view", () => {
  it("an all-undated kitchen (every kitchen before KOS1): No day yet leads, then 7 quiet days with Today marked", () => {
    show(planOf([meal("a", "Soup"), meal("b", "Pho")]));
    const undated = screen.getByRole("region", { name: "No day yet" });
    expect(undated).toHaveTextContent("Pick a day on a meal to put it in the week.");
    expect(within(undated).getAllByRole("button", { name: /: open recipe$/ }).map((b) => b.textContent)).toEqual(["Soup", "Pho"]);
    // It comes before the week.
    expect(undated.compareDocumentPosition(plan()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const days = within(plan()).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(days).toEqual([
      "Today, Friday, October 16",
      "Tomorrow, Saturday, October 17",
      "Sunday, October 18",
      "Monday, October 19",
      "Tuesday, October 20",
      "Wednesday, October 21",
      "Thursday, October 22",
    ]);
    expect(day(TODAY)).toHaveAttribute("data-today");
    expect(within(plan()).getAllByText("Nothing planned")).toHaveLength(7);
    expect(screen.queryByRole("region", { name: "Earlier" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Later" })).not.toBeInTheDocument();
  });

  it("dated meals sit on their day; Earlier and Later only when they have meals; No day yet goes last", () => {
    show(
      planOf([
        meal("a", "Soup", { plannedFor: "2026-10-18" }),
        meal("b", "Pho", { plannedFor: "2026-10-15" }),
        meal("c", "Tacos", { plannedFor: "2026-10-30" }),
        meal("d", "Omelette", { status: "cooking", plannedFor: "2026-10-18" }),
        meal("e", "Salad"),
      ]),
    );
    const sunday = day("2026-10-18");
    expect(within(sunday).getAllByRole("button", { name: /: open recipe$/ }).map((b) => b.textContent)).toEqual(["Omelette", "Soup"]);
    expect(sunday).toHaveTextContent("Cooking");
    expect(screen.getByRole("region", { name: "Earlier" })).toHaveTextContent("Pho");
    expect(screen.getByRole("region", { name: "Later" })).toHaveTextContent("Tacos");
    const undated = screen.getByRole("region", { name: "No day yet" });
    expect(undated).toHaveTextContent("Salad");
    expect(undated).not.toHaveTextContent("Pick a day on a meal");
    expect(plan().compareDocumentPosition(undated) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(plan()).getAllByText("Nothing planned")).toHaveLength(6);
    // The pill names the day.
    expect(screen.getByRole("button", { name: "Day for Soup: Sunday, October 18. Change it" })).toHaveTextContent("Sun, Oct 18");
  });

  it("an empty plan keeps the calm empty state (no week, no week-needs pill)", () => {
    show(planOf([]));
    expect(screen.getByText("Nothing planned yet.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "The next 7 days" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add this week's missing ingredients" })).not.toBeInTheDocument();
  });
});

describe("day control", () => {
  it("offers only the plan window (yesterday to 3 weeks ahead) plus No day", async () => {
    show(planOf([meal("a", "Soup")]));
    await userEvent.click(screen.getByRole("button", { name: "Pick a day for Soup" }));
    const group = await screen.findByRole("group", { name: "Which day?" });
    const options = within(group).getAllByRole("menuitemradio");
    expect(options).toHaveLength(24);
    expect(options[0]).toHaveTextContent("Yesterday · Thu, Oct 15");
    expect(options[1]).toHaveTextContent("Today · Fri, Oct 16");
    expect(options[2]).toHaveTextContent("Tomorrow · Sat, Oct 17");
    expect(options[22]).toHaveTextContent("Fri, Nov 6");
    expect(options[23]).toHaveTextContent("No day");
    expect(options[23]).toHaveAttribute("aria-checked", "true");
  });

  it("setting a day moves the meal into the week, with the receipt (day by locale) and Undo, focus on it", async () => {
    const start = planOf([meal("a", "Soup")]);
    const after = planOf([meal("a", "Soup", { plannedFor: "2026-10-17" })], 2);
    const setMealDate = vi.fn(async () => applied(after, "MEAL_DATE_SET", { title: "Soup", date: "2026-10-17", day: "(English label)" }));
    const undo = vi.fn(async () => applied(start, "UNDONE", {}));
    const { kitchenActions } = show(start, { actions: { setMealDate }, kitchen: { undo } });

    await userEvent.click(screen.getByRole("button", { name: "Pick a day for Soup" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: /^Tomorrow/ }));
    expect(setMealDate).toHaveBeenCalledWith("a", "2026-10-17");

    const tomorrow = day("2026-10-17");
    expect(await within(tomorrow).findByRole("button", { name: "Soup: open recipe" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "No day yet" })).not.toBeInTheDocument();
    const receipt = within(tomorrow).getByRole("region", { name: "What changed" });
    expect(receipt).toHaveTextContent("Moved Soup to Sat, Oct 17");
    await waitFor(() => expect(tomorrow.querySelector("[data-day-note]")).toHaveFocus());

    await userEvent.click(within(receipt).getByRole("button", { name: /^Undo/ }));
    expect(kitchenActions.undo).toHaveBeenCalled();
    expect(await screen.findByRole("region", { name: "No day yet" })).toHaveTextContent("Soup");
  });

  it("No day clears it (null)", async () => {
    const start = planOf([meal("a", "Soup", { plannedFor: "2026-10-17" })]);
    const setMealDate = vi.fn(async () => applied(planOf([meal("a", "Soup")], 2), "MEAL_DATE_CLEARED", { title: "Soup", date: "", day: "" }));
    show(start, { actions: { setMealDate } });
    await userEvent.click(screen.getByRole("button", { name: "Day for Soup: Saturday, October 17. Change it" }));
    expect(await screen.findByRole("menuitemradio", { name: /^Tomorrow/ })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("menuitemradio", { name: "No day" }));
    expect(setMealDate).toHaveBeenCalledWith("a", null);
    expect(await screen.findByText("Soup: no day set", notAnnouncer)).toBeInTheDocument();
  });

  it("picking the day it already has sends nothing", async () => {
    const setMealDate = vi.fn(async () => refused);
    show(planOf([meal("a", "Soup", { plannedFor: TODAY })]), { actions: { setMealDate } });
    await userEvent.click(screen.getByRole("button", { name: /^Day for Soup/ }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: /^Today/ }));
    expect(setMealDate).not.toHaveBeenCalled();
  });

  it("a refusal from the server (out of the window) shows in the receipt, by locale", async () => {
    const start = planOf([meal("a", "Soup")]);
    const setMealDate = vi.fn(
      async (): Promise<ActionResult> => ({
        ok: true,
        result: {
          changeSetId: "cs-out",
          newVersion: 1,
          undoable: false,
          applied: [],
          rejected: [{ opId: "date", reason: { code: "DATE_OUT_OF_WINDOW", params: { title: "Soup", date: "2026-10-14", day: "x" }, text: "x" } }],
          state: start,
        },
      }),
    );
    show(start, { actions: { setMealDate } });
    await userEvent.click(screen.getByRole("button", { name: "Pick a day for Soup" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: /^Yesterday/ }));
    expect(await screen.findByText(/Wed, Oct 14 is outside the plan\. Pick a day from yesterday to 3 weeks ahead\./, notAnnouncer)).toBeInTheDocument();
  });

  it("a failed save says so in place and changes nothing", async () => {
    show(planOf([meal("a", "Soup")]), { actions: { setMealDate: vi.fn(async () => refused) } });
    await userEvent.click(screen.getByRole("button", { name: "Pick a day for Soup" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: /^Tomorrow/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't change the day, so nothing changed. Try again.");
    expect(screen.getByRole("region", { name: "No day yet" })).toHaveTextContent("Soup");
  });

  it("on a chosen meal's Recipe, Plan for a day plans it for that day, with the receipt and Undo there", async () => {
    const start = planOf([]);
    start.meals = [meal("a", "Soup", { status: "chosen" })];
    const after = planOf([meal("a", "Soup", { plannedFor: "2026-10-17" })], 2);
    const addToPlan = vi.fn(async () => applied(after, "MEAL_PLANNED_FOR", { title: "Soup", date: "2026-10-17", day: "x" }));
    show(start, { actions: { addToPlan }, ui: <RecipeScreen mealId="a" initialRecipe={null} /> });
    await userEvent.click(screen.getByRole("button", { name: "Plan Soup for a day" }));
    const options = await screen.findAllByRole("menuitemradio");
    expect(options).toHaveLength(23); // the window, and no "No day" for a meal not yet planned
    await userEvent.click(screen.getByRole("menuitemradio", { name: /^Tomorrow/ }));
    expect(addToPlan).toHaveBeenCalledWith("a", "2026-10-17");
    const note = await waitFor(() => document.querySelector<HTMLElement>("[data-plan-note]")!);
    expect(within(note).getByRole("region", { name: "What changed" })).toHaveTextContent("Planned Soup for Sat, Oct 17");
    expect(within(note).getByRole("button", { name: /^Undo/ })).toBeInTheDocument();
  });

  it("offline: the week still shows; the day pill and the week-needs pill are off, and say why", () => {
    setOnline(false);
    show(planOf([meal("a", "Soup", { plannedFor: "2026-10-18" })]));
    expect(within(day("2026-10-18")).getByRole("button", { name: "Soup: open recipe" })).toBeInTheDocument();
    const pill = screen.getByRole("button", { name: /^Day for Soup/ });
    expect(pill).toBeDisabled();
    expect(pill).toHaveAccessibleDescription("Back online to change days");
    const needs = screen.getByRole("button", { name: "Add this week's missing ingredients" });
    expect(needs).toBeDisabled();
    expect(needs).toHaveAccessibleDescription("Back online to add ingredients");
  });
});

describe("Add this week's missing ingredients (KOS12)", () => {
  const start = planOf([meal("a", "Curry", { plannedFor: "2026-10-18" }), meal("b", "Tacos")]);
  const needs = (extra: Partial<WeekNeeds> = {}): WeekNeeds => ({
    from: TODAY,
    to: "2026-10-22",
    includeUndated: true,
    meals: [
      { mealId: "a", title: "Curry", plannedFor: "2026-10-18", hasRecipe: true },
      { mealId: "b", title: "Tacos", hasRecipe: false },
    ],
    items: [
      { name: "coconut milk", standardName: "coconut milk", meals: [{ mealId: "a", title: "Curry" }], onList: false },
      { name: "lemongrass", standardName: "lemongrass", meals: [{ mealId: "a", title: "Curry" }], onList: false },
      { name: "fish sauce", standardName: "fish sauce", meals: [{ mealId: "a", title: "Curry" }, { mealId: "c", title: "Pho" }], onList: true },
    ],
    ...extra,
  });
  const openSheet = async () => {
    await userEvent.click(screen.getByRole("button", { name: "Add this week's missing ingredients" }));
    return screen.findByRole("dialog", { name: "This week's missing ingredients" });
  };

  it("loading, then Missing pre-selected with their meals, On your list muted, the no-recipe note", async () => {
    let resolve!: (v: WeekNeeds) => void;
    const loadWeekNeeds = vi.fn(() => new Promise<WeekNeeds | null>((r) => (resolve = r)));
    show(start, { actions: { loadWeekNeeds } });
    const sheet = await openSheet();
    expect(sheet.querySelector("[aria-busy=true]")).toHaveTextContent("Checking your recipes…");
    expect(loadWeekNeeds).toHaveBeenCalledWith({ includeUndated: true });
    await act(async () => resolve(needs()));

    const missing = within(sheet).getByRole("group", { name: "Missing" });
    expect(within(missing).getByRole("checkbox", { name: "Coconut milk, for Curry, add to list" })).toBeChecked();
    expect(within(missing).getByRole("checkbox", { name: "Lemongrass, for Curry, add to list" })).toBeChecked();
    const onList = within(sheet).getByRole("region", { name: "On your list" });
    expect(onList).toHaveTextContent("Fish sauce");
    expect(onList).toHaveTextContent("For Curry and Pho");
    expect(within(onList).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(sheet).toHaveTextContent("Tacos has no recipe yet, so its ingredients aren't here.");
    expect(within(sheet).getByRole("button", { name: "Add 2 to my list" })).toBeEnabled();
  });

  it("Add N to my list: one change set, the sheet closes, the receipt with Undo under the pill takes focus", async () => {
    const addWeekNeedsToList = vi.fn(async () => applied(start, "SHOPPING_ADDED", { name: "lemongrass" }));
    const undo = vi.fn(async () => applied(start, "UNDONE", {}));
    const { kitchenActions } = show(start, { actions: { loadWeekNeeds: vi.fn(async () => needs()), addWeekNeedsToList }, kitchen: { undo } });
    const sheet = await openSheet();
    await userEvent.click(await within(sheet).findByRole("checkbox", { name: /^Coconut milk/ }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Add 1 to my list" }));
    expect(addWeekNeedsToList).toHaveBeenCalledWith({ includeUndated: true, names: ["lemongrass"] });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Regression: the popup must stay drawn while closing, or Base UI never finishes and its
    // backdrop stays over the page, swallowing every tap (found by the e2e run).
    await waitFor(() => expect(document.querySelector(".bg-scrim")).not.toBeInTheDocument());
    const note = document.querySelector<HTMLElement>("[data-week-needs-note]")!;
    await waitFor(() => expect(note).toHaveFocus());
    await userEvent.click(within(note).getByRole("button", { name: /^Undo/ }));
    expect(kitchenActions.undo).toHaveBeenCalled();
  });

  it("Dated only reloads without undated meals", async () => {
    const loadWeekNeeds = vi.fn(async ({ includeUndated }: { includeUndated: boolean }) =>
      includeUndated ? needs() : needs({ includeUndated: false, meals: [needs().meals[0]] }),
    );
    show(start, { actions: { loadWeekNeeds } });
    const sheet = await openSheet();
    await within(sheet).findByRole("group", { name: "Missing" });
    const toggle = within(sheet).getByRole("switch", { name: "Dated only" });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    expect(loadWeekNeeds).toHaveBeenLastCalledWith({ includeUndated: false });
    await waitFor(() => expect(sheet).not.toHaveTextContent("Tacos has no recipe yet"));
    expect(sheet).toHaveTextContent("From meals planned for the next 7 days.");
  });

  it("a load that fails shows Retry; Retry loads again", async () => {
    const loadWeekNeeds = vi.fn<MealActions["loadWeekNeeds"]>(async () => null);
    show(start, { actions: { loadWeekNeeds } });
    const sheet = await openSheet();
    expect(await within(sheet).findByText("Couldn't check what's missing.")).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /to my list/ })).not.toBeInTheDocument();
    loadWeekNeeds.mockResolvedValueOnce(needs());
    await userEvent.click(within(sheet).getByRole("button", { name: "Retry" }));
    expect(await within(sheet).findByRole("group", { name: "Missing" })).toBeInTheDocument();
  });

  it("empty states: no meals in the week; everything in the kitchen; everything already on the list", async () => {
    const loadWeekNeeds = vi.fn<MealActions["loadWeekNeeds"]>(async () => needs({ meals: [], items: [] }));
    show(start, { actions: { loadWeekNeeds } });
    let sheet = await openSheet();
    expect(await within(sheet).findByText("No meals planned for the next 7 days.")).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /to my list/ })).not.toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Close" }));

    loadWeekNeeds.mockResolvedValueOnce(needs({ items: [] }));
    sheet = await openSheet();
    expect(await within(sheet).findByText("You have what these meals need.")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Close" }));

    loadWeekNeeds.mockResolvedValueOnce(needs({ items: [needs().items[2]] }));
    sheet = await openSheet();
    expect(await within(sheet).findByText("Everything missing is already on your list.")).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /to my list/ })).not.toBeInTheDocument();
  });

  it("add failed: says so, keeps the choices, Try again", async () => {
    const addWeekNeedsToList = vi.fn(async () => refused);
    show(start, { actions: { loadWeekNeeds: vi.fn(async () => needs()), addWeekNeedsToList } });
    const sheet = await openSheet();
    await userEvent.click(await within(sheet).findByRole("checkbox", { name: /^Coconut milk/ }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Add 1 to my list" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Couldn't add those, so nothing changed.");
    expect(within(sheet).getByRole("checkbox", { name: /^Coconut milk/ })).not.toBeChecked();
    await userEvent.click(within(sheet).getByRole("button", { name: "Try again" }));
    expect(addWeekNeedsToList).toHaveBeenCalledTimes(2);
  });

  it("WEEK_NEEDS_NONE (it all got on the list meanwhile): says so and refreshes", async () => {
    const loadWeekNeeds = vi.fn<MealActions["loadWeekNeeds"]>(async () => needs());
    const addWeekNeedsToList = vi.fn(async (): Promise<ActionResult> => ({ ok: false, reason: { code: "WEEK_NEEDS_NONE", params: {}, text: "x" }, retryable: false }));
    show(start, { actions: { loadWeekNeeds, addWeekNeedsToList } });
    const sheet = await openSheet();
    await within(sheet).findByRole("group", { name: "Missing" });
    loadWeekNeeds.mockResolvedValueOnce(needs({ items: needs().items.map((i) => ({ ...i, onList: true })) }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Add 2 to my list" }));
    expect(await within(sheet).findByRole("status")).toHaveTextContent("Nothing left to add: it's all on your list or in your kitchen.");
    expect(await within(sheet).findByText("Everything missing is already on your list.")).toBeInTheDocument();
    expect(within(sheet).queryByRole("alert")).not.toBeInTheDocument();
  });
});
