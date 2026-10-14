"use server";
/**
 * Setting a new passphrase with a reset link, `/reset/<token>` (SU1 Rec; backend-data.md §7).
 * The proxy lets this page through without a session; these actions check the link themselves.
 *
 * - `checkResetLink({token})` → `LinkInfo`: `{ok: true, kitchenName, invitedBy, forName,
 *   expiresAt}` (`forName` = whose passphrase this sets) or `{ok: false}`.
 * - `acceptReset({token, passphrase})` → sets the passphrase, signs that person out everywhere
 *   else, sets this device's session cookie and redirects to `/`. Otherwise `AuthFailure` with
 *   key `passphraseTooShort | passphraseTooLong | invalidLink | tooMany | notConfigured | failed`.
 */
import { redirect } from "next/navigation";
import { z } from "zod";
import { acceptReset as acceptResetCmd, getLinkInfo, type AuthFailure, type LinkInfo } from "@/lib/auth/invites";
import { env } from "@/lib/env";
import { clientIp, setSessionCookie } from "@/server/auth/request";
import { getDb } from "@/server/db";

const Token = z.string().max(200);
const ResetInput = z.object({ token: Token, passphrase: z.string().max(2000) });

export async function checkResetLink(input: { token: string }): Promise<LinkInfo> {
  const token = Token.safeParse(input?.token);
  if (!token.success) return { ok: false };
  try {
    return await getLinkInfo(await getDb(), token.data, "reset");
  } catch (err) {
    console.error("[reset] check failed:", (err as Error).message);
    return { ok: false };
  }
}

export async function acceptReset(input: z.input<typeof ResetInput>): Promise<AuthFailure> {
  const parsed = ResetInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: { key: "invalidLink" } };
  let result;
  try {
    result = await acceptResetCmd(await getDb(), env(), { ...parsed.data, ip: await clientIp() });
  } catch (err) {
    console.error("[reset] failed:", (err as Error).message);
    return { ok: false, error: { key: "failed" } };
  }
  if (!result.ok) return result;
  await setSessionCookie(result.token);
  redirect("/");
}
