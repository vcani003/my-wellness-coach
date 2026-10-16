/**
 * Meal actions in chat (0005, 0013): "the second one", "the omelette", "add that to my meal
 * plan", "start cooking", "I made it", and "what can I make?" / "no oven". The model names a
 * label (d2 = an idea card, m1 = a meal) or "last_chosen"; code resolves it, never the model:
 * - "last_chosen" ("that", "it") = the meal THIS user chose most recently, within 3 hours (0005).
 *   None → "Which one?" with quick replies.
 * - "I made it" with exactly one meal cooking = that meal.
 * - Code adds the follow-ups after apply: the recipe for a just-chosen meal (R2), plan/cook a
 *   just-chosen idea, and "Update your kitchen" after done (0013: UI, not the model).
 * - A dish the user names ("I was thinking a chicken curry…", MI1 Rec, 0013 M1) is chosen
 *   directly: `meal.choose {title, notes}` and its recipe, with no idea cards in between. It
 *   becomes an idea or meal pick when its name matches one, and ideas when they ask for others.
 */
import type { Clarification } from "@/contracts/proposed-change";
import type { KitchenState, MealRow } from "@/contracts/kitchen-state";
import type { Operation } from "@/contracts/operations";
import { nameTokens, standardName } from "@/shared/text";
import { WEEKDAY_NAMES, addDays, isIsoDay, resolveDay, weekdayOf } from "@/shared/plan-dates";
import type { InterpretRequest, TurnFollowUp } from "../interpreter";
import type { ModelOp, ModelOutput } from "./model-output";

export const LAST_CHOSEN_WINDOW_MS = 3 * 60 * 60 * 1000;

export const WHICH_MEAL = "Which one?";
export const WHICH_RECIPE = "Which recipe should I change?";

/** m1, m2… for meals in progress, in KitchenState order (shown in <kitchen>). */
export function mealLabels(state: KitchenState): Map<string, string> {
  return new Map(state.meals.map((m, i) => [`m${i + 1}`, m.id]));
}

/** d1, d2… for the idea cards this user was last shown (shown in <meal_ideas>). */
export function ideaLabels(req: InterpretRequest): Map<string, { ideaId: string; name: string }> {
  return new Map((req.ideas ?? []).map((idea, i) => [`d${i + 1}`, idea]));
}

const ACTIVE = new Set(["chosen", "planned", "cooking"]);

/** The meal this user chose most recently, if within the window (0005). */
export function lastChosenMeal(req: InterpretRequest, now: Date): MealRow | undefined {
  return req.state.meals
    .filter((m) => ACTIVE.has(m.status) && !("missing" in m.createdBy) && m.createdBy.id === req.userId)
    .filter((m) => now.getTime() - Date.parse(m.chosenAt) <= LAST_CHOSEN_WINDOW_MS)
    .sort((a, b) => Date.parse(b.chosenAt) - Date.parse(a.chosenAt))[0];
}

type Target = { kind: "idea"; ideaId: string; name: string } | { kind: "meal"; meal: MealRow } | { kind: "none" };

/**
 * A meal or idea named by its dish ("the curry") instead of a label: the one live meal (else idea
 * card) whose title has every word said. Two or more → none, so the caller asks "Which one?".
 */
function byTitle(said: string, req: InterpretRequest): Target {
  const words = nameTokens(said.replace(/^(the|my|our)\s+/i, ""));
  if (words.length === 0) return { kind: "none" };
  const fits = (title: string) => sameDish(title, said) || words.every((w) => nameTokens(title).includes(w));
  const meals = req.state.meals.filter((m) => ACTIVE.has(m.status) && fits(m.title));
  if (meals.length === 1) return { kind: "meal", meal: meals[0] };
  if (meals.length > 1) return { kind: "none" };
  const ideas = (req.ideas ?? []).filter((i) => fits(i.name));
  return ideas.length === 1 ? { kind: "idea", ...ideas[0] } : { kind: "none" };
}

function resolve(label: string | null, req: InterpretRequest, now: Date, action: ModelOp["action"]): Target {
  const l = label?.trim() ?? "";
  const idea = ideaLabels(req).get(l);
  if (idea) return { kind: "idea", ...idea };
  const mealId = mealLabels(req.state).get(l);
  const meal = mealId ? req.state.meals.find((m) => m.id === mealId) : undefined;
  if (meal) return { kind: "meal", meal };
  if (l && l !== "last_chosen" && !/^[dm]\d+$/.test(l)) return byTitle(l, req);
  if (l === "last_chosen" || l === "") {
    if (action === "meal_done") {
      const cooking = req.state.meals.filter((m) => m.status === "cooking");
      if (cooking.length === 1) return { kind: "meal", meal: cooking[0] };
    }
    const last = lastChosenMeal(req, now);
    if (last) return { kind: "meal", meal: last };
  }
  return { kind: "none" };
}

function whichOne(req: InterpretRequest, question: string, filter: (m: MealRow) => boolean = () => true): Clarification {
  const options = [
    ...req.state.meals.filter((m) => ACTIVE.has(m.status) && filter(m)).map((m) => m.title),
    ...(question === WHICH_MEAL ? (req.ideas ?? []).map((i) => i.name) : []),
  ]
    .filter((t, i, all) => all.indexOf(t) === i)
    .slice(0, 4)
    .map((t) => ({ label: t.slice(0, 200), reply: t.slice(0, 500) }));
  return { question, options };
}

export const WHICH_DAY = "Which day?";

/** "Which day?" with the next few days as one-tap replies that say the whole thing again. */
function whichDay(title: string, action: ModelOp["action"], today: string): Clarification {
  const name = title.trim().slice(0, 120);
  const label = (n: number) => (n === 0 ? "Today" : n === 1 ? "Tomorrow" : WEEKDAY_NAMES[weekdayOf(addDays(today, n))]);
  const options = [0, 1, 2, 3].map((n) => {
    const day = label(n);
    const when = n < 2 ? day.toLowerCase() : day;
    return { label: day, reply: action === "meal_date" ? `Move ${name} to ${when}` : `Plan ${name} for ${when}` };
  });
  return { question: WHICH_DAY, options };
}

export interface MealOutcome {
  operations: Operation[];
  followUps: TurnFollowUp[];
  clarification?: Clarification;
}

/** "Or something else?", "any other ideas?": the user wants options, not just the dish they named. */
export const WANTS_ALTERNATIVES =
  /\b(or something else|something else|any (other )?ideas|other ideas|what else|other options|or anything|suggestions?)\b/i;

/** Words saying the user has it, so an ingredient they mention is a kitchen add (MI1). */
const HAS_IT = /\b(have|has|got|bought|picked up|grabbed)\b/i;

const sameDish = (a: string, b: string) => {
  if (standardName(a) === standardName(b)) return true;
  const ta = nameTokens(a);
  const tb = new Set(nameTokens(b));
  return ta.length > 0 && ta.length === tb.size && ta.every((t) => tb.has(t));
};

/**
 * Ingredients said as part of a named dish ("with coconut milk, lemongrass") are not kitchen adds
 * unless the user says they have them (MI1). Drops an `item.add` whose words are inside the
 * dish's own words, or whose name is in the dish notes, when those words don't say "have / got".
 */
export function guardDishIngredients(ops: Operation[], out: ModelOutput, req: InterpretRequest): Operation[] {
  const dish = out.dish;
  if (!dish?.title.trim()) return ops;
  const text = req.message.text.toLowerCase();
  const dishWords = dish.evidence.trim().toLowerCase();
  const dishSpan = dishWords && text.includes(dishWords) ? dishWords : "";
  const notes = ` ${standardName(dish.notes ?? "")} `;
  return ops.filter((o) => {
    if (o.type !== "item.add") return true;
    const evidence = (o.evidence ?? "").trim().toLowerCase();
    if (evidence && HAS_IT.test(evidence)) return true;
    const insideDish = dishSpan !== "" && evidence !== "" && dishSpan.includes(evidence);
    const tokens = nameTokens(o.fields.name.value);
    const inNotes = tokens.length > 0 && tokens.every((t) => notes.includes(` ${t} `));
    return !(insideDish || inNotes);
  });
}

/** The named dish (MI1): an idea or meal pick when it matches one, else a new chosen meal. */
function dishOperations(out: ModelOutput, req: InterpretRequest, ops: Operation[], followUps: TurnFollowUp[]): void {
  const dish = out.dish;
  const title = dish?.title.trim().replace(/\s+/g, " ").slice(0, 200) ?? "";
  if (!dish || !title) return;
  // Already picked an idea or meal in this message, or already asked for ideas.
  if (ops.some((o) => o.type === "meal.choose") || followUps.some((f) => f.kind === "ideas")) return;
  const text = req.message.text.trim();
  if (WANTS_ALTERNATIVES.test(text)) {
    followUps.push({ kind: "ideas", request: text });
    return;
  }
  const opId = `${req.message.id}:dish`;
  const said = dish.evidence.trim();
  const evidence = { evidence: (said && text.toLowerCase().includes(said.toLowerCase()) ? said : text).slice(0, 2000) };
  const notes = dish.notes?.trim().slice(0, 2000) || undefined;

  const idea = (req.ideas ?? []).find((i) => sameDish(i.name, title));
  if (idea) {
    ops.push({ opId, type: "meal.choose", target: { ideaId: idea.ideaId }, ...evidence });
    const existing = req.state.meals.find((m) => m.ideaId === idea.ideaId && ACTIVE.has(m.status));
    if (!existing?.recipe) followUps.push({ kind: "recipe", meal: { chooseOpId: opId }, ...(notes ? { notes } : {}) });
    return;
  }
  const meal = req.state.meals.find((m) => ACTIVE.has(m.status) && sameDish(m.title, title));
  if (meal) {
    ops.push({ opId, type: "meal.choose", target: { mealId: meal.id }, ...evidence });
    if (!meal.recipe) followUps.push({ kind: "recipe", meal: { mealId: meal.id }, ...(notes ? { notes } : {}) });
    return;
  }
  ops.push({ opId, type: "meal.choose", target: { title, ...(notes ? { notes } : {}) }, ...evidence });
  followUps.push({ kind: "recipe", meal: { chooseOpId: opId }, ...(notes ? { notes } : {}) });
}

export function mealOperations(out: ModelOutput, req: InterpretRequest, now: Date): MealOutcome {
  const operations: Operation[] = [];
  const followUps: TurnFollowUp[] = [];
  let clarification: Clarification | undefined;
  const ask = (c: Clarification) => (clarification ??= c);

  const today = req.today && isIsoDay(req.today) ? req.today : now.toISOString().slice(0, 10);

  out.operations.forEach((op, i) => {
    if (!op.action.startsWith("meal_")) return;
    const opId = `${req.message.id}:meal${i + 1}`;
    const evidence = op.evidence.trim() ? { evidence: op.evidence.trim().slice(0, 2000) } : {};
    const t = resolve(op.meal, req, now, op.action);
    if (t.kind === "none") return void ask(whichOne(req, WHICH_MEAL));

    // KOS1: the day as said, resolved here from the message's own day (never by the model).
    // Said but not one day ("next week") → ask which day; nothing is planned on a guess.
    const said = op.when?.trim() ?? "";
    const date = said ? resolveDay(said, today) : null;
    const dated = op.action === "meal_plan" || op.action === "meal_date";
    if (dated && (said ? !date : op.action === "meal_date")) {
      return void ask(whichDay(t.kind === "idea" ? t.name : t.meal.title, op.action, today));
    }
    const day = dated && date ? { date } : {};

    if (t.kind === "idea") {
      if (op.action === "meal_done" || op.action === "meal_clear_date") return void ask(whichOne(req, WHICH_MEAL));
      operations.push({ opId, type: "meal.choose", target: { ideaId: t.ideaId }, ...evidence });
      // Choosing opens a suggested recipe by default (R2), unless this idea's meal already has one.
      const existing = req.state.meals.find((m) => m.ideaId === t.ideaId && ACTIVE.has(m.status));
      if (!existing?.recipe) followUps.push({ kind: "recipe", meal: { chooseOpId: opId } });
      if (dated) followUps.push({ kind: "meal-step", meal: { chooseOpId: opId }, to: "planned", ...day });
      if (op.action === "meal_start_cooking") followUps.push({ kind: "meal-step", meal: { chooseOpId: opId }, to: "cooking" });
      return;
    }

    const meal = t.meal;
    switch (op.action) {
      case "meal_choose":
        operations.push({ opId, type: "meal.choose", target: { mealId: meal.id }, ...evidence });
        if (!meal.recipe) followUps.push({ kind: "recipe", meal: { mealId: meal.id } });
        return;
      case "meal_plan":
        operations.push({ opId, type: "meal.plan", target: { mealId: meal.id }, ...day, ...evidence });
        return;
      case "meal_date":
        operations.push({ opId, type: "meal.date", target: { mealId: meal.id }, date: date!, ...evidence });
        return;
      case "meal_clear_date":
        operations.push({ opId, type: "meal.date", target: { mealId: meal.id }, date: null, ...evidence });
        return;
      case "meal_start_cooking":
        operations.push({ opId, type: "meal.transition", target: { mealId: meal.id }, to: "cooking", ...evidence });
        return;
      case "meal_done":
        operations.push({ opId, type: "meal.transition", target: { mealId: meal.id }, to: "done", ...evidence });
        followUps.push({ kind: "after-cooking", mealId: meal.id });
        return;
    }
  });

  const g = out.generate;
  if (g?.what === "ideas") {
    followUps.push({ kind: "ideas", request: req.message.text.trim() });
  } else if (g?.what === "recipe_change") {
    const t = resolve(g.meal, req, now, "meal_choose");
    // Only a meal that has a recipe can be refined; the most recently chosen one with a recipe wins.
    const meal =
      t.kind === "meal" && t.meal.recipe
        ? t.meal
        : req.state.meals
            .filter((m) => m.recipe && ACTIVE.has(m.status) && !("missing" in m.createdBy) && m.createdBy.id === req.userId)
            .sort((a, b) => Date.parse(b.chosenAt) - Date.parse(a.chosenAt))[0];
    if (meal) followUps.push({ kind: "recipe", meal: { mealId: meal.id }, refine: req.message.text.trim() });
    else ask(whichOne(req, WHICH_RECIPE, (m) => Boolean(m.recipe)));
  }
  dishOperations(out, req, operations, followUps);
  return { operations, followUps, ...(clarification ? { clarification } : {}) };
}
