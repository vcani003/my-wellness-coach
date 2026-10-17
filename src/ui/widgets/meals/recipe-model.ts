/**
 * One display model for the Recipe screen, from either a recipe streaming in (the session draft)
 * or a saved one read on the server (RecipeView). Pure, so it's easy to test.
 * - The checklist is ONE list in two groups (0013): **In your kitchen** (matched kitchen items and
 *   the assumed basics, 0019) and **Need**.
 * - Ticks are shared (M6): each row says who ticked it.
 */
import type { AllergenFlag, Msg } from "@/contracts/common";
import type { KitchenState, RecipeView } from "@/contracts/kitchen-state";
import type { IngredientGroup, RecipeDraft } from "./session";

export interface RecipeRow {
  name: string;
  amount?: string;
  group: IngredientGroup;
  allergenFlags: AllergenFlag[];
  /** Added or changed by the latest refinement (a brief highlight). */
  changed?: true;
}

export interface RecipeDisplay {
  title?: string;
  source: "ai" | "user";
  allergenFlags: AllergenFlag[];
  ingredients: RecipeRow[];
  steps: string[];
  basics: string[];
  basicsNote: Msg | null;
  /** writing = parts still arriving; saved = ticks and "Add Need items" work. */
  status: "writing" | "saved" | "failed" | "missing";
  version?: number;
  /** Step positions added or changed by the latest refinement (a brief highlight). */
  changedSteps?: number[];
  /** Changes with each refinement, so a line changed again highlights again. */
  changeKey?: string;
}

const same = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

export function fromView(view: RecipeView): RecipeDisplay {
  return {
    title: "missing" in view.meal ? undefined : view.meal.title,
    source: view.source,
    allergenFlags: view.allergenFlags,
    ingredients: view.ingredients.map((i) => ({
      name: i.name,
      ...(i.amount ? { amount: i.amount } : {}),
      group: i.item && !("missing" in i.item) ? "kitchen" : i.basic ? "basic" : "need",
      allergenFlags: view.allergenFlags.filter((f) => same(f.ingredient, i.name)),
    })),
    steps: view.steps,
    basics: view.basicsAssumed,
    basicsNote: null,
    status: "saved",
    version: view.version,
  };
}

export function fromDraft(draft: RecipeDraft): RecipeDisplay {
  const changedIngredients = new Set(draft.changed?.ingredients ?? []);
  return {
    title: draft.title,
    source: draft.source ?? "ai",
    allergenFlags: draft.allergenFlags,
    ingredients: draft.ingredients.map(({ name, amount, group, allergenFlags }, i) => ({
      name,
      ...(amount ? { amount } : {}),
      group,
      allergenFlags,
      ...(changedIngredients.has(i) ? { changed: true as const } : {}),
    })),
    steps: draft.steps.filter((s) => typeof s === "string"),
    basics: draft.basics,
    basicsNote: draft.basicsNote,
    status: draft.status,
    version: draft.version,
    ...(draft.changed ? { changedSteps: draft.changed.steps, changeKey: draft.key } : {}),
  };
}

/**
 * What to show: a recipe streaming now (or one that just failed) wins; otherwise the saved one
 * read on the server; otherwise a draft saved earlier this session. `current` is the meal's
 * recipe in the kitchen state: after an Undo (0052) the newest version number isn't the live
 * one any more, so whichever matches `current` wins.
 */
export function pickRecipe(draft: RecipeDraft | undefined, view: RecipeView | null, current?: { version: number }): RecipeDisplay | null {
  if (draft && draft.status !== "saved") return fromDraft(draft);
  if (draft && view) {
    if (current && draft.version !== view.version) {
      if (draft.version === current.version) return fromDraft(draft);
      if (view.version === current.version) return fromView(view);
    }
    return (draft.version ?? 0) >= view.version ? fromDraft(draft) : fromView(view);
  }
  if (draft) return fromDraft(draft);
  return view ? fromView(view) : null;
}

/** The two checklist groups (basics count as "In your kitchen"). Empty groups are left out. */
export function checklistGroups(rows: RecipeRow[]): { key: "kitchen" | "need"; rows: RecipeRow[] }[] {
  const kitchen = rows.filter((r) => r.group !== "need");
  const need = rows.filter((r) => r.group === "need");
  return [
    { key: "kitchen" as const, rows: kitchen },
    { key: "need" as const, rows: need },
  ].filter((g) => g.rows.length > 0);
}

/** Who ticked each ingredient of this meal (shared ticks, M6), by ingredient name. */
export function ticksFor(state: KitchenState | null, mealId: string): Map<string, KitchenState["ticks"][number]> {
  const out = new Map<string, KitchenState["ticks"][number]>();
  for (const t of state?.ticks ?? []) {
    if ("missing" in t.meal || t.meal.id !== mealId) continue;
    out.set(t.ingredient.trim().toLocaleLowerCase(), t);
  }
  return out;
}

export const tickKey = (name: string) => name.trim().toLocaleLowerCase();
