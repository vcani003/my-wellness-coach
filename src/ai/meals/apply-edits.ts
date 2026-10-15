/**
 * Edit mode for refinements (ai.md §5): the model returns a few edits against <current_recipe>
 * ("add baby carrots after 3", "change step 4"), and code applies them here. Everything the edits
 * don't touch is copied as it was, so an unchanged line stays byte-for-byte the same.
 *
 * Checked by code, never trusted: positions are whole numbers in range, a line is changed or
 * removed at most once, nothing ends up empty, and the same caps as a fresh recipe (1–100
 * ingredients and steps). Any problem returns `ok: false` and the caller falls back to a full
 * rewrite (never a failure the user sees). In-your-kitchen / Need, basics and the allergen flags
 * are recomputed over the WHOLE result by the same code as a fresh recipe (0019).
 */
import { labelMaps } from "./context";
import type { RecipeEditOut } from "./model-output";
import { buildRecipeResult, toIngredient, toStep, type RecipeBuild } from "./to-recipe";
import type { RecipeChange, RecipeInput, RecipeIngredientOut, RecipeResult } from "./types";

/** More edits than this is a rewrite in disguise: fall back (rationale in ai.md §5). */
export const MAX_EDITS = 12;
const MAX_LINES = 100;

type Current = NonNullable<RecipeInput["refine"]>["current"];
type Ok = Extract<RecipeResult, { ok: true }>;
export type EditOutcome = { ok: true; result: Ok & { change: RecipeChange } } | { ok: false; why: string };

const INGREDIENT_OPS = new Set(["add_ingredient", "change_ingredient", "remove_ingredient"]);

interface Plan {
  /** 1-based position → the change or removal there. */
  at: Map<number, RecipeEditOut>;
  /** 0-based "after position" → additions, in the order given. */
  adds: Map<number, RecipeEditOut[]>;
}

function plan(edits: RecipeEditOut[], length: number, what: string): Plan | string {
  const p: Plan = { at: new Map(), adds: new Map() };
  for (const e of edits) {
    if (!Number.isInteger(e.at)) return `${e.op}: position ${e.at} is not a whole number`;
    if (e.op.startsWith("add_")) {
      if (e.at < 0 || e.at > length) return `${e.op}: position ${e.at} is outside 0–${length} ${what}`;
      p.adds.set(e.at, [...(p.adds.get(e.at) ?? []), e]);
      continue;
    }
    if (e.at < 1 || e.at > length) return `${e.op}: position ${e.at} is outside 1–${length} ${what}`;
    if (p.at.has(e.at)) return `${e.op}: ${what} ${e.at} is edited twice`;
    p.at.set(e.at, e);
  }
  return p;
}

/**
 * Walk the original lines in order: additions after each position, a change in place, a removal
 * skipped, everything else copied. Returns the new lines and which of them are new or changed.
 */
function rebuild<T>(
  original: T[],
  p: Plan,
  copy: (line: T) => T | null,
  make: (edit: RecipeEditOut, old: T | null) => T | null,
): { lines: T[]; changed: number[]; removed: number } | string {
  const lines: T[] = [];
  const changed: number[] = [];
  let removed = 0;
  const add = (after: number): string | null => {
    for (const e of p.adds.get(after) ?? []) {
      const line = make(e, null);
      if (!line) return `${e.op}: empty line`;
      changed.push(lines.length);
      lines.push(line);
    }
    return null;
  };
  let bad = add(0);
  if (bad) return bad;
  for (let k = 1; k <= original.length; k++) {
    const e = p.at.get(k);
    const old = original[k - 1];
    if (e?.op.startsWith("remove_")) {
      removed++;
    } else if (e) {
      const line = make(e, old);
      if (!line) return `${e.op} at ${k}: empty line`;
      changed.push(lines.length);
      lines.push(line);
    } else {
      const line = copy(old);
      if (line) lines.push(line);
    }
    bad = add(k);
    if (bad) return bad;
  }
  return { lines, changed, removed };
}

export function applyRecipeEdits(current: Current, edits: RecipeEditOut[], reply: string, b: RecipeBuild): EditOutcome {
  if (edits.length > MAX_EDITS) return { ok: false, why: `${edits.length} edits is more than ${MAX_EDITS}: rewrite instead` };
  const { toLabel } = labelMaps(b.ctx);
  const ingEdits = edits.filter((e) => INGREDIENT_OPS.has(e.op));
  const stepEdits = edits.filter((e) => !INGREDIENT_OPS.has(e.op));

  const ip = plan(ingEdits, current.ingredients.length, "ingredients");
  if (typeof ip === "string") return { ok: false, why: ip };
  const sp = plan(stepEdits, current.steps.length, "steps");
  if (typeof sp === "string") return { ok: false, why: sp };

  // Unchanged ingredients go through the same matcher, so a kitchen item that's gone moves to Need
  // and the flags are today's; the name and amount are kept exactly.
  const asRaw = (i: RecipeIngredientOut) => ({
    name: i.name,
    amount: i.amount,
    item: i.itemId ? (toLabel.get(i.itemId) ?? null) : null,
    basic: i.group === "basic",
  });
  const ings = rebuild<RecipeIngredientOut>(
    current.ingredients,
    ip,
    (old) => toIngredient(asRaw(old), b.ctx, b.labels),
    (e, old) =>
      toIngredient(
        {
          // A change may restate only the amount: an empty name keeps the old one.
          name: e.name.trim() || old?.name || "",
          amount: e.amount.trim() || null,
          item: e.item.trim() || null,
          basic: false,
        },
        b.ctx,
        b.labels,
      ),
  );
  if (typeof ings === "string") return { ok: false, why: ings };

  // Unchanged steps are copied as they are (not re-cleaned), so they stay byte-for-byte the same.
  const steps = rebuild<string>(current.steps, sp, (old) => old, (e) => toStep(e.text));
  if (typeof steps === "string") return { ok: false, why: steps };

  if (ings.lines.length === 0 || steps.lines.length === 0) return { ok: false, why: "edits left the recipe empty" };
  if (ings.lines.length > MAX_LINES || steps.lines.length > MAX_LINES) return { ok: false, why: "edits made the recipe too long" };

  const built = buildRecipeResult(
    ings.lines,
    steps.lines,
    { title: current.title, summary: current.summary ?? "", servings: current.servings ?? null, reply },
    b,
  );
  if (!built.ok) return { ok: false, why: "why" in built ? built.why : "unusable recipe" };
  const change: RecipeChange = {
    ingredients: ings.changed,
    steps: steps.changed,
    removed: { ingredients: ings.removed, steps: steps.removed },
  };
  return { ok: true, result: { ...built, change, ...(edits.length === 0 ? { unchanged: true as const } : {}) } };
}
