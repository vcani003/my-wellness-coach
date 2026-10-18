/**
 * Code guards for recipes (ai.md §5): the model's recipe becomes a `recipe.save` only through
 * here. Code, not the model, decides each ingredient's checklist group (0013):
 * - "In your kitchen": its label is a real item, or its name matches exactly one item;
 * - "basic": on the 0019 basics list (and not in the kitchen);
 * - "Need": everything else.
 * Flags are computed by code (0019). The operation must pass the contract or nothing is proposed.
 */
import { RecipeSave } from "@/contracts/operations";
import { flagsFor } from "./allergen-guard";
import { basicsNote, isBasic } from "./basics";
import { matchKitchenItem } from "./match";
import type { RecipeOutput } from "./model-output";
import type { GeneratedRecipe, MealContext, RecipeIngredientOut, RecipeResult, RecipeSaveOperation } from "./types";

type RawIngredient = RecipeOutput["ingredients"][number];

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);

export function toIngredient(raw: RawIngredient, ctx: MealContext, labels: Map<string, string>): RecipeIngredientOut | null {
  const name = clip(raw.name.trim().replace(/\s+/g, " "), 200);
  if (!name) return null;
  const labelled = raw.item ? labels.get(raw.item.trim()) : undefined;
  const item = (labelled && ctx.state.items.find((i) => i.id === labelled)) || matchKitchenItem(ctx.state, name);
  const amount = raw.amount?.trim() ? clip(raw.amount.trim(), 100) : null;
  const group = item ? "kitchen" : isBasic(name) ? "basic" : "need";
  const flagNames = item ? [name, item.name.value] : [name];
  return { name, amount, itemId: item?.id ?? null, group, allergenFlags: flagsFor(flagNames, ctx.restrictions) };
}

/**
 * 0059 PF1: every ingredient has an amount, except basics used to taste (salt, pepper, oil). The
 * names of the ones that don't, for a quality log; code never makes an amount up.
 */
export function missingAmounts(ingredients: Pick<RecipeIngredientOut, "name" | "amount">[]): string[] {
  return ingredients.filter((i) => !i.amount?.trim() && !isBasic(i.name)).map((i) => i.name);
}

/** "1. Heat the pan" → "Heat the pan". */
export function toStep(raw: string): string | null {
  const s = raw.trim().replace(/^(step\s*)?\d+\s*[.):-]\s*/i, "").trim();
  return s ? clip(s, 2000) : null;
}

export function toIngredients(raw: RawIngredient[], ctx: MealContext, labels: Map<string, string>): RecipeIngredientOut[] {
  return raw.map((r) => toIngredient(r, ctx, labels)).filter((i): i is RecipeIngredientOut => i !== null).slice(0, 100);
}

export function toSteps(raw: string[]): string[] {
  return raw.map(toStep).filter((s): s is string => s !== null).slice(0, 100);
}

function recipeText(r: Omit<GeneratedRecipe, "allergenFlags">): string {
  return [
    r.title,
    r.summary,
    ...(r.servings ? [`Serves ${r.servings}`] : []),
    "",
    "Ingredients",
    ...r.ingredients.map((i) => `- ${i.amount ? `${i.amount} ` : ""}${i.name}`),
    "",
    "Steps",
    ...r.steps.map((s, i) => `${i + 1}. ${s}`),
  ].join("\n");
}

/**
 * Title and servings of a saved AI recipe, read back from its stored text (`recipeText` above):
 * the saved recipe has no servings field, so a refinement ("only 2 chicken breasts, not 4") would
 * otherwise lose the number it scales from. User-pasted text has no fixed shape: null for both.
 */
export function savedRecipeMeta(text: string, source: "ai" | "user"): { title: string | null; servings: string | null; summary: string | null } {
  if (source !== "ai") return { title: null, servings: null, summary: null };
  const lines = text.split("\n", 4);
  const title = lines[0]?.trim() || null;
  const serves = lines.slice(1, 3).map((l) => /^Serves (.+)$/.exec(l.trim())?.[1]?.trim()).find(Boolean);
  // The summary is the line after the title, unless the recipe had none (then it's "Serves …" or blank).
  const second = lines[1]?.trim() ?? "";
  const summary = second && !/^Serves /.test(second) && second !== "Ingredients" ? second : null;
  return { title, servings: serves || null, summary };
}

export interface RecipeBuild {
  ctx: MealContext;
  labels: Map<string, string>;
  mealId: string;
  fallbackTitle: string;
  source: "ai" | "user";
  opId: string;
  /** Chat only: the user's words (the backend needs evidence for chat operations). */
  evidence?: string;
  /** "user" only: the text exactly as pasted (R1). */
  pastedText?: string;
}

export function toRecipeResult(out: RecipeOutput, b: RecipeBuild): RecipeResult | { ok: false; why: string } {
  return buildRecipeResult(toIngredients(out.ingredients, b.ctx, b.labels), toSteps(out.steps), out, b);
}

/**
 * The checked recipe and its `recipe.save`, from ingredients and steps code has already cleaned
 * (a fresh recipe, or the current one with edits applied). Flags are always recomputed here.
 */
export function buildRecipeResult(
  ingredients: RecipeIngredientOut[],
  steps: string[],
  out: Pick<RecipeOutput, "title" | "summary" | "servings" | "reply">,
  b: RecipeBuild,
): RecipeResult | { ok: false; why: string } {
  if (ingredients.length === 0 && b.source === "ai") return { ok: false, why: "recipe has no ingredients" };
  if (steps.length === 0 && b.source === "ai") return { ok: false, why: "recipe has no steps" };

  const title = clip(out.title.trim() || b.fallbackTitle, 200);
  const basicsAssumed = ingredients.filter((i) => i.group === "basic").map((i) => i.name);
  const base = {
    mealId: b.mealId,
    title,
    summary: out.summary.trim(),
    servings: out.servings?.trim() || null,
    source: b.source,
    ingredients,
    steps,
    basicsAssumed,
  };
  const recipe: GeneratedRecipe = {
    ...base,
    allergenFlags: flagsFor([title, ...ingredients.map((i) => i.name), ...ingredients.flatMap((i) => (i.itemId ? [b.ctx.state.items.find((x) => x.id === i.itemId)!.name.value] : []))], b.ctx.restrictions),
  };
  const text = b.source === "user" ? (b.pastedText ?? "") : recipeText(base);

  const candidate: RecipeSaveOperation = {
    opId: b.opId,
    type: "recipe.save",
    ...(b.evidence?.trim() ? { evidence: clip(b.evidence.trim(), 2000) } : {}),
    target: { mealId: b.mealId },
    source: b.source,
    text,
    ingredients: ingredients.map((i) => ({
      name: i.name,
      ...(i.amount ? { amount: i.amount } : {}),
      ...(i.itemId ? { itemId: i.itemId } : {}),
      ...(i.group === "basic" ? { basic: true } : {}),
    })),
    steps,
    basicsAssumed,
  };
  const parsed = RecipeSave.safeParse(candidate);
  if (!parsed.success) return { ok: false, why: `recipe.save failed the contract: ${parsed.error.message}` };
  const note = basicsNote(basicsAssumed);
  return { ok: true, recipe, operation: parsed.data, reply: out.reply.trim(), notes: note ? [note] : [] };
}
