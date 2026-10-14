/**
 * What a turn does AFTER apply (backend-data.md §6, ai.md §1 build notes): meal ideas, the recipe,
 * and "Update your kitchen". Code decides these (`InterpretResult.followUps`), never the model.
 * Everything that saves still goes through `applyProposedChange` (0003): ideas are stored with
 * `recordMealIdeas`, a recipe only through its `recipe.save`.
 *
 * Each step is isolated (0018): a failure is logged and becomes a short reply; what already
 * saved stays saved, and the turn still ends with `done`.
 */
import type { Db } from "@/db/client";
import type { ApplyResult } from "@/contracts/apply-result";
import type { Operation } from "@/contracts/operations";
import type { KitchenState, RecipeView } from "@/contracts/kitchen-state";
import type { ProposalSource } from "@/contracts/proposed-change";
import type { StreamEvent } from "@/contracts/stream";
import { applyProposedChange, dropIdeaSet, recordMealIdeas, updateKitchenPrompt } from "@/domains/kitchen/commands";
import {
  getIdea,
  getIdeaSet,
  getKitchenState,
  getMealProfileContext,
  getRecipe,
  wasApplied,
} from "@/domains/kitchen/queries";
import type { KitchenScope } from "@/shared/membership";
import type { MealPointer, TurnFollowUp } from "./interpreter";
import { basicsNote } from "./meals/basics";
import type { MealAI, MealContext, RecipeIngredientOut, RecipeInput, RecipePart } from "./meals";

export const FOLLOW_UP_FAILED_REPLY = "Sorry, I couldn't finish that just now. What I saved is still saved.";
export const IDEAS_AGAIN_REPLY = "Here are the ideas again.";

export interface FollowUpDeps {
  db: Db;
  scope: KitchenScope;
  meals: MealAI;
}

/** Where a follow-up's writes come from: the chat message, or a button tap (Choose). */
export interface FollowUpOrigin {
  /** Idempotency base: the client message ID or the tap ID. */
  id: string;
  source: ProposalSource;
  /** The typed message, for evidence (chat only). */
  text?: string;
  history?: MealContext["history"];
  /** Saved reply's ID, if known, to link stored idea sets to it. */
  assistantMessageId?: string;
}

/** Each step yields stream events and returns its reply line ("" = none). */
type Step = AsyncGenerator<StreamEvent, string>;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

function mealIdOf(pointer: MealPointer, result: ApplyResult | null): string | null {
  if ("mealId" in pointer) return pointer.mealId;
  const op = result?.applied.find((a) => a.opId === pointer.chooseOpId);
  return op?.refs.find((r) => r.kind === "meal")?.id ?? null;
}

async function mealContext(deps: FollowUpDeps, origin: FollowUpOrigin, state?: KitchenState): Promise<MealContext> {
  const [fresh, profile] = await Promise.all([
    state ? Promise.resolve(state) : getKitchenState(deps.db, deps.scope),
    getMealProfileContext(deps.db, deps.scope),
  ]);
  return {
    kitchenId: deps.scope.kitchenId,
    userId: deps.scope.userId,
    state: fresh,
    members: profile.members,
    restrictions: profile.restrictions,
    preferences: profile.preferences,
    history: origin.history ?? [],
  };
}

// ─── Ideas ──────────────────────────────────────────────────────────────────────────────

/**
 * Stream ideas, storing each card as it arrives (so its Choose works at once), in card order.
 * The set ID comes from the origin, so a retried message shows the stored set again instead of
 * paying for new ideas. A set that fails part-way is removed (`ideas.dropped`).
 */
async function* ideasStep(deps: FollowUpDeps, origin: FollowUpOrigin, request: string): Step {
  const setId = `${origin.id}:ideas`;
  const stored = await getIdeaSet(deps.db, deps.scope, setId);
  if (stored) {
    for (const idea of stored.ideas) yield { type: "idea", setId, basedOnVersion: stored.basedOnVersion, idea };
    return IDEAS_AGAIN_REPLY;
  }

  yield { type: "status", phase: "ideas" };
  const ctx = await mealContext(deps, origin);
  const basedOnVersion = ctx.state.version;
  let position = 0;
  for await (const ev of deps.meals.streamMealIdeas({
    ...ctx,
    request: request.trim() ? { messageId: origin.id, text: request } : null,
  })) {
    if (ev.type === "idea") {
      try {
        const { ideas } = await recordMealIdeas(deps.db, deps.scope, {
          setId,
          basedOnVersion,
          ...(origin.assistantMessageId ? { assistantMessageId: origin.assistantMessageId } : {}),
          ideas: [{ name: ev.idea.name, why: ev.idea.why, uses: ev.idea.uses, missing: ev.idea.missing, position }],
        });
        position++;
        yield { type: "idea", setId, basedOnVersion, idea: ideas[0] };
      } catch (error) {
        // A card that couldn't be stored can't be chosen, so it isn't shown (0018).
        console.error("turn.ideas: couldn't store an idea", { setId, error });
      }
      continue;
    }
    const result = ev.result;
    if (!result.ok) {
      if (position > 0) {
        await dropIdeaSet(deps.db, deps.scope, setId);
        yield { type: "ideas.dropped", setId };
      }
      return result.reply;
    }
    if (result.notes.length) yield { type: "notes", notes: result.notes };
    return result.reply;
  }
  return "";
}

// ─── Recipe ─────────────────────────────────────────────────────────────────────────────

const group = (i: RecipeView["ingredients"][number]): RecipeIngredientOut["group"] =>
  i.item && !("missing" in i.item) ? "kitchen" : i.basic ? "basic" : "need";

function toIngredientOut(i: RecipeView["ingredients"][number], flags: RecipeView["allergenFlags"]): RecipeIngredientOut {
  return {
    name: i.name,
    amount: i.amount ?? null,
    itemId: i.item && !("missing" in i.item) ? i.item.id : null,
    group: group(i),
    allergenFlags: flags.filter((f) => f.ingredient === i.name),
  };
}

/** A saved recipe as the same `recipe` parts a fresh one streams (a retry, or Choose on a meal that has one). */
export function recipeParts(view: RecipeView, title: string): RecipePart[] {
  return [
    { part: "meta", data: { title, summary: "", servings: null, source: view.source, allergenFlags: view.allergenFlags } },
    ...view.ingredients.map((i, index) => ({ part: "ingredient" as const, data: { ...toIngredientOut(i, view.allergenFlags), index } })),
    ...view.steps.map((text, index) => ({ part: "step" as const, data: { index, text } })),
    { part: "basics", data: { basics: view.basicsAssumed, note: basicsNote(view.basicsAssumed) } },
  ];
}

async function* savedRecipe(deps: FollowUpDeps, mealId: string, title: string, newVersion: number): AsyncGenerator<StreamEvent, boolean> {
  const view = await getRecipe(deps.db, deps.scope, mealId);
  if (!view) return false;
  for (const p of recipeParts(view, title)) yield { type: "recipe", mealId, part: p.part, data: p.data };
  yield { type: "recipe.saved", mealId, recipeId: view.id, version: view.version, newVersion };
  return true;
}

/**
 * Write the recipe for a meal (R2: suggested by default) or a new version of it (`refine`), stream
 * its parts, then apply its `recipe.save` and send `recipe.saved`. Parts with no `recipe.saved`
 * after them were not saved (a failure part-way): the UI drops them at `done`.
 */
export async function* recipeStep(
  deps: FollowUpDeps,
  origin: FollowUpOrigin,
  mealId: string,
  refine?: string,
): Step {
  const proposalId = `${origin.id}:recipe:${mealId}`;
  const state = await getKitchenState(deps.db, deps.scope);
  const meal = state.meals.find((m) => m.id === mealId);
  if (!meal) return "";
  if (await wasApplied(deps.db, deps.scope, proposalId)) {
    // A retried message: show what was saved rather than writing (and paying for) another.
    yield* savedRecipe(deps, mealId, meal.title, state.version);
    return "";
  }

  yield { type: "status", phase: "recipe" };
  const ctx = await mealContext(deps, origin, state);
  const idea = meal.ideaId ? await getIdea(deps.db, deps.scope, meal.ideaId) : null;
  const input: RecipeInput = { ...ctx, meal: { mealId, title: meal.title, ...(idea ? { idea } : {}) } };
  if (refine) {
    const current = await getRecipe(deps.db, deps.scope, mealId);
    if (current) {
      input.refine = {
        messageId: origin.id,
        text: refine,
        current: { title: meal.title, servings: null, steps: current.steps, ingredients: current.ingredients.map((i) => toIngredientOut(i, current.allergenFlags)) },
      };
    }
  }

  for await (const ev of deps.meals.streamRecipe(input)) {
    if (ev.type === "part") {
      yield { type: "recipe", mealId, part: ev.part, data: ev.data };
      continue;
    }
    const result = ev.result;
    if (!result.ok) return result.reply;
    const operation = {
      ...result.operation,
      ...(origin.source.via === "chat" && !result.operation.evidence ? { evidence: clip(origin.text?.trim() || meal.title, 2000) } : {}),
    };
    const outcome = await applyProposedChange(
      deps.db,
      deps.scope,
      { proposalId, kitchenId: deps.scope.kitchenId, basedOnVersion: state.version, source: origin.source, operations: [operation] },
      origin.text !== undefined ? { messageText: origin.text } : {},
    );
    const saved = outcome.ok ? outcome.result.applied.find((a) => a.opId === operation.opId) : undefined;
    const recipeId = saved?.refs.find((r) => r.kind === "recipe")?.id;
    if (!outcome.ok || !saved || !recipeId) {
      console.error("turn.recipe: recipe.save didn't apply", {
        mealId,
        reason: outcome.ok ? outcome.result.rejected : outcome.error,
      });
      return "Sorry, I couldn't save that recipe, so nothing changed.";
    }
    const version = Number(saved.summary.params.version ?? 1);
    yield { type: "recipe.saved", mealId, recipeId, version, newVersion: outcome.result.newVersion };
    if (result.notes.length) yield { type: "notes", notes: result.notes };
    return result.reply;
  }
  return "";
}

// ─── Running them ───────────────────────────────────────────────────────────────────────

/**
 * Run a turn's follow-ups in order, after apply. `meal-step` is not handled here: the turn folds
 * it into the main proposal (`foldMealSteps`), so choosing and planning are one change set.
 * Steps whose meal didn't apply are skipped. Returns the reply lines, in order.
 */
export async function* runFollowUps(
  deps: FollowUpDeps,
  origin: FollowUpOrigin,
  followUps: TurnFollowUp[],
  result: ApplyResult | null,
): AsyncGenerator<StreamEvent, string[]> {
  const replies: string[] = [];
  for (const f of followUps) {
    try {
      let reply = "";
      switch (f.kind) {
        case "ideas":
          reply = yield* ideasStep(deps, origin, f.request);
          break;
        case "recipe": {
          const mealId = mealIdOf(f.meal, result);
          if (mealId) reply = yield* recipeStep(deps, origin, mealId, f.refine);
          break;
        }
        case "after-cooking": {
          const prompt = result ? await updateKitchenPrompt(deps.db, deps.scope, result, f.mealId) : null;
          if (prompt) yield { type: "update-kitchen", ...prompt };
          break;
        }
        case "meal-step":
          break; // folded into the main proposal
      }
      if (reply) replies.push(reply);
    } catch (error) {
      console.error("turn.followUp: failed", { kind: f.kind, error });
      replies.push(FOLLOW_UP_FAILED_REPLY);
    }
  }
  return replies;
}

/**
 * "Plan the omelette" while it's only an idea card: the interpreter proposes `meal.choose` and a
 * `meal-step` follow-up (the meal has no ID yet). Fold the step into the SAME proposal as
 * `meal.plan` / `meal.transition` on `{ideaId}`, which the validator resolves to the meal the
 * choose just created. One change set, so one receipt and one Undo.
 */
export function foldMealSteps(operations: Operation[], followUps: TurnFollowUp[], text: string): { operations: Operation[]; followUps: TurnFollowUp[] } {
  const ops = [...operations];
  const rest: TurnFollowUp[] = [];
  for (const f of followUps) {
    if (f.kind !== "meal-step") {
      rest.push(f);
      continue;
    }
    const choose = ops.find((o) => o.opId === f.meal.chooseOpId && o.type === "meal.choose");
    if (!choose || choose.type !== "meal.choose") continue;
    const target = choose.target;
    const evidence = choose.evidence ?? clip(text.trim(), 2000);
    const opId = `${choose.opId}:step`;
    ops.push(
      f.to === "planned"
        ? { opId, type: "meal.plan", target, ...(evidence ? { evidence } : {}) }
        : { opId, type: "meal.transition", target, to: "cooking", ...(evidence ? { evidence } : {}) },
    );
  }
  return { operations: ops, followUps: rest };
}
