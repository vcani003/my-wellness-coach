/**
 * Kitchen projections: read them into the pure state, and write touched entities back in the
 * same transaction as their events (backend-data.md §3).
 */
import { and, eq } from "drizzle-orm";
import { checklistTicks, itemBatches, itemCategoryPrefs, itemLocationPrefs, items, meals, recipes, reviews, shoppingItems, staples } from "@/db/schema";
import type { Queryable } from "@/db/client";
import type { ItemCategory, Location, MealStatus, ReviewKind, ReviewOrigin, ShoppingSource } from "@/contracts/common";
import { compact, splitEntityKey } from "@/shared/events/types";
import type { CategoryPref, Item, KitchenEntities, LocationPref, Meal, Recipe, Review, ShoppingItem, ShoppingStatus, Staple, Tick } from "./state";
import { tickId } from "./state";
import { deriveItem, ensureBatches, type Batch, type BatchCloseReason } from "./batches";

const iso = (d: Date) => d.toISOString();
const isoOpt = (d: Date | null) => (d ? d.toISOString() : undefined);
const date = (s: string) => new Date(s);
const dateOpt = (s: string | undefined) => (s ? new Date(s) : null);

type AuditRow = { createdAt: Date; createdBy: string; updatedAt: Date; updatedBy: string };
const auditFrom = (r: AuditRow) => ({
  createdAt: iso(r.createdAt),
  createdBy: r.createdBy,
  updatedAt: iso(r.updatedAt),
  updatedBy: r.updatedBy,
});
const auditTo = (e: { createdAt: string; createdBy: string; updatedAt: string; updatedBy: string }) => ({
  createdAt: date(e.createdAt),
  createdBy: e.createdBy,
  updatedAt: date(e.updatedAt),
  updatedBy: e.updatedBy,
});

export function batchFromRow(r: typeof itemBatches.$inferSelect): Batch {
  return compact({
    id: r.id,
    addedAt: iso(r.addedAt),
    occurredAt: r.occurredAt ?? undefined,
    quantity: r.quantity ?? undefined,
    location: r.location ?? undefined,
    frozen: r.frozen ?? undefined,
    opened: r.opened ?? undefined,
    stock: r.stock ?? undefined,
    defrostedOn: r.defrostedOn ?? undefined,
    lastUsedAt: isoOpt(r.lastUsedAt),
    keptAt: isoOpt(r.keptAt),
    closedAt: isoOpt(r.closedAt),
    closedReason: (r.closedReason ?? undefined) as BatchCloseReason | undefined,
    ...auditFrom(r),
  });
}

/**
 * An item and its batches. With no batch rows (written by a build from before batches), it gets
 * its one legacy batch, exactly as migration 0008 backfills it (0018, 0028).
 */
export function itemFromRow(r: typeof items.$inferSelect, batchRows: (typeof itemBatches.$inferSelect)[] = []): Item {
  const base = compact({
    id: r.id,
    name: r.name,
    standardName: r.standardName,
    category: r.category ?? undefined,
    quantity: r.quantity ?? undefined,
    location: r.location ?? undefined,
    frozen: r.frozen ?? undefined,
    opened: r.opened ?? undefined,
    stock: r.stock ?? undefined,
    occurredAt: r.occurredAt ?? undefined,
    addedAt: iso(r.addedAt),
    lastUsedAt: isoOpt(r.lastUsedAt),
    ...auditFrom(r),
  });
  if (batchRows.length === 0) return ensureBatches(base);
  const batches = [...batchRows].sort((a, b) => a.position - b.position).map(batchFromRow);
  return deriveItem({ ...base, batches });
}

export function mealFromRow(r: typeof meals.$inferSelect): Meal {
  return compact({
    id: r.id,
    title: r.title,
    status: r.status as MealStatus,
    ideaId: r.ideaId ?? undefined,
    planPosition: r.planPosition ?? undefined,
    chosenAt: iso(r.chosenAt),
    recipeId: r.recipeId ?? undefined,
    note: r.note ?? undefined,
    cookedAt: isoOpt(r.cookedAt),
    cookedBy: r.cookedBy ?? undefined,
    noteBy: r.noteBy ?? undefined,
    madeAgainFromMealId: r.madeAgainFromMealId ?? undefined,
    ...auditFrom(r),
  });
}

export function recipeFromRow(r: typeof recipes.$inferSelect): Recipe {
  return {
    id: r.id,
    mealId: r.mealId,
    version: r.version,
    source: r.source as Recipe["source"],
    text: r.text,
    ingredients: r.ingredients,
    steps: r.steps,
    basicsAssumed: r.basicsAssumed,
    ...(r.copiedFromRecipeId ? { copiedFromRecipeId: r.copiedFromRecipeId } : {}),
    ...auditFrom(r),
  };
}

export function tickFromRow(r: typeof checklistTicks.$inferSelect): Tick {
  return { mealId: r.mealId, ingredient: r.ingredient, ingredientKey: r.ingredientKey, ...auditFrom(r) };
}

export function reviewFromRow(r: typeof reviews.$inferSelect): Review {
  return compact({
    id: r.id,
    kind: r.kind as ReviewKind,
    origin: r.origin as ReviewOrigin,
    // '' = no meal: a shopping-list card (see the `reviews` table).
    mealId: r.mealId || undefined,
    items: r.items,
    status: r.status as Review["status"],
    ...auditFrom(r),
  });
}

export function shoppingFromRow(r: typeof shoppingItems.$inferSelect): ShoppingItem {
  return compact({
    id: r.id,
    name: r.name,
    standardName: r.standardName,
    quantity: r.quantity ?? undefined,
    store: r.store ?? undefined,
    source: r.source as ShoppingSource,
    position: r.position,
    status: r.status as ShoppingStatus,
    tickedAt: isoOpt(r.tickedAt),
    tickedBy: r.tickedBy ?? undefined,
    movedToItemId: r.movedToItemId ?? undefined,
    ...auditFrom(r),
  });
}

export function categoryPrefFromRow(r: typeof itemCategoryPrefs.$inferSelect): CategoryPref {
  return { standardName: r.standardName, category: r.category as ItemCategory, ...auditFrom(r) };
}

export function locationPrefFromRow(r: typeof itemLocationPrefs.$inferSelect): LocationPref {
  return { standardName: r.standardName, location: r.location as Location, ...auditFrom(r) };
}

export function stapleFromRow(r: typeof staples.$inferSelect): Staple {
  return compact({ standardName: r.standardName, name: r.name, store: r.store ?? undefined, ...auditFrom(r) });
}

/** The whole kitchen as the pure state (all rows, including done meals and `out` items). */
export async function loadKitchenEntities(db: Queryable, kitchenId: string): Promise<KitchenEntities> {
  const [itemRows, batchRows, mealRows, recipeRows, tickRows, reviewRows, shoppingRows, prefRows, placeRows, stapleRows] = await Promise.all([
    db.select().from(items).where(eq(items.kitchenId, kitchenId)),
    db.select().from(itemBatches).where(eq(itemBatches.kitchenId, kitchenId)),
    db.select().from(meals).where(eq(meals.kitchenId, kitchenId)),
    db.select().from(recipes).where(eq(recipes.kitchenId, kitchenId)),
    db.select().from(checklistTicks).where(eq(checklistTicks.kitchenId, kitchenId)),
    db.select().from(reviews).where(eq(reviews.kitchenId, kitchenId)),
    db.select().from(shoppingItems).where(eq(shoppingItems.kitchenId, kitchenId)),
    db.select().from(itemCategoryPrefs).where(eq(itemCategoryPrefs.kitchenId, kitchenId)),
    db.select().from(itemLocationPrefs).where(eq(itemLocationPrefs.kitchenId, kitchenId)),
    db.select().from(staples).where(eq(staples.kitchenId, kitchenId)),
  ]);
  const batchesByItem = new Map<string, (typeof itemBatches.$inferSelect)[]>();
  for (const b of batchRows) batchesByItem.set(b.itemId, [...(batchesByItem.get(b.itemId) ?? []), b]);
  return {
    items: Object.fromEntries(itemRows.map((r) => [r.id, itemFromRow(r, batchesByItem.get(r.id))])),
    meals: Object.fromEntries(mealRows.map((r) => [r.id, mealFromRow(r)])),
    recipes: Object.fromEntries(recipeRows.map((r) => [r.id, recipeFromRow(r)])),
    ticks: Object.fromEntries(tickRows.map((r) => [tickId(r.mealId, r.ingredientKey), tickFromRow(r)])),
    reviews: Object.fromEntries(reviewRows.map((r) => [r.id, reviewFromRow(r)])),
    shopping: Object.fromEntries(shoppingRows.map((r) => [r.id, shoppingFromRow(r)])),
    categoryPrefs: Object.fromEntries(prefRows.map((r) => [r.standardName, categoryPrefFromRow(r)])),
    locationPrefs: Object.fromEntries(placeRows.map((r) => [r.standardName, locationPrefFromRow(r)])),
    staples: Object.fromEntries(stapleRows.map((r) => [r.standardName, stapleFromRow(r)])),
  };
}

/** Write the current value of each touched entity: delete, then insert if it still exists. */
export async function persistKitchenEntities(
  db: Queryable,
  kitchenId: string,
  state: KitchenEntities,
  keys: Iterable<string>,
): Promise<void> {
  for (const key of keys) {
    const { kind, id } = splitEntityKey(key);
    switch (kind) {
      case "item": {
        await db.delete(items).where(and(eq(items.kitchenId, kitchenId), eq(items.id, id)));
        await db.delete(itemBatches).where(and(eq(itemBatches.kitchenId, kitchenId), eq(itemBatches.itemId, id)));
        const e = state.items[id];
        if (e) {
          await db.insert(items).values({
            id: e.id,
            kitchenId,
            name: e.name,
            standardName: e.standardName,
            category: e.category ?? null,
            quantity: e.quantity ?? null,
            location: e.location ?? null,
            frozen: e.frozen ?? null,
            opened: e.opened ?? null,
            stock: e.stock ?? null,
            occurredAt: e.occurredAt ?? null,
            addedAt: date(e.addedAt),
            lastUsedAt: dateOpt(e.lastUsedAt),
            ...auditTo(e),
          });
          const batches = e.batches ?? [];
          if (batches.length) {
            await db.insert(itemBatches).values(
              batches.map((b, position) => ({
                id: b.id,
                kitchenId,
                itemId: e.id,
                position,
                addedAt: date(b.addedAt),
                occurredAt: b.occurredAt ?? null,
                quantity: b.quantity ?? null,
                location: b.location ?? null,
                frozen: b.frozen ?? null,
                opened: b.opened ?? null,
                stock: b.stock ?? null,
                defrostedOn: b.defrostedOn ?? null,
                lastUsedAt: dateOpt(b.lastUsedAt),
                keptAt: dateOpt(b.keptAt),
                closedAt: dateOpt(b.closedAt),
                closedReason: b.closedReason ?? null,
                ...auditTo(b),
              })),
            );
          }
        }
        break;
      }
      case "meal": {
        await db.delete(meals).where(and(eq(meals.kitchenId, kitchenId), eq(meals.id, id)));
        const e = state.meals[id];
        if (e) {
          await db.insert(meals).values({
            id: e.id,
            kitchenId,
            title: e.title,
            status: e.status,
            ideaId: e.ideaId ?? null,
            planPosition: e.planPosition ?? null,
            chosenAt: date(e.chosenAt),
            recipeId: e.recipeId ?? null,
            note: e.note ?? null,
            cookedAt: dateOpt(e.cookedAt),
            cookedBy: e.cookedBy ?? null,
            noteBy: e.noteBy ?? null,
            madeAgainFromMealId: e.madeAgainFromMealId ?? null,
            ...auditTo(e),
          });
        }
        break;
      }
      case "recipe": {
        await db.delete(recipes).where(and(eq(recipes.kitchenId, kitchenId), eq(recipes.id, id)));
        const e = state.recipes[id];
        if (e) {
          await db.insert(recipes).values({
            id: e.id,
            kitchenId,
            mealId: e.mealId,
            version: e.version,
            source: e.source,
            text: e.text,
            ingredients: e.ingredients,
            steps: e.steps,
            basicsAssumed: e.basicsAssumed,
            copiedFromRecipeId: e.copiedFromRecipeId ?? null,
            ...auditTo(e),
          });
        }
        break;
      }
      case "tick": {
        const e = state.ticks[id];
        const [mealId, ingredientKey] = [id.slice(0, id.indexOf("|")), id.slice(id.indexOf("|") + 1)];
        await db
          .delete(checklistTicks)
          .where(
            and(
              eq(checklistTicks.kitchenId, kitchenId),
              eq(checklistTicks.mealId, mealId),
              eq(checklistTicks.ingredientKey, ingredientKey),
            ),
          );
        if (e) {
          await db.insert(checklistTicks).values({
            kitchenId,
            mealId: e.mealId,
            ingredientKey: e.ingredientKey,
            ingredient: e.ingredient,
            ...auditTo(e),
          });
        }
        break;
      }
      case "review": {
        await db.delete(reviews).where(and(eq(reviews.kitchenId, kitchenId), eq(reviews.id, id)));
        const e = state.reviews[id];
        if (e) {
          await db.insert(reviews).values({
            id: e.id,
            kitchenId,
            kind: e.kind,
            origin: e.origin,
            mealId: e.mealId ?? "",
            items: e.items,
            status: e.status,
            ...auditTo(e),
          });
        }
        break;
      }
      case "shopping": {
        await db.delete(shoppingItems).where(and(eq(shoppingItems.kitchenId, kitchenId), eq(shoppingItems.id, id)));
        const e = state.shopping[id];
        if (e) {
          await db.insert(shoppingItems).values({
            id: e.id,
            kitchenId,
            name: e.name,
            standardName: e.standardName,
            quantity: e.quantity ?? null,
            store: e.store ?? null,
            source: e.source,
            position: e.position,
            status: e.status,
            tickedAt: dateOpt(e.tickedAt),
            tickedBy: e.tickedBy ?? null,
            movedToItemId: e.movedToItemId ?? null,
            ...auditTo(e),
          });
        }
        break;
      }
      case "catpref": {
        await db
          .delete(itemCategoryPrefs)
          .where(and(eq(itemCategoryPrefs.kitchenId, kitchenId), eq(itemCategoryPrefs.standardName, id)));
        const e = state.categoryPrefs[id];
        if (e) {
          await db.insert(itemCategoryPrefs).values({ kitchenId, standardName: e.standardName, category: e.category, ...auditTo(e) });
        }
        break;
      }
      case "locpref": {
        await db
          .delete(itemLocationPrefs)
          .where(and(eq(itemLocationPrefs.kitchenId, kitchenId), eq(itemLocationPrefs.standardName, id)));
        const e = state.locationPrefs?.[id];
        if (e) {
          await db.insert(itemLocationPrefs).values({ kitchenId, standardName: e.standardName, location: e.location, ...auditTo(e) });
        }
        break;
      }
      case "staple": {
        await db.delete(staples).where(and(eq(staples.kitchenId, kitchenId), eq(staples.standardName, id)));
        const e = state.staples?.[id];
        if (e) {
          await db.insert(staples).values({ kitchenId, standardName: e.standardName, name: e.name, store: e.store ?? null, ...auditTo(e) });
        }
        break;
      }
      default:
        // Profile keys are persisted by the shared profile store.
        break;
    }
  }
}

/** Replace every projection row of a kitchen (rebuild-projections). */
export async function replaceKitchenProjections(db: Queryable, kitchenId: string, state: KitchenEntities): Promise<void> {
  await db.delete(items).where(eq(items.kitchenId, kitchenId));
  await db.delete(itemBatches).where(eq(itemBatches.kitchenId, kitchenId));
  await db.delete(meals).where(eq(meals.kitchenId, kitchenId));
  await db.delete(recipes).where(eq(recipes.kitchenId, kitchenId));
  await db.delete(checklistTicks).where(eq(checklistTicks.kitchenId, kitchenId));
  await db.delete(reviews).where(eq(reviews.kitchenId, kitchenId));
  await db.delete(shoppingItems).where(eq(shoppingItems.kitchenId, kitchenId));
  await db.delete(itemCategoryPrefs).where(eq(itemCategoryPrefs.kitchenId, kitchenId));
  await db.delete(itemLocationPrefs).where(eq(itemLocationPrefs.kitchenId, kitchenId));
  await db.delete(staples).where(eq(staples.kitchenId, kitchenId));
  const keys = [
    ...Object.keys(state.items).map((id) => `item:${id}`),
    ...Object.keys(state.meals).map((id) => `meal:${id}`),
    ...Object.keys(state.recipes).map((id) => `recipe:${id}`),
    ...Object.keys(state.ticks).map((id) => `tick:${id}`),
    ...Object.keys(state.reviews).map((id) => `review:${id}`),
    ...Object.keys(state.shopping).map((id) => `shopping:${id}`),
    ...Object.keys(state.categoryPrefs).map((id) => `catpref:${id}`),
    ...Object.keys(state.locationPrefs ?? {}).map((id) => `locpref:${id}`),
    ...Object.keys(state.staples ?? {}).map((id) => `staple:${id}`),
  ];
  await persistKitchenEntities(db, kitchenId, state, keys);
}
