"use server";
/**
 * Server actions: UI buttons that run on the server (backend-data.md §6). Each one re-checks
 * the session and membership, then goes through the same validate → apply path as chat.
 */
import { cookies } from "next/headers";
import { z } from "zod";
import type { ApplyResult } from "@/contracts/apply-result";
import type { Msg } from "@/contracts/common";
import { Id } from "@/contracts/common";
import { undo } from "@/domains/kitchen/commands";
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
