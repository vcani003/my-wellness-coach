/** `npm run db:bootstrap` idempotency (0006, 0026) and the chat rate limit (backend-data.md §7), on PGlite. */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openLocalDb, type Db } from "@/db/client";
import { kitchens, memberships, rateLimits, users } from "@/db/schema";
import { listMembers, requireMember } from "@/shared/membership";
import { CHAT_LIMITS, checkChatRateLimit } from "@/lib/rate-limit";
import { bootstrap, HOME_KITCHEN } from "../../scripts/bootstrap";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await openLocalDb());
});
afterAll(() => close());

describe("bootstrap", () => {
  it("creates Vero, Levi and the shared Home kitchen, and is safe to run twice", async () => {
    const first = await bootstrap(db);
    expect(first).toEqual({ createdUsers: ["vero", "levi"], createdKitchen: true, createdMemberships: ["vero", "levi"] });

    const second = await bootstrap(db);
    expect(second).toEqual({ createdUsers: [], createdKitchen: false, createdMemberships: [] });

    const [home] = await db.select().from(kitchens).where(eq(kitchens.id, HOME_KITCHEN.id));
    expect(home).toMatchObject({ name: "Home", isTest: false });
    expect((await listMembers(db, "home")).map((m) => m.displayName)).toEqual(["Vero", "Levi"]);
    expect(await db.select().from(memberships)).toHaveLength(2);
    const real = await db.select({ id: users.id, isTest: users.isTest }).from(users);
    expect(real.every((u) => !u.isTest)).toBe(true);

    // Both are real members of the shared kitchen.
    await expect(requireMember(db, "vero", "home")).resolves.toMatchObject({ isTestKitchen: false });
    await expect(requireMember(db, "levi", "home")).resolves.toMatchObject({ isTestKitchen: false });
  });

  it("repairs a half-finished setup without touching what exists", async () => {
    await db.delete(memberships).where(eq(memberships.userId, "levi"));
    await db.update(users).set({ displayName: "Levi Le" }).where(eq(users.id, "levi"));
    expect(await bootstrap(db)).toEqual({ createdUsers: [], createdKitchen: false, createdMemberships: ["levi"] });
    const [levi] = await db.select().from(users).where(eq(users.id, "levi"));
    expect(levi.displayName).toBe("Levi Le");
  });
});

describe("chat rate limit", () => {
  const user = "rate-user";
  const hourStart = new Date("2026-10-14T09:00:00Z");
  const at = (minutes: number) => new Date(hourStart.getTime() + minutes * 60_000);

  it("allows 60 an hour, then refuses with a retry time, then allows again next hour", async () => {
    for (let i = 0; i < CHAT_LIMITS.hour.max; i++) {
      expect((await checkChatRateLimit(db, user, at(i % 60))).ok, `message ${i + 1}`).toBe(true);
    }
    const refused = await checkChatRateLimit(db, user, at(30));
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.retryAfterSeconds).toBe(30 * 60);
      expect(refused.reason.code).toBe("RATE_LIMITED");
      expect(refused.reason.params).toEqual({ minutes: 30 });
    }
    expect((await checkChatRateLimit(db, user, at(60))).ok).toBe(true);
    // Limits are per user.
    expect((await checkChatRateLimit(db, "someone-else", at(30))).ok).toBe(true);
  });

  it("allows 300 a day; a refused message counts against neither window", async () => {
    const u = "daily-user";
    const day = new Date("2026-10-15T00:00:00Z");
    let sent = 0;
    for (let hour = 0; sent < CHAT_LIMITS.day.max; hour++) {
      for (let i = 0; i < CHAT_LIMITS.hour.max && sent < CHAT_LIMITS.day.max; i++, sent++) {
        expect((await checkChatRateLimit(db, u, new Date(day.getTime() + hour * 3_600_000 + i * 1000))).ok).toBe(true);
      }
    }
    // 300 used across 5 hours; hour 6 is empty but the day is full.
    const sixth = new Date(day.getTime() + 6 * 3_600_000);
    const refused = await checkChatRateLimit(db, u, sixth);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.retryAfterSeconds).toBe(18 * 3600);
    // The refused attempt wasn't counted in hour 6 (all or nothing).
    const hour6 = await db.select().from(rateLimits).where(and(eq(rateLimits.key, `chat:hour:${u}`), eq(rateLimits.windowStart, sixth)));
    expect(hour6).toEqual([]);
    // A new day starts fresh.
    expect((await checkChatRateLimit(db, u, new Date(day.getTime() + 24 * 3_600_000))).ok).toBe(true);
  });
});
