"use server";
/**
 * Server actions: UI buttons that run on the server (backend-data.md §6). Each one re-checks
 * the session and membership, then goes through the same validate → apply path as chat.
 */
import { cookies } from "next/headers";
import { z } from "zod";
import type { ApplyResult } from "@/contracts/apply-result";
import type { Msg } from "@/contracts/common";
import type { RecipeView } from "@/contracts/kitchen-state";
import type { UpdateKitchenPrompt } from "@/contracts/stream";
import { getMeals, handleChooseMeal } from "@/ai";
import { getRecipe } from "@/domains/kitchen/queries";
import { checkChatRateLimit } from "@/lib/rate-limit";
import { Id, Quantity, ShoppingSource, StockLevel } from "@/contracts/common";
import { ShoppingDoneFields } from "@/contracts/operations";
import {
  addRecipeNeedsToShoppingList,
  addShoppingItems,
  doneShopping,
  makeMealAgain,
  moveMeal,
  planMeal,
  queueAfterCooking,
  tickIngredient,
  updateKitchenAfterCooking,
  updateKitchenPrompt,
  queueShoppingReview,
  removeShoppingItem,
  resolveReview,
  setStockLevel,
  tickShoppingItem,
  undo,
} from "@/domains/kitchen/commands";
import { DEV_ACTING_AS_COOKIE, isDevActingAsOn } from "@/server/dev-mode";
import { getScope, getSession, resetDemoKitchen } from "@/server/session";
import { msg } from "@/shared/messages";

export type ActionResult = { ok: true; result: ApplyResult } | { ok: false; reason: Msg; retryable: boolean };

const UndoInput = z.object({ kitchenId: Id, changeSetId: Id, tapId: Id, basedOnVersion: z.number().int().nonnegative() });

/** Undo one of your own change sets (H3, 0017). `tapId` makes a double tap harmless. */
export async function undoChange(input: z.input<typeof UndoInput>): Promise<ActionResult> {
  const parsed = UndoInput.safeParse(input);
  if (!parsed.success) return { ok: false, reason: msg("INVALID_PROPOSAL"), retryable: false };
  const ctx = await getScope(parsed.data.kitchenId);
  if (!ctx) return { ok: false, reason: msg("NOT_ALLOWED"), retryable: false };
  const outcome = await undo(ctx.db, ctx.scope, parsed.data);
  return outcome.ok ? { ok: true, result: outcome.result } : { ok: false, ...outcome.error };
}

// ─── Shopping list (0027) ─────────────────────────────────────────────────────────────

const Tap = { kitchenId: Id, tapId: Id, basedOnVersion: z.number().int().nonnegative() };
const ShoppingItemInput = z.object({ ...Tap, shoppingItemId: Id });
const AddShoppingInput = z.object({
  ...Tap,
  source: ShoppingSource,
  items: z
    .array(z.object({ name: z.string().min(1).max(200), quantity: Quantity.optional(), store: z.string().min(1).max(100).optional() }))
    .min(1)
    .max(50),
});
const DoneShoppingInput = z.object({
  ...Tap,
  items: z.array(z.object({ shoppingItemId: Id, fields: ShoppingDoneFields.optional() })).min(1).max(100),
});

const ShoppingIds = z.array(Id).min(1).max(100);
const QueueShoppingInput = z.object({ ...Tap, shoppingItemIds: ShoppingIds });
const ResolveReviewInput = z.object({
  ...Tap,
  reviewId: Id,
  outcome: z.enum(["done", "skipped"]),
  shoppingItemIds: ShoppingIds.optional(),
});

/** Parse, re-check membership, run the command; never throws to the UI (0018). */
async function run<S extends z.ZodType<{ kitchenId: string }>>(
  schema: S,
  input: unknown,
  command: (ctx: NonNullable<Awaited<ReturnType<typeof getScope>>>, data: z.infer<S>) => ReturnType<typeof undo>,
): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: msg("INVALID_PROPOSAL"), retryable: false };
  try {
    const ctx = await getScope(parsed.data.kitchenId);
    if (!ctx) return { ok: false, reason: msg("NOT_ALLOWED"), retryable: false };
    const outcome = await command(ctx, parsed.data);
    return outcome.ok ? { ok: true, result: outcome.result } : { ok: false, ...outcome.error };
  } catch (error) {
    console.error("actions: action failed", { error });
    return { ok: false, reason: msg("SAVE_FAILED"), retryable: true };
  }
}

/** One-tap adds to the shopping list: staples, a recipe's "Need" items, the Out/Low offer (SL3). */
export async function addToShoppingList(input: z.input<typeof AddShoppingInput>): Promise<ActionResult> {
  return run(AddShoppingInput, input, (ctx, d) => addShoppingItems(ctx.db, ctx.scope, d));
}

/** Tick = "got it" (0027). Shared: the other member sees who ticked it. */
export async function tickShoppingListItem(input: z.input<typeof ShoppingItemInput>): Promise<ActionResult> {
  return run(ShoppingItemInput, input, (ctx, d) => tickShoppingItem(ctx.db, ctx.scope, { ...d, ticked: true }));
}

export async function untickShoppingListItem(input: z.input<typeof ShoppingItemInput>): Promise<ActionResult> {
  return run(ShoppingItemInput, input, (ctx, d) => tickShoppingItem(ctx.db, ctx.scope, { ...d, ticked: false }));
}

export async function removeShoppingListItem(input: z.input<typeof ShoppingItemInput>): Promise<ActionResult> {
  return run(ShoppingItemInput, input, (ctx, d) => removeShoppingItem(ctx.db, ctx.scope, d));
}

/** "Done shopping" (SL2): the chosen ticked items go into the kitchen in one change set (one Undo). */
export async function finishShopping(input: z.input<typeof DoneShoppingInput>): Promise<ActionResult> {
  return run(DoneShoppingInput, input, (ctx, d) => doneShopping(ctx.db, ctx.scope, d));
}

/** "Do later" on the Done-shopping sheet: the chosen items wait in the Kitchen's To review. */
export async function queueShoppingForLater(input: z.input<typeof QueueShoppingInput>): Promise<ActionResult> {
  return run(QueueShoppingInput, input, (ctx, d) => queueShoppingReview(ctx.db, ctx.scope, d));
}

/** Add or Skip on a To review card's sheet. A shopping-list card's Add is "Done shopping" for its items. */
export async function resolveToReview(input: z.input<typeof ResolveReviewInput>): Promise<ActionResult> {
  return run(ResolveReviewInput, input, (ctx, d) => resolveReview(ctx.db, ctx.scope, d));
}

// ─── Stock levels (0045 KOS4) ─────────────────────────────────────────────────────────

const StockLevelInput = z.object({ ...Tap, itemId: Id, batchId: Id.optional(), level: StockLevel });

/**
 * The level buttons: Plenty · Some · Low · Out. Without `batchId` it sets the whole item (every
 * open batch); with one, only that batch. One change set with "What changed" and Undo. Low and
 * Out offer "Add X to my list" (`offersListAdd`, SL3); Plenty and Some never do.
 */
export async function setItemStockLevel(input: z.input<typeof StockLevelInput>): Promise<ActionResult> {
  return run(StockLevelInput, input, (ctx, d) => setStockLevel(ctx.db, ctx.scope, d));
}

// ─── Meals (0005, 0013) ───────────────────────────────────────────────────────────────

const MealInput = z.object({ ...Tap, mealId: Id });
const ChooseInput = z.union([
  z.object({ kitchenId: Id, tapId: Id, ideaId: Id }),
  z.object({ kitchenId: Id, tapId: Id, mealId: Id }),
]);

export type ChooseMealResult =
  | {
      ok: true;
      /** The choose's receipt ("Chose Spinach omelette"). */
      result: ApplyResult;
      mealId: string;
      /** The saved recipe (suggested now, or the one it already had); null if writing it failed. */
      recipe: RecipeView | null;
      /** e.g. BASICS_ASSUMED. */
      notes: Msg[];
      /** Short line from the recipe step, e.g. why it failed. May be "". */
      reply: string;
    }
  | { ok: false; reason: Msg; retryable: boolean };

/**
 * Choose on an idea card (or a meal): creates the meal (status "chosen") and returns it with its
 * recipe, suggested by default (R2). The same steps as `POST /api/meals/choose`, which streams
 * them instead; use that route to show the recipe as it's written.
 */
export async function chooseMeal(input: z.input<typeof ChooseInput>): Promise<ChooseMealResult> {
  const parsed = ChooseInput.safeParse(input);
  if (!parsed.success) return { ok: false, reason: msg("INVALID_PROPOSAL"), retryable: false };
  try {
    const ctx = await getScope(parsed.data.kitchenId);
    if (!ctx) return { ok: false, reason: msg("NOT_ALLOWED"), retryable: false };
    const limit = await checkChatRateLimit(ctx.db, ctx.session.userId);
    if (!limit.ok) return { ok: false, reason: limit.reason, retryable: true };
    const target = "ideaId" in parsed.data ? { ideaId: parsed.data.ideaId } : { mealId: parsed.data.mealId };
    let result: ApplyResult | null = null;
    let reply = "";
    const notes: Msg[] = [];
    for await (const e of handleChooseMeal({ db: ctx.db, scope: ctx.scope, meals: getMeals() }, { clientMessageId: parsed.data.tapId, target })) {
      if (e.type === "applied") result = e.result;
      else if (e.type === "notes") notes.push(...e.notes);
      else if (e.type === "text") reply += e.delta;
      else if (e.type === "error") return { ok: false, reason: e.reason, retryable: e.retryable && !e.changed };
    }
    const mealId = result?.applied[0]?.refs.find((r) => r.kind === "meal")?.id;
    if (!result || !mealId) return { ok: false, reason: result?.rejected[0]?.reason ?? msg("UNKNOWN_TARGET"), retryable: false };
    const recipe = await getRecipe(ctx.db, ctx.scope, mealId);
    return { ok: true, result, mealId, recipe, notes, reply };
  } catch (error) {
    console.error("actions: chooseMeal failed", { error });
    return { ok: false, reason: msg("SAVE_FAILED"), retryable: true };
  }
}

const MakeAgainInput = z.object({ ...Tap, fromMealId: Id });

export type MakeAgainResult =
  | {
      ok: true;
      /** The receipt ("Making Chicken curry again"), with one Undo. */
      result: ApplyResult;
      /** The new meal (status "chosen"). */
      mealId: string;
      /** Its v1 recipe, copied from the cooked one, flagged against today's allergies; null if the old meal had none. */
      recipe: RecipeView | null;
    }
  | {
      ok: false;
      reason: Msg;
      retryable: boolean;
      /** RBX1: this dish's made-again copy is still in the plan (`ALREADY_MAKING`); open it instead. */
      activeMealId?: string;
    };

/**
 * "Make again" from Cooked before (0040 C): a new chosen meal whose recipe copies the cooked
 * version, refinable as usual. The old meal is never changed. No AI call, so no rate limit.
 */
export async function makeAgain(input: z.input<typeof MakeAgainInput>): Promise<MakeAgainResult> {
  const parsed = MakeAgainInput.safeParse(input);
  if (!parsed.success) return { ok: false, reason: msg("INVALID_PROPOSAL"), retryable: false };
  try {
    const ctx = await getScope(parsed.data.kitchenId);
    if (!ctx) return { ok: false, reason: msg("NOT_ALLOWED"), retryable: false };
    const outcome = await makeMealAgain(ctx.db, ctx.scope, parsed.data);
    if (!outcome.ok) return { ok: false, ...outcome.error };
    const mealId = outcome.result.applied[0]?.refs.find((r) => r.kind === "meal" && r.change === "added")?.id;
    if (!mealId) {
      const reason = outcome.result.rejected[0]?.reason ?? msg("UNKNOWN_TARGET");
      const active = reason.code === "ALREADY_MAKING" ? reason.params.mealId : undefined;
      return { ok: false, reason, retryable: false, ...(typeof active === "string" ? { activeMealId: active } : {}) };
    }
    const recipe = await getRecipe(ctx.db, ctx.scope, mealId).catch((error) => {
      console.error("actions: makeAgain couldn't read the new recipe", { error });
      return null;
    });
    return { ok: true, result: outcome.result, mealId, recipe };
  } catch (error) {
    console.error("actions: makeAgain failed", { error });
    return { ok: false, reason: msg("SAVE_FAILED"), retryable: true };
  }
}

/** "Add to meal plan" (0008: a short list, no dates). */
export async function addMealToPlan(input: z.input<typeof MealInput>): Promise<ActionResult> {
  return run(MealInput, input, (ctx, d) => planMeal(ctx.db, ctx.scope, d));
}

export async function startCooking(input: z.input<typeof MealInput>): Promise<ActionResult> {
  return run(MealInput, input, (ctx, d) => moveMeal(ctx.db, ctx.scope, { ...d, to: "cooking" }));
}

/** Cancel never changes the kitchen (0013). */
export async function cancelMeal(input: z.input<typeof MealInput>): Promise<ActionResult> {
  return run(MealInput, input, (ctx, d) => moveMeal(ctx.db, ctx.scope, { ...d, to: "cancelled" }));
}

export type FinishCookingResult =
  | { ok: true; result: ApplyResult; updateKitchen: UpdateKitchenPrompt | null }
  | { ok: false; reason: Msg; retryable: boolean };

/**
 * "I made it": the meal is done and its in-kitchen ingredients are recorded as used (0013).
 * `updateKitchen` is what to ask on the "Update your kitchen" sheet (same as the chat event).
 */
export async function finishCooking(input: z.input<typeof MealInput>): Promise<FinishCookingResult> {
  const parsed = MealInput.safeParse(input);
  if (!parsed.success) return { ok: false, reason: msg("INVALID_PROPOSAL"), retryable: false };
  try {
    const ctx = await getScope(parsed.data.kitchenId);
    if (!ctx) return { ok: false, reason: msg("NOT_ALLOWED"), retryable: false };
    const outcome = await moveMeal(ctx.db, ctx.scope, { ...parsed.data, to: "done" });
    if (!outcome.ok) return { ok: false, ...outcome.error };
    const updateKitchen = await updateKitchenPrompt(ctx.db, ctx.scope, outcome.result, parsed.data.mealId).catch((error) => {
      console.error("actions: couldn't build Update your kitchen", { error });
      return null;
    });
    return { ok: true, result: outcome.result, updateKitchen };
  } catch (error) {
    console.error("actions: finishCooking failed", { error });
    return { ok: false, reason: msg("SAVE_FAILED"), retryable: true };
  }
}

const UpdateKitchenInput = z.object({
  ...Tap,
  mealId: Id,
  items: z.array(z.object({ itemId: Id, stock: z.enum(["have", "low", "out"]) })).max(49),
  note: z.string().max(2000).optional(),
  /** From a To review card: it closes in the same change set. */
  reviewId: Id.optional(),
});

/** "Update your kitchen" → Done (M8): Running low / Out per item, plus an optional note. One Undo. */
export async function submitUpdateKitchen(input: z.input<typeof UpdateKitchenInput>): Promise<ActionResult> {
  return run(UpdateKitchenInput, input, (ctx, d) => updateKitchenAfterCooking(ctx.db, ctx.scope, d));
}

const LaterInput = z.object({ ...Tap, mealId: Id, items: z.array(z.object({ itemId: Id, name: z.string().min(1).max(200) })).max(100) });

/** "Do later": the sheet waits in To review as an after-cooking card. */
export async function updateKitchenLater(input: z.input<typeof LaterInput>): Promise<ActionResult> {
  return run(LaterInput, input, (ctx, d) => queueAfterCooking(ctx.db, ctx.scope, d));
}

const SkipInput = z.object({ ...Tap, reviewId: Id });

/**
 * Skip on an after-cooking To review card: closes it, nothing else (M8 Rec). Skip on the sheet
 * shown right after cooking needs no call: nothing was queued.
 */
export async function skipUpdateKitchen(input: z.input<typeof SkipInput>): Promise<ActionResult> {
  return run(SkipInput, input, (ctx, d) => resolveReview(ctx.db, ctx.scope, { ...d, outcome: "skipped" }));
}

const TickInput = z.object({ ...Tap, mealId: Id, ingredient: z.string().min(1).max(200), ticked: z.boolean() });

/** Recipe checklist ticks are shared by the kitchen (M6); who ticked is kept. */
export async function tickRecipeIngredient(input: z.input<typeof TickInput>): Promise<ActionResult> {
  return run(TickInput, input, (ctx, d) => tickIngredient(ctx.db, ctx.scope, d));
}

const NeedsInput = z.object({ ...Tap, mealId: Id, names: z.array(z.string().min(1).max(200)).min(1).max(50).optional() });

/** "Add Need items to shopping list" (0027): the recipe's Need group (or the chosen ones), source `recipe`. */
export async function addRecipeNeedsToList(input: z.input<typeof NeedsInput>): Promise<ActionResult> {
  return run(NeedsInput, input, (ctx, d) => addRecipeNeedsToShoppingList(ctx.db, ctx.scope, d));
}

/** DEV ONLY: switch who you're acting as (Vero or Levi in the demo kitchen). */
export async function setActingAs(userId: string): Promise<{ ok: boolean }> {
  if (!isDevActingAsOn()) return { ok: false };
  const session = await getSession();
  if (!session?.members.some((m) => m.userId === userId)) return { ok: false };
  (await cookies()).set(DEV_ACTING_AS_COOKIE, userId, { httpOnly: true, sameSite: "lax", path: "/" });
  return { ok: true };
}

/** DEV ONLY: reset the demo kitchen to its seed. */
export async function resetDevKitchen(): Promise<{ ok: boolean }> {
  if (!isDevActingAsOn()) return { ok: false };
  try {
    await resetDemoKitchen();
    return { ok: true };
  } catch (error) {
    console.error("dev.reset: failed", { error });
    return { ok: false };
  }
}
