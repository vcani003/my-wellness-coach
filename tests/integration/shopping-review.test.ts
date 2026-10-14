/**
 * "Do later" on the Done-shopping sheet, on Postgres (PGlite, the real migrations up to
 * 0004_shopping_review): the chosen items wait in To review, then Add runs Done shopping's path
 * (one change set, one Undo) or Skip closes the card. Also: the projection row (origin, no meal),
 * a rebuild from the log, idempotent taps and the shared kitchen.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { ApplyResult } from "@/contracts/apply-result";
import type { Db } from "@/db/client";
import { changeSets, reviews } from "@/db/schema";
import {
  addShoppingItems,
  queueShoppingReview,
  rebuildProjections,
  recordMealIdeas,
  resolveReview,
  tickShoppingItem,
  undo,
} from "@/domains/kitchen/commands";
import { getKitchenState, getKitchenVersion, getShoppingList } from "@/domains/kitchen/queries";
import type { KitchenScope } from "@/shared/membership";
import { newKitchen, ok, openLocalDb } from "../support/db";
import { primaryJourney } from "../support/fixtures";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await openLocalDb());
});
afterAll(async () => {
  await close();
});

let taps = 0;
const tapArgs = async (scope: KitchenScope) => ({ tapId: `review-tap-${++taps}`, basedOnVersion: await getKitchenVersion(db, scope) });
const unwrap = <T extends { ok: boolean }>(o: T) => {
  if (!o.ok) throw new Error(`failed: ${JSON.stringify(o)}`);
  return (o as unknown as { result: ApplyResult }).result;
};
const idOf = async (scope: KitchenScope, name: string) => {
  const e = (await getShoppingList(db, scope)).find((x) => x.name.value === name);
  if (!e) throw new Error(`${name} not on the list`);
  return e.id;
};

/** Vero and Levi's list: garlic and ginger ticked, shallot not. */
async function shopped() {
  const t = await newKitchen(db, ["Vero", "Levi"]);
  const vero = await t.scope("Vero");
  const levi = await t.scope("Levi");
  unwrap(
    await addShoppingItems(db, vero, {
      ...(await tapArgs(vero)),
      source: "chat",
      items: [{ name: "garlic", store: "MD Oriental Market" }, { name: "ginger" }, { name: "shallot" }, { name: "oatmilk", store: "Publix" }],
    }),
  );
  for (const name of ["garlic", "ginger"]) {
    unwrap(await tickShoppingItem(db, vero, { ...(await tapArgs(vero)), shoppingItemId: await idOf(vero, name), ticked: true }));
  }
  const ids = Object.fromEntries(await Promise.all(["garlic", "ginger", "shallot", "oatmilk"].map(async (n) => [n, await idOf(vero, n)])));
  return { t, vero, levi, ids };
}

describe("Do later → To review → Add, on Postgres", () => {
  it("queues the chosen items, then Add puts them in the kitchen and off the list in one change set; one Undo restores all", async () => {
    const { t, vero, levi, ids } = await shopped();

    const queued = unwrap(
      await queueShoppingReview(db, vero, { ...(await tapArgs(vero)), shoppingItemIds: [ids.garlic, ids.ginger, ids.shallot] }),
    );
    expect(queued.rejected).toEqual([]);
    expect(queued.applied[0].summary.code).toBe("SHOPPING_REVIEW_QUEUED");
    const [card] = queued.state.toReview;
    expect(card).toMatchObject({ kind: "add-to-kitchen", origin: "shopping-list", status: "pending" });
    expect(card.meal).toBeUndefined();
    expect(card.items.map((e) => e.name)).toEqual(["garlic", "ginger", "shallot"]);
    expect(queued.state.shoppingList).toHaveLength(4); // the list itself is unchanged

    // The projection row: origin set, no meal (stored as '' so the migration stays additive).
    const [row] = await db.select().from(reviews).where(eq(reviews.kitchenId, t.kitchenId));
    expect(row).toMatchObject({ origin: "shopping-list", mealId: "", status: "pending" });

    // Levi sees the same card (shared kitchen) and can add from it.
    expect((await getKitchenState(db, levi)).toReview.map((r) => r.id)).toEqual([card.id]);
    unwrap(await tickShoppingItem(db, levi, { ...(await tapArgs(levi)), shoppingItemId: ids.shallot, ticked: true }));
    const added = unwrap(
      await resolveReview(db, levi, {
        ...(await tapArgs(levi)),
        reviewId: card.id,
        outcome: "done",
        shoppingItemIds: [ids.garlic, ids.shallot],
      }),
    );
    expect(added.rejected).toEqual([]);
    expect(added.undoable).toBe(true);
    expect(added.applied[0].summary).toMatchObject({ code: "SHOPPING_DONE", params: { count: 2, names: "garlic, shallot" } });
    expect(added.state.items.map((i) => i.name.value).sort()).toEqual(["garlic", "shallot"]);
    expect(added.state.shoppingList.map((e) => e.name.value)).toEqual(["ginger", "oatmilk"]);
    expect(added.state.shoppingList.find((e) => e.name.value === "ginger")?.ticked).toBeDefined(); // queued, not chosen: stays
    expect(added.state.toReview).toEqual([]);
    // One change set, recorded once, with every list item, kitchen item and the card.
    const [cs] = await db
      .select()
      .from(changeSets)
      .where(and(eq(changeSets.kitchenId, t.kitchenId), eq(changeSets.id, added.changeSetId)));
    expect(cs.touched).toEqual(expect.arrayContaining([`shopping:${ids.garlic}`, `shopping:${ids.shallot}`, `review:${card.id}`]));
    expect(cs.touched.filter((k) => k.startsWith("item:"))).toHaveLength(2);

    // The projection equals a full replay of the log.
    const before = await getKitchenState(db, vero);
    await rebuildProjections(db, vero);
    expect(await getKitchenState(db, vero)).toEqual(before);

    // Undo is your own (H3): Vero can't undo Levi's; Levi's one Undo restores the list, the kitchen and the card.
    const refused = unwrap(await undo(db, vero, { changeSetId: added.changeSetId, ...(await tapArgs(vero)) }));
    expect(refused.rejected.map((r) => r.reason.code)).toEqual(["NOT_ALLOWED"]);
    const undone = unwrap(await undo(db, levi, { changeSetId: added.changeSetId, ...(await tapArgs(levi)) }));
    expect(undone.rejected).toEqual([]);
    expect(undone.state.items).toEqual([]);
    expect(undone.state.shoppingList.map((e) => e.name.value)).toEqual(["garlic", "ginger", "shallot", "oatmilk"]);
    expect(undone.state.toReview.map((r) => [r.id, r.items.map((e) => e.name)])).toEqual([[card.id, ["garlic", "ginger", "shallot"]]]);
  });

  it("Add is all or nothing: an unticked item refuses it and nothing changes; a double tap is harmless", async () => {
    const { vero, ids } = await shopped();
    const card = unwrap(await queueShoppingReview(db, vero, { ...(await tapArgs(vero)), shoppingItemIds: [ids.garlic, ids.shallot] }))
      .state.toReview[0];

    const refused = unwrap(
      await resolveReview(db, vero, { ...(await tapArgs(vero)), reviewId: card.id, outcome: "done", shoppingItemIds: [ids.garlic, ids.shallot] }),
    );
    expect(refused.rejected.map((r) => r.reason.code)).toEqual(["NOT_TICKED"]);
    expect(refused.state.items).toEqual([]);
    expect(refused.state.toReview.map((r) => r.id)).toEqual([card.id]);

    const args = { ...(await tapArgs(vero)), reviewId: card.id, outcome: "done" as const, shoppingItemIds: [ids.garlic] };
    const first = unwrap(await resolveReview(db, vero, args));
    const second = unwrap(await resolveReview(db, vero, args));
    expect(second.changeSetId).toBe(first.changeSetId);
    expect(second.state.items.map((i) => i.name.value)).toEqual(["garlic"]);
  });

  it("Skip closes the card and leaves the list as it was; Do later again adds to the one card", async () => {
    const { vero, ids } = await shopped();
    unwrap(await queueShoppingReview(db, vero, { ...(await tapArgs(vero)), shoppingItemIds: [ids.garlic] }));
    const again = unwrap(await queueShoppingReview(db, vero, { ...(await tapArgs(vero)), shoppingItemIds: [ids.oatmilk, ids.garlic] }));
    expect(again.state.toReview).toHaveLength(1);
    expect(again.state.toReview[0].items.map((e) => e.name)).toEqual(["garlic", "oatmilk"]);

    const listBefore = again.state.shoppingList;
    const skipped = unwrap(await resolveReview(db, vero, { ...(await tapArgs(vero)), reviewId: again.state.toReview[0].id, outcome: "skipped" }));
    expect(skipped.applied[0].summary.code).toBe("REVIEW_RESOLVED");
    expect(skipped.state.toReview).toEqual([]);
    expect(skipped.state.shoppingList).toEqual(listBefore.map((e) => ({ ...e })));
    expect(skipped.state.items).toEqual([]);
  });

  it("a meal's card still works after the migration, and reads back as origin 'meal'", async () => {
    const t = await newKitchen(db);
    const vero = await t.scope("Vero");
    const { ideas } = await recordMealIdeas(db, vero, { basedOnVersion: 0, ideas: [{ name: "Beef pho", why: "", uses: [], missing: [] }] });
    const mealId = (await ok(db, vero, primaryJourney.choose(ideas[0].ideaId))).applied[0].refs[0].id;
    const result = await ok(db, vero, [{ type: "review.queue", kind: "add-to-kitchen", mealId, items: [{ name: "onion" }] }]);
    expect(result.state.toReview[0]).toMatchObject({ origin: "meal", meal: { id: mealId }, items: [{ name: "onion" }] });
    const [row] = await db.select().from(reviews).where(eq(reviews.kitchenId, t.kitchenId));
    expect(row).toMatchObject({ origin: "meal", mealId });
  });
});
