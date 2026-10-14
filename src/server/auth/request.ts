/** Request helpers for the sign-in server actions (backend-data.md §7). */
import "server-only";
import { cookies, headers } from "next/headers";
import { sessionCookieName, sessionCookieOptions } from "@/lib/auth/session";
import { env } from "@/lib/env";

/** The client's IP as Vercel reports it (it sets `x-forwarded-for`); "unknown" elsewhere. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "unknown";
}

/** Set this device's session cookie (same name and attributes as `/unlock`). */
export async function setSessionCookie(token: string): Promise<void> {
  const production = env().NODE_ENV === "production";
  (await cookies()).set(sessionCookieName(production), token, sessionCookieOptions(production));
}
