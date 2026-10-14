/** Journey step 6 ("close the app and come back") and the test-kitchen scenarios (0021). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { kitchens } from "@/db/schema";
import { recordMealIdeas } from "@/domains/kitchen/commands";
import { getKitchenState } from "@/domains/kitchen/queries";
import { requireMember } from "@/shared/membership";
import { getProfile } from "@/shared/profile/public";
import { resetScenario, seedScenario } from "../../scripts/scenarios";
import { primaryJourney } from "../support/fixtures";
import { newKitchen, ok, openLocalDb } from "../support/db";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe("primary journey step 6", () => {
  it("everything is still there after closing and reopening the database", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kitchen-pglite-"));
    dirs.push(dataDir);

    const first = await openLocalDb({ dataDir });
    const t = await newKitchen(first.db);
    const vero = await t.scope("Vero");
    await ok(first.db, vero, primaryJourney.bought.ops, { text: primaryJourney.bought.text });
    await ok(first.db, vero, primaryJourney.froze.ops, { text: primaryJourney.froze.text });
    const { ideas } = await recordMealIdeas(first.db, vero, {
      basedOnVersion: 2,
      ideas: [{ name: "Chicken and spinach curry", why: "", uses: [], missing: [] }],
    });
    const mealId = (await ok(first.db, vero, primaryJourney.choose(ideas[0].ideaId))).applied[0].refs[0].id;
    const last = await ok(first.db, vero, primaryJourney.addToPlan.ops(mealId), { text: primaryJourney.addToPlan.text });
    await first.close();

    const again = await openLocalDb({ dataDir });
    try {
      const scope = await requireMember(again.db, t.userIds.Vero, t.kitchenId);
      expect(await getKitchenState(again.db, scope)).toEqual(last.state);
    } finally {
      await again.close();
    }
  });
});

describe("test-kitchen scenarios", () => {
  it("single and household load, and reset is repeatable", async () => {
    const { db, close } = await openLocalDb();
    try {
      const single = await seedScenario(db, "single", { afterShopping: true });
      const s = await getKitchenState(db, await requireMember(db, "tester-1", single.kitchenId));
      expect(s.items.map((i) => i.name.value).sort()).toEqual(["chicken thighs", "eggs", "spinach", "yogurt"]);

      const household = await seedScenario(db, "household");
      await seedScenario(db, "household"); // again: same result, no duplicates
      const scope = await requireMember(db, "tester-1", household.kitchenId);
      expect((await getKitchenState(db, scope)).version).toBe(1);
      const profile = await getProfile(db, "tester-2");
      expect(profile.restrictions.map((r) => [r.subject.value, r.note?.value])).toEqual([
        ["seafood", "can eat shellfish if medicine is on hand"],
      ]);

      await seedScenario(db, "single");
      expect((await getKitchenState(db, await requireMember(db, "tester-1", single.kitchenId))).items).toEqual([]);
    } finally {
      await close();
    }
  });

  it("refuses to reset a kitchen that isn't a test kitchen", async () => {
    const { db, close } = await openLocalDb();
    try {
      await seedScenario(db, "single");
      await db.update(kitchens).set({ isTest: false }).where(eq(kitchens.id, "test-kitchen-single"));
      await expect(resetScenario(db, "single")).rejects.toThrow(/not a test kitchen/);
      // A real (non-test) kitchen with a real member is untouched by any of this.
      const real = await newKitchen(db);
      expect((await getKitchenState(db, await real.scope("Vero"))).items).toEqual([]);
    } finally {
      await close();
    }
  });
});
