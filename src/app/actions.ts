"use server";
/**
 * Server actions: UI buttons that run on the server (backend-data.md §6). Each one re-checks
 * the session and membership, then goes through the same validate → apply path as chat.
 */
import { cookies } from "next/headers";
import { z } from "zod";
import type { ApplyResult } from "@/contracts/apply-result";
import type { Msg } from "@/contracts/common";
import { Id, Quantity, ShoppingSource } from "@/contracts/common";
import { ShoppingDoneFields } from "@/contracts/operations";
import {
  addShoppingItems,
  doneShopping,
  removeShoppingItem,
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
    console.error("actions: shopping action failed", { error });
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
