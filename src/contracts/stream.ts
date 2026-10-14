/**
 * Turn stream for `/api/chat` and `/api/meals/choose` (backend-data.md §6): NDJSON, one event per line.
 * Guaranteed order: `ack` first; `applied` before any `text`; `done` or `error` last.
 */
import { z } from "zod";
import { AllergenFlag, Id, Msg } from "./common";
import { ApplyResult } from "./apply-result";
import { Clarification } from "./proposed-change";

export const StreamPhase = z.enum(["interpreting", "saving", "writing", "ideas", "recipe"]);

export const MealIdea = z.object({
  ideaId: Id,
  name: z.string(),
  why: z.string(),
  /** Item IDs from the kitchen this idea uses. */
  uses: z.array(Id),
  /** Ingredient names the kitchen doesn't have. */
  missing: z.array(z.string()),
  allergenFlags: z.array(AllergenFlag),
});
export type MealIdea = z.infer<typeof MealIdea>;

export const StreamEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ack"), turnId: Id, messageId: Id }),
  z.object({ type: z.literal("status"), phase: StreamPhase }),
  /** Payload is the ApplyResult, nested under `result`. */
  z.object({ type: z.literal("applied"), result: ApplyResult }),
  z.object({ type: z.literal("clarification"), ...Clarification.shape }),
  z.object({ type: z.literal("offer"), offerId: Id, statement: z.string() }),
  z.object({ type: z.literal("notes"), notes: z.array(Msg) }),
  z.object({ type: z.literal("text"), delta: z.string() }),
  z.object({ type: z.literal("idea"), setId: Id, basedOnVersion: z.number().int().nonnegative(), idea: MealIdea }),
  z.object({
    type: z.literal("recipe"),
    mealId: Id,
    part: z.enum(["meta", "ingredient", "step", "basics"]),
    /** Part-specific; `meta` carries `allergenFlags`. Shape owned by the AI specialist. */
    data: z.unknown(),
  }),
  z.object({
    type: z.literal("recipe.saved"),
    mealId: Id,
    recipeId: Id,
    version: z.number().int(),
    newVersion: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("done"), turnId: Id, assistantMessageId: Id }),
  z.object({ type: z.literal("error"), reason: Msg, changed: z.boolean(), retryable: z.boolean() }),
]);
export type StreamEvent = z.infer<typeof StreamEvent>;
export type StreamEventType = StreamEvent["type"];
