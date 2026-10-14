/**
 * Resetting a test kitchen for the tester agents (0021; backend-data.md §8, §10 "Staging").
 * The data rules behind `POST /api/test/reset`; the route adds the deployment check (404 outside
 * staging), the same-origin check and the session.
 *
 * Refused unless the caller is a tester account (`isTest`, read from the database, not the
 * cookie) **and** a member of that scenario's test kitchen. `seedScenario` itself only ever
 * deletes `isTest` kitchens and the scenario's `isTest` users' profiles, and refuses otherwise,
 * so a real person or a real kitchen can't be touched from here.
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { kitchens, memberships, users } from "@/db/schema";
import { hitAll, type Limit } from "@/lib/rate-limit";
import { scenarioKitchenId, seedScenario, type StagingScenario } from "../../scripts/scenarios";

/** Enough for a tester agent's runs, low enough that a loop can't hammer the database. */
export const TEST_RESET_LIMIT: Limit = { windowMs: 60 * 60_000, max: 20 };

export type TestResetResult =
  | { ok: true; scenario: StagingScenario; kitchenId: string }
  | { ok: false; reason: "notAllowed" }
  | { ok: false; reason: "tooMany"; retryAfterSeconds: number };

export async function resetTestKitchen(
  db: Db,
  input: { userId: string; scenario: StagingScenario; afterShopping?: boolean },
  now: Date = new Date(),
): Promise<TestResetResult> {
  const kitchenId = scenarioKitchenId(input.scenario);
  const [row] = await db
    .select({ userIsTest: users.isTest, kitchenIsTest: kitchens.isTest })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(kitchens, eq(kitchens.id, memberships.kitchenId))
    .where(and(eq(memberships.userId, input.userId), eq(memberships.kitchenId, kitchenId)))
    .limit(1);
  // Not a member, not a tester, or (belt and braces) not a test kitchen: one refusal for all.
  if (!row?.userIsTest || !row.kitchenIsTest) return { ok: false, reason: "notAllowed" };

  const limit = await hitAll(db, [{ key: `test-reset:user:${input.userId}`, limit: TEST_RESET_LIMIT }], now);
  if (!limit.ok) return { ok: false, reason: "tooMany", retryAfterSeconds: limit.retryAfterSeconds };

  await seedScenario(db, input.scenario, { afterShopping: input.scenario === "single" && input.afterShopping === true });
  return { ok: true, scenario: input.scenario, kitchenId };
}
