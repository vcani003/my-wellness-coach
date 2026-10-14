/**
 * Meal actions in chat (0005, 0013): "the second one", "the omelette", "add that to my meal
 * plan", "start cooking", "I made it", and "what can I make?" / "no oven". The model names a
 * label (d2 = an idea card, m1 = a meal) or "last_chosen"; code resolves it, never the model:
 * - "last_chosen" ("that", "it") = the meal THIS user chose most recently, within 3 hours (0005).
 *   None → "Which one?" with quick replies.
 * - "I made it" with exactly one meal cooking = that meal.
 * - Code adds the follow-ups after apply: the recipe for a just-chosen meal (R2), plan/cook a
 *   just-chosen idea, and "Update your kitchen" after done (0013: UI, not the model).
 */
import type { Clarification } from "@/contracts/proposed-change";
import type { KitchenState, MealRow } from "@/contracts/kitchen-state";
import type { Operation } from "@/contracts/operations";
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

function resolve(label: string | null, req: InterpretRequest, now: Date, action: ModelOp["action"]): Target {
  const l = label?.trim() ?? "";
  const idea = ideaLabels(req).get(l);
  if (idea) return { kind: "idea", ...idea };
  const mealId = mealLabels(req.state).get(l);
  const meal = mealId ? req.state.meals.find((m) => m.id === mealId) : undefined;
  if (meal) return { kind: "meal", meal };
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

export interface MealOutcome {
  operations: Operation[];
  followUps: TurnFollowUp[];
  clarification?: Clarification;
}

export function mealOperations(out: ModelOutput, req: InterpretRequest, now: Date): MealOutcome {
  const operations: Operation[] = [];
  const followUps: TurnFollowUp[] = [];
  let clarification: Clarification | undefined;
  const ask = (c: Clarification) => (clarification ??= c);

  out.operations.forEach((op, i) => {
    if (!op.action.startsWith("meal_")) return;
    const opId = `${req.message.id}:meal${i + 1}`;
    const evidence = op.evidence.trim() ? { evidence: op.evidence.trim().slice(0, 2000) } : {};
    const t = resolve(op.meal, req, now, op.action);
    if (t.kind === "none") return void ask(whichOne(req, WHICH_MEAL));

    if (t.kind === "idea") {
      if (op.action === "meal_done") return void ask(whichOne(req, WHICH_MEAL));
      operations.push({ opId, type: "meal.choose", target: { ideaId: t.ideaId }, ...evidence });
      // Choosing opens a suggested recipe by default (R2), unless this idea's meal already has one.
      const existing = req.state.meals.find((m) => m.ideaId === t.ideaId && ACTIVE.has(m.status));
      if (!existing?.recipe) followUps.push({ kind: "recipe", meal: { chooseOpId: opId } });
      if (op.action === "meal_plan") followUps.push({ kind: "meal-step", meal: { chooseOpId: opId }, to: "planned" });
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
        operations.push({ opId, type: "meal.plan", target: { mealId: meal.id }, ...evidence });
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
  return { operations, followUps, ...(clarification ? { clarification } : {}) };
}
