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

/**
 * The idea card a named dish means: the same name, or else the ONE card whose name has every word
 * of the dish ("the curry" → "Lemongrass chicken potato coconut curry"). Two such cards → none.
 */
function matchingIdea(req: InterpretRequest, title: string) {
  const ideas = req.ideas ?? [];
  const exact = ideas.find((i) => sameDish(i.name, title));
  if (exact) return exact;
  const words = nameTokens(title);
  if (words.length === 0) return undefined;
  const loose = ideas.filter((i) => {
    const t = new Set(nameTokens(i.name));
    return words.every((w) => t.has(w));
  });
  return loose.length === 1 ? loose[0] : undefined;
}

/**
 * Words asking to cook it or get its recipe, not only to change the idea: "make the curry without
 * yogurt", "let's cook the first one with tofu", "the recipe for…". "Make it vegetarian" alone
 * is a change to the idea.
 */
export const WANTS_RECIPE =
  /\b(cook|cooking|recipe|let'?s (make|cook|do|have|go with)|(want|going) to (make|cook)|make\b[^.?!]*?\b(without|with|using|minus|but)\b)/i;

/**
 * Words changing what's in a dish ("remove the yogurt", "swap the chicken for tofu"). Not
 * "instead" or "switch" alone: "the second one instead" / "switch to the second one" are picks.
 */
export const CHANGES_A_DISH =
  /\b(remove|take (\w+ )?out|leave (\w+ )?out|without|swap|substitute|replace|instead of|refine|tweak|don'?t (want|use)|dont (want|use)|no more)\b/i;

/** Whether the message names an ingredient on this card ("the yogurt" on the curry card). */
function namesCardIngredient(req: InterpretRequest, ideaId: string): boolean {
  const card = (req.ideas ?? []).find((i) => i.ideaId === ideaId);
  const words = new Set(nameTokens(req.message.text));
  return [...(card?.uses ?? []), ...(card?.missing ?? [])].some((name) => nameTokens(name).some((w) => words.has(w)));
}

/**
 * A change to an idea card with no recipe yet (ai.md §5 "Refining an idea"):
 * - only changing it ("remove the yogurt from the curry") edits the card in place: no choose, no
 *   recipe, no navigation, even if the model also picked the card (the miss Vero saw);
 * - asking to cook it with the change ("make the curry without yogurt") chooses it and writes the
 *   recipe with the user's words as its notes, so the recipe honours the change. The card then
 *   follows the recipe (follow-ups.ts `ideaFollowsRecipe`).
 * `refined`: the idea the model routed a change to (generate.recipe_change on its d-label), if any.
 */
function settleIdeaChanges(req: InterpretRequest, refined: string | null, ops: Operation[], followUps: TurnFollowUp[]): { operations: Operation[]; followUps: TurnFollowUp[] } {
  const text = req.message.text.trim();
  const wantsRecipe = WANTS_RECIPE.test(text);
  const changes = CHANGES_A_DISH.test(text);
  let operations = ops;
  let follows = followUps;
  const hasRecipe = (ideaId: string) => req.state.meals.some((m) => m.ideaId === ideaId && ACTIVE.has(m.status) && m.recipe);
  const refineIdeas = new Set<string>();

  for (const op of ops) {
    if (op.type !== "meal.choose" || !("ideaId" in op.target)) continue;
    const ideaId = op.target.ideaId;
    // A plain pick stays a pick. Without the model's recipe_change, it's a change only when the
    // message changes the dish AND names something on that card (not "I don't want the first one").
    if (hasRecipe(ideaId) || (ideaId !== refined && !(changes && namesCardIngredient(req, ideaId)))) continue;
    if (wantsRecipe) {
      follows = follows.map((f) =>
        f.kind === "recipe" && "chooseOpId" in f.meal && f.meal.chooseOpId === op.opId && !f.notes ? { ...f, notes: text.slice(0, 2000) } : f,
      );
      continue;
    }
    operations = operations.filter((o) => o.opId !== op.opId && !o.opId.startsWith(`${op.opId}:`));
    follows = follows.filter((f) => !("meal" in f && typeof f.meal === "object" && "chooseOpId" in f.meal && f.meal.chooseOpId === op.opId));
    refineIdeas.add(ideaId);
  }

  if (refined && !hasRecipe(refined) && !ops.some((o) => o.type === "meal.choose" && "ideaId" in o.target && o.target.ideaId === refined)) {
    if (wantsRecipe) {
      const opId = `${req.message.id}:idea-choose`;
      operations = [...operations, { opId, type: "meal.choose", target: { ideaId: refined }, evidence: text.slice(0, 2000) }];
      follows = [...follows, { kind: "recipe", meal: { chooseOpId: opId }, notes: text.slice(0, 2000) }];
    } else {
      refineIdeas.add(refined);
    }
  }
  for (const ideaId of refineIdeas) follows = [...follows, { kind: "idea-refine", ideaId, request: text }];
  return { operations, followUps: follows };
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

  const idea = matchingIdea(req, title);
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
  let refinedIdea: string | null = null;
  const changedIdea = g?.what === "recipe_change" ? ideaLabels(req).get(g.meal?.trim() ?? "") : undefined;
  if (g?.what === "ideas") {
    followUps.push({ kind: "ideas", request: req.message.text.trim() });
  } else if (changedIdea) {
    // A change to an idea card (ai.md §5): its meal's recipe when it has one (edit mode), else the card.
    const meal = req.state.meals.find((m) => m.ideaId === changedIdea.ideaId && ACTIVE.has(m.status) && m.recipe);
    if (meal) followUps.push({ kind: "recipe", meal: { mealId: meal.id }, refine: req.message.text.trim() });
    else refinedIdea = changedIdea.ideaId;
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
  const settled = settleIdeaChanges(req, refinedIdea, operations, followUps);
  return { ...settled, ...(clarification ? { clarification } : {}) };
}
