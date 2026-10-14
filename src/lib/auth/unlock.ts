/**
 * Unlocking with an access code (interim gate, backend-data.md §7). Rate-limited before the code
 * is even compared, so guessing costs attempts whether or not it's right.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deletedUsers, users } from "@/db/schema";
import type { Env } from "@/lib/env";
import { checkUnlockRateLimit, pruneRateLimits } from "@/lib/rate-limit";
import { matchAccessCode, parseAccessCodes } from "./access-codes";
import { issueSession } from "./session";

export type UnlockResult =
  | { ok: true; userId: string; token: string }
  | { ok: false; reason: "invalid" | "rate_limited" | "not_configured" | "deleted"; retryAfterSeconds?: number };

export async function attemptUnlock(db: Db, e: Env, input: { code: string; ip: string }, now: Date = new Date()): Promise<UnlockResult> {
  if (!e.SESSION_SECRET || !e.ACCESS_CODES) return { ok: false, reason: "not_configured" };
  const limit = await checkUnlockRateLimit(db, input.ip, e.SESSION_SECRET, now);
  if (!limit.ok) return { ok: false, reason: "rate_limited", retryAfterSeconds: limit.retryAfterSeconds };
  // Housekeeping on a rare path; failure here must not block unlocking (0018).
  await pruneRateLimits(db, now).catch((err) => console.error("[unlock] prune failed:", (err as Error).message));

  const code = input.code.slice(0, 200);
  const userId = matchAccessCode(parseAccessCodes(e.ACCESS_CODES), code);
  if (!userId) return { ok: false, reason: "invalid" };

  const [user] = await db
    .select({ id: users.id, isTest: users.isTest, sessionEpoch: users.sessionEpoch })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) {
    // D1: this person deleted their data. Their code still being listed must not let them back in
    // or recreate them; say so plainly (they typed a real code). Vero removes it from ACCESS_CODES.
    const [gone] = await db.select({ id: deletedUsers.id }).from(deletedUsers).where(eq(deletedUsers.id, userId)).limit(1);
    if (gone) {
      console.error(`[unlock] access code for "${userId}" belongs to a deleted account; remove it from ACCESS_CODES`);
      return { ok: false, reason: "deleted" };
    }
  }
  if (!user || user.isTest) {
    // Names only: tells the operator to run the bootstrap; the visitor just sees "didn't work".
    console.error(`[unlock] access code for "${userId}" has no real user; run npm run db:bootstrap`);
    return { ok: false, reason: "invalid" };
  }
  const token = issueSession(
    { secret: e.SESSION_SECRET, accessCodes: e.ACCESS_CODES, production: e.NODE_ENV === "production" },
    userId,
    now,
    user.sessionEpoch,
  );
  if (!token) return { ok: false, reason: "invalid" };
  return { ok: true, userId, token };
}
