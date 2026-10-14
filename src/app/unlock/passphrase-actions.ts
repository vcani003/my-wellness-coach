"use server";
/**
 * Signing in with name + passphrase on `/unlock` (SU1 Rec; backend-data.md §7). The access-code
 * form (`./actions.ts`) keeps working beside it, as a backup.
 *
 * - `signInWithPassphrase({name, passphrase})` → on success sets the session cookie and
 *   redirects to `/`; otherwise `AuthFailure` with key `wrong` (wrong name *or* passphrase, never
 *   says which), `tooMany` (+ `minutes`), `notConfigured` or `failed`.
 */
import { redirect } from "next/navigation";
import { z } from "zod";
import { signInWithPassphrase as signInCmd, type AuthFailure } from "@/lib/auth/invites";
import { env } from "@/lib/env";
import { clientIp, setSessionCookie } from "@/server/auth/request";
import { getDb } from "@/server/db";

const SignInInput = z.object({ name: z.string().max(200), passphrase: z.string().max(2000) });

export async function signInWithPassphrase(input: z.input<typeof SignInInput>): Promise<AuthFailure> {
  const parsed = SignInInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: { key: "wrong" } };
  let result;
  try {
    result = await signInCmd(await getDb(), env(), { ...parsed.data, ip: await clientIp() });
  } catch (err) {
    console.error("[sign-in] failed:", (err as Error).message);
    return { ok: false, error: { key: "failed" } };
  }
  if (!result.ok) return result;
  await setSessionCookie(result.token);
  redirect("/");
}
