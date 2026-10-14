/**
 * Kitchen reads (backend-data.md §6): state, version, changes since a version, and a recipe.
 * Every function takes a `KitchenScope`, so the membership check can't be skipped.
 * Reads never throw because of bad or missing rows (0018).
 */
import { and, asc, eq, gt, isNotNull } from "drizzle-orm";
import { changeSets, kitchens } from "@/db/schema";
import type { Queryable } from "@/db/client";
import { ChangeSetSummary, type ChangeSetSummary as ChangeSetSummaryT } from "@/contracts/apply-result";
import type { KitchenState, RecipeView, ShoppingItemRow } from "@/contracts/kitchen-state";
import { loadNames } from "@/shared/identity";
import { listMembers, type KitchenScope } from "@/shared/membership";
import { loadProfiles } from "@/shared/profile/store";
import type { Restriction } from "@/shared/profile/state";
import type { Via } from "@/shared/events/types";
import { actorRef, buildKitchenState, buildRecipeView } from "./read-model";
import type { KitchenEntities } from "./state";
import { loadKitchenEntities } from "./store";

export async function getKitchenVersion(db: Queryable, scope: KitchenScope): Promise<number> {
  const rows = await db.select({ version: kitchens.version }).from(kitchens).where(eq(kitchens.id, scope.kitchenId));
  return rows[0]?.version ?? 0;
}

function actorIds(kitchen: KitchenEntities): string[] {
  const ids = new Set<string>();
  for (const coll of [kitchen.items, kitchen.meals, kitchen.recipes, kitchen.ticks, kitchen.reviews, kitchen.shopping]) {
    for (const e of Object.values(coll)) {
      ids.add(e.createdBy);
      ids.add(e.updatedBy);
    }
  }
  for (const e of Object.values(kitchen.shopping)) if (e.tickedBy) ids.add(e.tickedBy);
  return [...ids];
}

/** Everything the read model needs besides the entities. */
export async function loadReadContext(db: Queryable, kitchenId: string, kitchen: KitchenEntities) {
  const members = await listMembers(db, kitchenId);
  const profiles = await loadProfiles(
    db,
    members.map((m) => m.userId),
  );
  const restrictions: Restriction[] = Object.values(profiles.restrictions);
  const names = await loadNames(db, actorIds(kitchen));
  for (const m of members) names.set(m.userId, m.displayName);
  return { names, restrictions };
}

/** Internal: also used by commands inside their transaction. */
export async function readKitchenState(db: Queryable, kitchenId: string): Promise<KitchenState> {
  const [kitchen, versionRows] = await Promise.all([
    loadKitchenEntities(db, kitchenId),
    db.select({ version: kitchens.version }).from(kitchens).where(eq(kitchens.id, kitchenId)),
  ]);
  const ctx = await loadReadContext(db, kitchenId, kitchen);
  return buildKitchenState(kitchen, { kitchenId, version: versionRows[0]?.version ?? 0, ...ctx });
}

export async function getKitchenState(db: Queryable, scope: KitchenScope): Promise<KitchenState> {
  return readKitchenState(db, scope.kitchenId);
}

/** The shared shopping list (0027): open items in the order added. Same as `KitchenState.shoppingList`. */
export async function getShoppingList(db: Queryable, scope: KitchenScope): Promise<ShoppingItemRow[]> {
  return (await readKitchenState(db, scope.kitchenId)).shoppingList;
}

/** The latest recipe for a meal, or null. */
export async function getRecipe(db: Queryable, scope: KitchenScope, mealId: string): Promise<RecipeView | null> {
  const kitchen = await loadKitchenEntities(db, scope.kitchenId);
  const ctx = await loadReadContext(db, scope.kitchenId, kitchen);
  return buildRecipeView(kitchen, mealId, ctx);
}

/** Change-set summaries after `sinceVersion`, oldest first: "Since your last visit". */
export async function getChangesSince(
  db: Queryable,
  scope: KitchenScope,
  sinceVersion: number,
): Promise<ChangeSetSummaryT[]> {
  const rows = await db
    .select()
    .from(changeSets)
    .where(
      and(eq(changeSets.kitchenId, scope.kitchenId), isNotNull(changeSets.version), gt(changeSets.version, sinceVersion)),
    )
    .orderBy(asc(changeSets.version));
  const names = await loadNames(
    db,
    rows.map((r) => r.actorId),
  );
  const out: ChangeSetSummaryT[] = [];
  for (const r of rows) {
    const parsed = ChangeSetSummary.safeParse({
      changeSetId: r.id,
      version: r.version,
      actor: actorRef(r.actorId, names),
      via: r.via as Via,
      at: r.createdAt.toISOString(),
      summaries: r.summaries,
      undone: r.revertedByChangeSetId !== null,
    });
    if (parsed.success) out.push(parsed.data);
    else console.error("kitchen.read: dropped a change-set summary", { id: r.id, issues: parsed.error.issues });
  }
  return out;
}
