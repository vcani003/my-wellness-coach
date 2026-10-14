/**
 * Test-kitchen scenarios (0021, backend-data.md §8): `single` and `household`, plus `demo`, a
 * LOCAL-ONLY household with "Vero" and "Levi" display names for the dev "acting as" switch
 * (milestone 2). Demo people are `isTest` accounts too, so they can never join a real kitchen.
 * `seedScenario` wipes the scenario's test kitchen and its testers' profiles, then loads the
 * scenario through the normal write path (so it has real events). It only ever touches
 * `isTest` kitchens and `isTest` users. Local only for now; the staging `/api/test/reset`
 * route will reuse it later.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { events, kitchens, profilePreferences, profileRestrictions, users } from "@/db/schema";
import { applyProposedChange } from "@/domains/kitchen/commands";
import { kitchenStream, userStream } from "@/shared/events/types";
import { createKitchen, createUser } from "@/shared/identity";
import { requireMember } from "@/shared/membership";

export const SCENARIOS = ["single", "household", "demo"] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

export const TESTERS = [
  { id: "tester-1", displayName: "Tester One", email: "tester-1@example.test" },
  { id: "tester-2", displayName: "Tester Two", email: "tester-2@example.test" },
] as const;

/** Local dev only (the "acting as" switch): stand-ins named like the real household. */
export const DEMO_PEOPLE = [
  { id: "demo-vero", displayName: "Vero", email: "demo-vero@example.test" },
  { id: "demo-levi", displayName: "Levi", email: "demo-levi@example.test" },
] as const;

const PEOPLE = [...TESTERS, ...DEMO_PEOPLE];

const KITCHENS: Record<ScenarioName, { id: string; name: string; members: string[] }> = {
  single: { id: "test-kitchen-single", name: "Single-person test kitchen", members: ["tester-1"] },
  household: { id: "test-kitchen-household", name: "Household test kitchen", members: ["tester-1", "tester-2"] },
  demo: { id: "test-kitchen-demo", name: "Demo kitchen (local)", members: ["demo-vero", "demo-levi"] },
};

export function scenarioKitchenId(name: ScenarioName): string {
  return KITCHENS[name].id;
}

const said = <T>(value: T) => ({ value, basis: "said" as const, confidence: "high" as const });

export interface SeedOptions {
  /** `single` only: start "after shopping" (journey step 1 done) instead of empty. */
  afterShopping?: boolean;
}

export async function resetScenario(db: Db, name: ScenarioName): Promise<void> {
  const k = KITCHENS[name];
  const testerIds = k.members;
  const userRows = await db.select({ id: users.id, isTest: users.isTest }).from(users).where(inArray(users.id, testerIds));
  if (userRows.some((u) => !u.isTest)) throw new Error("Refusing to reset: a scenario user is not a test account");
  const [kitchen] = await db.select({ isTest: kitchens.isTest }).from(kitchens).where(eq(kitchens.id, k.id));
  if (kitchen && !kitchen.isTest) throw new Error("Refusing to reset: not a test kitchen");

  await db.transaction(async (tx) => {
    // Kitchen projections, change sets, memberships and ideas cascade with the kitchen row.
    await tx.delete(kitchens).where(and(eq(kitchens.id, k.id), eq(kitchens.isTest, true)));
    await tx.delete(events).where(eq(events.stream, kitchenStream(k.id)));
    await tx.delete(events).where(inArray(events.stream, testerIds.map(userStream)));
    await tx.delete(profileRestrictions).where(inArray(profileRestrictions.userId, testerIds));
    await tx.delete(profilePreferences).where(inArray(profilePreferences.userId, testerIds));
  });
}

export async function seedScenario(db: Db, name: ScenarioName, opts: SeedOptions = {}): Promise<{ kitchenId: string; userIds: string[] }> {
  const k = KITCHENS[name];
  for (const t of PEOPLE.filter((p) => (k.members as string[]).includes(p.id))) {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.id, t.id));
    if (!existing) await createUser(db, { ...t, isTest: true });
  }
  await resetScenario(db, name);
  await createKitchen(db, { id: k.id, name: k.name, isTest: true, memberIds: k.members });

  const apply = async (userId: string, proposalId: string, text: string, operations: unknown[]) => {
    const scope = await requireMember(db, userId, k.id);
    const out = await applyProposedChange(
      db,
      scope,
      {
        proposalId,
        kitchenId: k.id,
        basedOnVersion: 0,
        source: { via: "chat", messageId: proposalId },
        operations,
      },
      { messageText: text },
    );
    if (!out.ok || out.result.rejected.length) throw new Error(`Seeding ${name} failed at ${proposalId}`);
  };

  if (name === "single" && opts.afterShopping) {
    const text = "I bought eggs, chicken thighs, spinach and yogurt.";
    await apply(
      "tester-1",
      "seed-after-shopping",
      text,
      ["eggs", "chicken thighs", "spinach", "yogurt"].map((n, i) => ({
        opId: `${i + 1}`,
        type: "item.add",
        evidence: n,
        fields: { name: said(n) },
      })),
    );
  }

  if (name === "household" || name === "demo") {
    // One member has a seafood allergy with a personal note (0019, 0021).
    const text = "I'm allergic to seafood, but I can eat shellfish if my medicine is on hand.";
    await apply(k.members[1], "seed-allergy", text, [
      {
        opId: "1",
        type: "profile.restriction.add",
        evidence: "allergic to seafood",
        fields: { kind: "allergy", subject: said("seafood"), note: said("can eat shellfish if medicine is on hand") },
      },
    ]);
  }
  return { kitchenId: k.id, userIds: k.members };
}
