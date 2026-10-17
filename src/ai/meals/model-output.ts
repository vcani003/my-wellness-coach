/**
 * The shapes the model must answer in for ideas and recipes (structured outputs, ai.md §1).
 * Flat and fully keyed (null = unknown), kitchen items by short label (`i3`). Code turns them
 * into ideas and a `recipe.save` (to-ideas.ts, to-recipe.ts). Key order matters: the recipe
 * streams in this order (meta, then ingredients, then steps).
 */
import { z } from "zod";

export const IdeaOut = z.object({
  name: z.string(),
  /** One line, use-it-up first. */
  why: z.string(),
  /** Labels of kitchen items it uses (i1, i4…). */
  uses: z.array(z.string()),
  /** Ingredients the kitchen doesn't have, plain names. Never basics. */
  missing: z.array(z.string()),
  /** Assumed basics it relies on (salt, pepper, cooking oil, water, dried herbs and spices). */
  basics: z.array(z.string()),
});
export type IdeaOut = z.infer<typeof IdeaOut>;

export const IdeasOutput = z.object({
  ideas: z.array(IdeaOut),
  /** Short chat reply. */
  reply: z.string(),
});
export type IdeasOutput = z.infer<typeof IdeasOutput>;

/**
 * A change to one idea card (ai.md §5 "Refining an idea"): the whole card after the change, then a
 * short reply. Same fields as an idea, so the same code guard (to-ideas.ts) checks it. No unions.
 */
export const IdeaRefineOutput = IdeaOut.extend({
  /** One short sentence naming what changed. */
  reply: z.string(),
});
export type IdeaRefineOutput = z.infer<typeof IdeaRefineOutput>;

export const RecipeIngredientOut = z.object({
  name: z.string(),
  /** As written ("2", "1 cup", "a handful"), or null. */
  amount: z.string().nullable(),
  /** Label of the kitchen item it uses (i3), or null. */
  item: z.string().nullable(),
  /** True only for an assumed basic. */
  basic: z.boolean(),
});

export const RecipeOutput = z.object({
  title: z.string(),
  summary: z.string(),
  servings: z.string().nullable(),
  ingredients: z.array(RecipeIngredientOut),
  steps: z.array(z.string()),
  reply: z.string(),
});
export type RecipeOutput = z.infer<typeof RecipeOutput>;

/**
 * One change to the current recipe (refinements, ai.md §5 "edit mode"). Positions are 1-based and
 * always refer to <current_recipe> as sent, never to a list that's already been edited. `add_*`
 * inserts after position `at` (0 = at the start). Unused fields are "" (no unions: schema limits).
 * `at` is a plain number: integer and range are checked by code (apply-edits.ts).
 */
export const RecipeEditOut = z.object({
  op: z.enum(["add_ingredient", "change_ingredient", "remove_ingredient", "add_step", "change_step", "remove_step"]),
  at: z.number(),
  /** Ingredient ops: the plain name ("" otherwise). */
  name: z.string(),
  /** Ingredient ops: as written ("2", "1 cup"), or "". */
  amount: z.string(),
  /** Ingredient ops: label of the kitchen item it uses (i3), or "". */
  item: z.string(),
  /** Step ops: the whole new step, without numbering ("" otherwise). */
  text: z.string(),
});
export type RecipeEditOut = z.infer<typeof RecipeEditOut>;

/** A full recipe without the reply (the rewrite half of a refinement). */
export const RecipeBodyOut = RecipeOutput.omit({ reply: true });

/**
 * A refinement answer: small edits to the current recipe, or (for a broad change) the whole recipe
 * again. `mode` comes first so the stream knows which it is early. Key order matters for streaming.
 */
export const RecipeRefineOutput = z.object({
  mode: z.enum(["edit", "rewrite"]),
  /** mode "edit": the changes. mode "rewrite": []. */
  edits: z.array(RecipeEditOut),
  /** mode "rewrite": the whole new recipe. mode "edit": null. */
  recipe: RecipeBodyOut.nullable(),
  reply: z.string(),
});
export type RecipeRefineOutput = z.infer<typeof RecipeRefineOutput>;

/**
 * Same converter as the interpreter (model-output.ts): Zod's own, so enums and required keys
 * are enforced by the API. We still validate the answer afterwards.
 */
export function jsonFormat(schema: z.ZodType): { type: "json_schema"; schema: Record<string, unknown> } {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema, { io: "output" }) as Record<string, unknown>;
  void _ignored;
  return { type: "json_schema", schema: json };
}
