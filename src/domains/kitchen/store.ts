/**
 * Kitchen projections: read them into the pure state, and write touched entities back in the
 * same transaction as their events (backend-data.md §3).
 */
import { and, eq } from "drizzle-orm";
import { checklistTicks, items, meals, recipes, reviews } from "@/db/schema";
import type { Queryable } from "@/db/client";
import type { MealStatus, ReviewKind } from "@/contracts/common";
import { compact, splitEntityKey } from "@/shared/events/types";
import type { Item, KitchenEntities, Meal, Recipe, Review, Tick } from "./state";
import { tickId } from "./state";

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

export function itemFromRow(r: typeof items.$inferSelect): Item {
  return compact({
    id: r.id,
    name: r.name,
    standardName: r.standardName,
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
    ...auditFrom(r),
  };
}

export function tickFromRow(r: typeof checklistTicks.$inferSelect): Tick {
  return { mealId: r.mealId, ingredient: r.ingredient, ingredientKey: r.ingredientKey, ...auditFrom(r) };
}

export function reviewFromRow(r: typeof reviews.$inferSelect): Review {
  return {
    id: r.id,
    kind: r.kind as ReviewKind,
    mealId: r.mealId,
    items: r.items,
    status: r.status as Review["status"],
    ...auditFrom(r),
  };
}

/** The whole kitchen as the pure state (all rows, including done meals and `out` items). */
export async function loadKitchenEntities(db: Queryable, kitchenId: string): Promise<KitchenEntities> {
  const [itemRows, mealRows, recipeRows, tickRows, reviewRows] = await Promise.all([
    db.select().from(items).where(eq(items.kitchenId, kitchenId)),
    db.select().from(meals).where(eq(meals.kitchenId, kitchenId)),
    db.select().from(recipes).where(eq(recipes.kitchenId, kitchenId)),
    db.select().from(checklistTicks).where(eq(checklistTicks.kitchenId, kitchenId)),
    db.select().from(reviews).where(eq(reviews.kitchenId, kitchenId)),
  ]);
  return {
    items: Object.fromEntries(itemRows.map((r) => [r.id, itemFromRow(r)])),
    meals: Object.fromEntries(mealRows.map((r) => [r.id, mealFromRow(r)])),
    recipes: Object.fromEntries(recipeRows.map((r) => [r.id, recipeFromRow(r)])),
    ticks: Object.fromEntries(tickRows.map((r) => [tickId(r.mealId, r.ingredientKey), tickFromRow(r)])),
    reviews: Object.fromEntries(reviewRows.map((r) => [r.id, reviewFromRow(r)])),
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
        const e = state.items[id];
        if (e) {
          await db.insert(items).values({
            id: e.id,
            kitchenId,
            name: e.name,
            standardName: e.standardName,
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
            mealId: e.mealId,
            items: e.items,
            status: e.status,
            ...auditTo(e),
          });
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
  await db.delete(meals).where(eq(meals.kitchenId, kitchenId));
  await db.delete(recipes).where(eq(recipes.kitchenId, kitchenId));
  await db.delete(checklistTicks).where(eq(checklistTicks.kitchenId, kitchenId));
  await db.delete(reviews).where(eq(reviews.kitchenId, kitchenId));
  const keys = [
    ...Object.keys(state.items).map((id) => `item:${id}`),
    ...Object.keys(state.meals).map((id) => `meal:${id}`),
    ...Object.keys(state.recipes).map((id) => `recipe:${id}`),
    ...Object.keys(state.ticks).map((id) => `tick:${id}`),
    ...Object.keys(state.reviews).map((id) => `review:${id}`),
  ];
  await persistKitchenEntities(db, kitchenId, state, keys);
}
