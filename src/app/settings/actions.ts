"use server";
/**
 * Settings server actions (P2 b; 0015, 0017, 0019; backend-data.md §6). Each re-checks the
 * session itself. Data controls are routes: `GET /api/me/export`, `POST /api/me/delete`.
 *
 * - `loadSettings()` → `SettingsView | null` (null = signed out, or couldn't load: show a Retry).
 *   Also callable from a server component.
 * - `verifyRestriction` / `removeRestriction` `{tapId, restrictionId}` → `SettingsActionResult`.
 *   Owner only (0019); someone else's → `{ok: false, reason: NOT_ALLOWED}`. `tapId` makes a
 *   double tap harmless. On success you get the receipt (with Undo) and the refreshed view.
 * - `signOut()` clears this device; `signOutEverywhere()` signs out every device, this one
 *   included. Both then send you to /unlock.
 */
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ApplyResult } from "@/contracts/apply-result";
import { Id, type Msg } from "@/contracts/common";
import type { SettingsView } from "@/contracts/settings";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getSettingsView, removeRestriction as removeRestrictionCmd, verifyRestriction as verifyRestrictionCmd } from "@/server/account/settings";
import { bumpSessionEpoch, clearSessionCookie } from "@/server/account/sessions";
import { getDb } from "@/server/db";
import { getScope, getSession } from "@/server/session";
import { msg } from "@/shared/messages";

export type SettingsActionResult =
  | { ok: true; result: ApplyResult; settings: SettingsView | null }
  | { ok: false; reason: Msg; retryable: boolean };

export async function loadSettings(): Promise<SettingsView | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  try {
    return await getSettingsView(await getDb(), user.id);
  } catch (error) {
    // Never crash (0018): the page shows its own "couldn't load" state with Retry.
    console.error("settings: couldn't load", { error });
    return null;
  }
}

const RestrictionInput = z.object({ tapId: Id, restrictionId: Id });

async function profileTap(
  input: z.input<typeof RestrictionInput>,
  run: typeof verifyRestrictionCmd,
): Promise<SettingsActionResult> {
  const parsed = RestrictionInput.safeParse(input);
  if (!parsed.success) return { ok: false, reason: msg("INVALID_PROPOSAL"), retryable: false };
  const session = await getSession();
  const ctx = session ? await getScope(session.kitchenId) : null;
  if (!ctx) return { ok: false, reason: msg("NOT_ALLOWED"), retryable: false };
  const outcome = await run(ctx.db, ctx.scope, parsed.data);
  if (!outcome.ok) return { ok: false, ...outcome.error };
  // A refused tap (someone else's restriction, or it's gone) is a plain failure for the UI.
  const refused = outcome.result.rejected[0];
  if (refused && outcome.result.applied.length === 0) return { ok: false, reason: refused.reason, retryable: false };
  return { ok: true, result: outcome.result, settings: await getSettingsView(ctx.db, ctx.scope.userId).catch(() => null) };
}

/** "Keep" on an allergy or diet another member added for you (AI7, 0019). */
export async function verifyRestriction(input: z.input<typeof RestrictionInput>): Promise<SettingsActionResult> {
  return profileTap(input, verifyRestrictionCmd);
}

/** "Remove" on one of your own allergies or diets (0019). */
export async function removeRestriction(input: z.input<typeof RestrictionInput>): Promise<SettingsActionResult> {
  return profileTap(input, removeRestrictionCmd);
}

/** Sign out on this device only. */
export async function signOut(): Promise<void> {
  await clearSessionCookie();
  redirect("/unlock");
}

/** "Sign out everywhere" (0017): every device's session ends, this one's too. */
export async function signOutEverywhere(): Promise<void> {
  const user = await getCurrentUser();
  if (user) await bumpSessionEpoch(await getDb(), user.id);
  await clearSessionCookie();
  redirect("/unlock");
}
