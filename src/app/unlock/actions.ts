"use server";
/** Server action for `/unlock` (interim access-code gate, backend-data.md §7). */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { attemptUnlock } from "@/lib/auth/unlock";
import { sessionCookieName, sessionCookieOptions } from "@/lib/auth/session";
import { env } from "@/lib/env";

export interface UnlockState {
  error?: string;
}

/** The client's IP as Vercel reports it (it sets `x-forwarded-for`); "unknown" elsewhere. */
async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "unknown";
}

export async function unlock(_prev: UnlockState, form: FormData): Promise<UnlockState> {
  const code = String(form.get("code") ?? "");
  if (code.trim() === "") return { error: "Enter your access code." };
  const e = env();
  let result;
  try {
    result = await attemptUnlock(await getDb(), e, { code, ip: await clientIp() });
  } catch (err) {
    console.error("[unlock] failed:", (err as Error).message);
    return { error: "Something went wrong. Please try again." };
  }
  if (!result.ok) {
    if (result.reason === "rate_limited") {
      const minutes = Math.max(1, Math.ceil((result.retryAfterSeconds ?? 60) / 60));
      return { error: `Too many tries. Please wait ${minutes} min and try again.` };
    }
    if (result.reason === "not_configured") return { error: "Access codes aren't set up on this server yet." };
    return { error: "That code didn't work. Check it and try again." };
  }
  const production = e.NODE_ENV === "production";
  (await cookies()).set(sessionCookieName(production), result.token, sessionCookieOptions(production));
  redirect("/");
}
