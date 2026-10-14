"use server";
/**
 * Joining with an invite link, `/join/<token>` (SU1 Rec; backend-data.md §7). The proxy lets
 * this page through without a session; these actions check the link themselves.
 *
 * - `checkJoinLink({token})` → `LinkInfo`: `{ok: true, kitchenName, invitedBy, expiresAt}` or
 *   `{ok: false}` ("This link no longer works": unknown, used or expired, deliberately alike).
 * - `acceptJoin({token, displayName, passphrase})` → on success sets the session cookie and
 *   redirects to `/`; otherwise `AuthFailure` `{ok: false, error: {key, minutes?}}` with key
 *   `nameInvalid | nameTaken | passphraseTooShort | passphraseTooLong | invalidLink | full |
 *   tooMany | notConfigured | failed`. Name and passphrase problems leave the link unused.
 */
import { redirect } from "next/navigation";
import { z } from "zod";
import { acceptJoin as acceptJoinCmd, getLinkInfo, type AuthFailure, type LinkInfo } from "@/lib/auth/invites";
import { env } from "@/lib/env";
import { clientIp, setSessionCookie } from "@/server/auth/request";
import { getDb } from "@/server/db";

const Token = z.string().max(200);
const JoinInput = z.object({ token: Token, displayName: z.string().max(200), passphrase: z.string().max(2000) });

export async function checkJoinLink(input: { token: string }): Promise<LinkInfo> {
  const token = Token.safeParse(input?.token);
  if (!token.success) return { ok: false };
  try {
    return await getLinkInfo(await getDb(), token.data, "join");
  } catch (err) {
    console.error("[join] check failed:", (err as Error).message);
    return { ok: false };
  }
}

export async function acceptJoin(input: z.input<typeof JoinInput>): Promise<AuthFailure> {
  const parsed = JoinInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: { key: "invalidLink" } };
  let result;
  try {
    result = await acceptJoinCmd(await getDb(), env(), { ...parsed.data, ip: await clientIp() });
  } catch (err) {
    console.error("[join] failed:", (err as Error).message);
    return { ok: false, error: { key: "failed" } };
  }
  if (!result.ok) return result;
  await setSessionCookie(result.token);
  redirect("/");
}
