/**
 * Rate limits kept as counters in Postgres (backend-data.md §7), so they hold across serverless
 * instances. Fixed windows: simple and cheap; a burst can straddle a window edge, which is fine
 * at this scale.
 *
 * - Chat: 60 messages an hour and 300 a day per user. The chat route calls `checkChatRateLimit`
 *   before interpreting; a refused message counts against neither window.
 * - Access codes: 5 attempts per 15 minutes per IP, and 50 an hour overall.
 */
import { createHmac } from "node:crypto";
import { lt, sql } from "drizzle-orm";
import type { Db, Queryable } from "@/db/client";
import { rateLimits } from "@/db/schema";
import type { Msg } from "@/contracts/common";
import { msg } from "@/shared/messages";

export interface Limit {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Most hits allowed per window. */
  max: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const CHAT_LIMITS = { hour: { windowMs: HOUR, max: 60 }, day: { windowMs: DAY, max: 300 } } satisfies Record<string, Limit>;
export const UNLOCK_LIMITS = {
  perIp: { windowMs: 15 * MINUTE, max: 5 },
  global: { windowMs: HOUR, max: 50 },
} satisfies Record<string, Limit>;

export type LimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

const windowStartOf = (now: Date, windowMs: number) => new Date(Math.floor(now.getTime() / windowMs) * windowMs);

/**
 * Count one hit against `key` if it's under the limit. Atomic: one upsert that only increments
 * while `count < max`, so two requests at once can't both squeeze past the last slot.
 */
export async function hit(db: Queryable, key: string, limit: Limit, now: Date): Promise<LimitResult> {
  const windowStart = windowStartOf(now, limit.windowMs);
  const rows = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
      setWhere: sql`${rateLimits.count} < ${limit.max}`,
    })
    .returning({ count: rateLimits.count });
  if (rows.length > 0) return { ok: true };
  const retryAfterMs = windowStart.getTime() + limit.windowMs - now.getTime();
  return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
}

class LimitReached extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("rate limit reached");
  }
}

/** Count one hit against every limit, all or nothing: if any is full, none is counted. */
export async function hitAll(db: Db, hits: { key: string; limit: Limit }[], now: Date): Promise<LimitResult> {
  try {
    await db.transaction(async (tx) => {
      for (const h of hits) {
        const r = await hit(tx, h.key, h.limit, now);
        if (!r.ok) throw new LimitReached(r.retryAfterSeconds);
      }
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof LimitReached) return { ok: false, retryAfterSeconds: err.retryAfterSeconds };
    throw err;
  }
}

export type ChatLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number; reason: Msg };

/**
 * Per-user chat limit: 60 an hour, 300 a day. Call once per user message, before any AI call.
 * When refused, send `reason` in the turn stream's `error` event (`retryable: true`, nothing changed).
 */
export async function checkChatRateLimit(db: Db, userId: string, now: Date = new Date()): Promise<ChatLimitResult> {
  const r = await hitAll(
    db,
    [
      { key: `chat:hour:${userId}`, limit: CHAT_LIMITS.hour },
      { key: `chat:day:${userId}`, limit: CHAT_LIMITS.day },
    ],
    now,
  );
  if (r.ok) return r;
  const minutes = Math.max(1, Math.ceil(r.retryAfterSeconds / 60));
  return { ...r, reason: msg("RATE_LIMITED", { minutes }) };
}

/** Access-code attempts: per IP (stored as a keyed hash, never the address) and overall. */
export async function checkUnlockRateLimit(db: Db, ip: string, secret: string, now: Date = new Date()): Promise<LimitResult> {
  const ipKey = createHmac("sha256", secret).update(`ip:${ip}`).digest("base64url").slice(0, 22);
  return hitAll(
    db,
    [
      { key: `unlock:ip:${ipKey}`, limit: UNLOCK_LIMITS.perIp },
      { key: "unlock:global", limit: UNLOCK_LIMITS.global },
    ],
    now,
  );
}

/** Delete old windows: anything that started over 3 days ago (the longest window is 1 day). */
export async function pruneRateLimits(db: Queryable, now: Date = new Date()): Promise<void> {
  await db.delete(rateLimits).where(lt(rateLimits.windowStart, new Date(now.getTime() - 3 * DAY)));
}
