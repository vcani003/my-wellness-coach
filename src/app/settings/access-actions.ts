"use server";
/**
 * Settings → Kitchen: invite and reset links, and your passphrase (SU1 Rec; backend-data.md §7).
 * Each re-checks the session itself.
 *
 * - `createInvite({purpose: "join"})` → `{ok: true, path: "/join/<token>", expiresAt}`: show the
 *   link once (prefix the site's origin), with Copy/Share. It can't be shown again; make a new
 *   one instead. Fails with `full` (4 accounts, 0006), `notAllowed`, `tooMany`.
 * - `createResetLink({userId})` → `{ok: true, path: "/reset/<token>", expiresAt}` for a member
 *   of your kitchen (yourself included). Someone else's kitchen → `notAllowed`.
 * - `changePassphrase({current, next})` → `{ok: true}`. `current` is your passphrase, or your
 *   access code if you haven't set one yet. Replacing a passphrase signs your other devices out;
 *   this device stays signed in. Fails with `wrong`, `passphraseTooShort`, `passphraseTooLong`,
 *   `tooMany`.
 * Links last 24 hours and work once. Not signed in → `notAllowed`.
 */
import { z } from "zod";
import { changePassphrase as changePassphraseCmd, createLink, type AuthFailure, type CreateLinkResult } from "@/lib/auth/invites";
import { env } from "@/lib/env";
import { setSessionCookie } from "@/server/auth/request";
import { getDb } from "@/server/db";
import { getSession } from "@/server/session";

const notAllowed: AuthFailure = { ok: false, error: { key: "notAllowed" } };

async function link(purpose: "join" | "reset", targetUserId?: string): Promise<CreateLinkResult> {
  try {
    const session = await getSession();
    if (!session) return notAllowed;
    return await createLink(await getDb(), env(), { userId: session.userId, kitchenId: session.kitchenId, purpose, targetUserId });
  } catch (err) {
    console.error(`[${purpose}] create failed:`, (err as Error).message);
    return { ok: false, error: { key: "failed" } };
  }
}

export async function createInvite(input: { purpose: "join" }): Promise<CreateLinkResult> {
  if (input?.purpose !== "join") return notAllowed;
  return link("join");
}

export async function createResetLink(input: { userId: string }): Promise<CreateLinkResult> {
  const userId = z.string().min(1).max(200).safeParse(input?.userId);
  if (!userId.success) return notAllowed;
  return link("reset", userId.data);
}

const ChangeInput = z.object({ current: z.string().max(2000), next: z.string().max(2000) });

export async function changePassphrase(input: z.input<typeof ChangeInput>): Promise<{ ok: true } | AuthFailure> {
  const parsed = ChangeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: { key: "wrong" } };
  try {
    const session = await getSession();
    if (!session) return notAllowed;
    const result = await changePassphraseCmd(await getDb(), env(), { userId: session.userId, ...parsed.data });
    if (!result.ok) return result;
    await setSessionCookie(result.token);
    return { ok: true };
  } catch (err) {
    console.error("[passphrase] change failed:", (err as Error).message);
    return { ok: false, error: { key: "failed" } };
  }
}
