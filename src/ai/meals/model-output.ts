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
 * Same converter as the interpreter (model-output.ts): Zod's own, so enums and required keys
 * are enforced by the API. We still validate the answer afterwards.
 */
export function jsonFormat(schema: z.ZodType): { type: "json_schema"; schema: Record<string, unknown> } {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema, { io: "output" }) as Record<string, unknown>;
  void _ignored;
  return { type: "json_schema", schema: json };
}
