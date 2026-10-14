/**
 * The shopping list on Postgres (PGlite, the real migrations, 0003_shopping_list): Vero's message
 * from the first real test, shared ticks, "Done shopping", Undo, idempotent taps, membership and
 * the projection matching a replay of the log.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { shoppingItems } from "@/db/schema";
import {
  addShoppingItems,
  doneShopping,
  rebuildProjections,
  removeShoppingItem,
  tickShoppingItem,
  undo,
} from "@/domains/kitchen/commands";
import { getKitchenState, getKitchenVersion, getShoppingList } from "@/domains/kitchen/queries";
import { NotAMemberError, requireMember } from "@/shared/membership";
import type { KitchenScope } from "@/shared/membership";
import { said } from "../support/memory-kitchen";
import { newKitchen, ok, openLocalDb } from "../support/db";
import { PHO_LIST, PHO_MESSAGE, phoShoppingOps } from "../support/shopping";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await openLocalDb());
});
afterAll(async () => {
  await close();
});

let taps = 0;
const tapArgs = async (scope: KitchenScope) => ({ tapId: `tap-${++taps}`, basedOnVersion: await getKitchenVersion(db, scope) });
const unwrap = <T extends { ok: boolean }>(o: T) => {
  if (!o.ok) throw new Error(`failed: ${JSON.stringify(o)}`);
  return (o as unknown as { result: import("@/contracts/apply-result").ApplyResult }).result;
};
const idOf = async (scope: KitchenScope, name: string) => {
  const e = (await getShoppingList(db, scope)).find((x) => x.name.value === name);
  if (!e) throw new Error(`${name} not on the list`);
  return e.id;
};

describe("Vero's grocery message on Postgres", () => {
  it("saves the list with ginger merged and two stores, shared by both members", async () => {
    const t = await newKitchen(db, ["Vero", "Levi"]);
    const vero = await t.scope("Vero");
    const levi = await t.scope("Levi");

    const result = await ok(db, vero, phoShoppingOps, { text: PHO_MESSAGE });
    expect(result.rejected).toEqual([]);
    expect(result.state.shoppingList.map((e) => [e.name.value, e.store?.value])).toEqual(PHO_LIST.map(([n, s]) => [n, s]));
    expect(new Set(result.state.shoppingList.map((e) => e.store?.value))).toEqual(new Set(["MD Oriental Market", "Publix"]));

    // Levi sees the same list and ticks from it; Vero ticks too.
    expect((await getKitchenState(db, levi)).shoppingList).toHaveLength(9);
    unwrap(await tickShoppingItem(db, vero, { ...(await tapArgs(vero)), shoppingItemId: await idOf(vero, "garlic"), ticked: true }));
    unwrap(await tickShoppingItem(db, levi, { ...(await tapArgs(levi)), shoppingItemId: await idOf(levi, "ginger"), ticked: true }));
    const ticked = unwrap(
      await tickShoppingItem(db, levi, { ...(await tapArgs(levi)), shoppingItemId: await idOf(levi, "oatmilk"), ticked: true }),
    );
    const by = Object.fromEntries(ticked.state.shoppingList.filter((e) => e.ticked).map((e) => [e.name.value, e.ticked!.by]));
    expect(by).toEqual({
      garlic: { id: t.userIds.Vero, name: "Vero" },
      ginger: { id: t.userIds.Levi, name: "Levi" },
      oatmilk: { id: t.userIds.Levi, name: "Levi" },
    });

    // Done shopping with garlic and ginger chosen; oatmilk stays ticked on the list.
    const done = unwrap(
      await doneShopping(db, vero, {
        ...(await tapArgs(vero)),
        items: [{ shoppingItemId: await idOf(vero, "garlic") }, { shoppingItemId: await idOf(vero, "ginger") }],
      }),
    );
    expect(done.rejected).toEqual([]);
    expect(done.undoable).toBe(true);
    expect(done.state.items.map((i) => i.name.value).sort()).toEqual(["garlic", "ginger"]);
    expect(done.state.shoppingList.map((e) => e.name.value)).not.toContain("garlic");
    expect(done.state.shoppingList.find((e) => e.name.value === "oatmilk")?.ticked).toBeDefined();
    const garlicRow = await db.select().from(shoppingItems).where(eq(shoppingItems.kitchenId, t.kitchenId));
    expect(garlicRow.filter((r) => r.status === "moved").map((r) => r.movedToItemId)).toHaveLength(2);

    // The projection equals a full replay of the log.
    const before = await getKitchenState(db, vero);
    await rebuildProjections(db, vero);
    expect(await getKitchenState(db, vero)).toEqual(before);

    // One Undo restores both the kitchen and the list.
    const undone = await undo(db, vero, { changeSetId: done.changeSetId, tapId: `tap-${++taps}`, basedOnVersion: done.newVersion });
    const restored = unwrap(undone).state;
    expect(restored.items).toEqual([]);
    expect(restored.shoppingList.filter((e) => e.ticked).map((e) => e.name.value)).toEqual(["garlic", "ginger", "oatmilk"]);
  });

  it("buying in chat takes the item off the list in the same change set (SL5 Rec)", async () => {
    const t = await newKitchen(db);
    const vero = await t.scope("Vero");
    await ok(db, vero, phoShoppingOps, { text: PHO_MESSAGE });
    const bought = await ok(db, vero, [{ type: "item.add", evidence: "lemongrass", fields: { name: said("lemongrass") } }], {
      text: "I bought lemongrass",
    });
    expect(bought.state.shoppingList.map((e) => e.name.value)).not.toContain("lemongrass");
    const undone = unwrap(await undo(db, vero, { changeSetId: bought.changeSetId, tapId: `tap-${++taps}`, basedOnVersion: bought.newVersion }));
    expect(undone.state.shoppingList.map((e) => e.name.value)).toContain("lemongrass");
    expect(undone.state.items).toEqual([]);
  });
});

describe("shopping-list buttons", () => {
  it("a double tap is harmless; a stale tap is refused; another kitchen is out of reach", async () => {
    const t = await newKitchen(db, ["Vero", "Levi"]);
    const vero = await t.scope("Vero");
    const levi = await t.scope("Levi");
    unwrap(
      await addShoppingItems(db, vero, {
        ...(await tapArgs(vero)),
        source: "stock-offer",
        items: [{ name: "fish sauce", store: "MD Oriental Market" }, { name: "eggs" }],
      }),
    );
    const eggs = await idOf(vero, "eggs");

    const args = { ...(await tapArgs(vero)), shoppingItemId: eggs };
    const first = unwrap(await removeShoppingItem(db, vero, args));
    const second = unwrap(await removeShoppingItem(db, vero, args));
    expect(second.changeSetId).toBe(first.changeSetId);
    expect(second.state.shoppingList.map((e) => e.name.value)).toEqual(["fish sauce"]);
    expect(second.state.shoppingList[0].source).toBe("stock-offer");

    // Levi ticks fish sauce based on an old version, after Vero unticked/ticked it: STALE_TARGET.
    const fish = await idOf(vero, "fish sauce");
    const oldVersion = await getKitchenVersion(db, levi);
    unwrap(await tickShoppingItem(db, vero, { ...(await tapArgs(vero)), shoppingItemId: fish, ticked: true }));
    const stale = unwrap(
      await doneShopping(db, levi, { tapId: `tap-${++taps}`, basedOnVersion: oldVersion, items: [{ shoppingItemId: fish }] }),
    );
    expect(stale.rejected.map((r) => r.reason.code)).toEqual(["STALE_TARGET"]);

    // Someone from another kitchen can't get a scope here, and a scope for their own kitchen
    // can't reach this list item.
    const other = await newKitchen(db, ["Mallory"]);
    await expect(requireMember(db, other.userIds.Mallory, t.kitchenId)).rejects.toBeInstanceOf(NotAMemberError);
    const mallory = await other.scope("Mallory");
    const denied = unwrap(await tickShoppingItem(db, mallory, { ...(await tapArgs(mallory)), shoppingItemId: fish, ticked: false }));
    expect(denied.rejected.map((r) => r.reason.code)).toEqual(["UNKNOWN_TARGET"]);
    expect((await getShoppingList(db, vero))[0].ticked).toBeDefined();
  });
});
