/**
 * Turn stream for `/api/chat` and `/api/meals/choose` (backend-data.md §6): NDJSON, one event per line.
 * Guaranteed order: `ack` first; `applied` before any `text`; `done` or `error` last.
 */
import { z } from "zod";
import { AllergenFlag, Id, Msg } from "./common";
import { ApplyResult } from "./apply-result";
import { StapleNeed } from "./kitchen-state";
import { Clarification } from "./proposed-change";

/**
 * "What staples do I need?" answered from the saved staples (0054 SS6): the staples that answer
 * named as needed (Out, Running low, Not in yet), computed by code. Under the reply the UI shows
 * **Add these to my list**, which calls `restockStaples {stapleIds}` with these IDs.
 */
export const StaplesAnswer = z.object({
  items: z.array(
    z.object({
      stapleId: Id,
      name: z.string(),
      store: z.string().optional(),
      need: StapleNeed.exclude(["have", "on-list"]),
    }),
  ),
});
export type StaplesAnswer = z.infer<typeof StaplesAnswer>;

/**
 * "That would remove 7 things: … Remove them all?" (0045 KOS16). One chat message that would
 * remove, use up or mark Out **more than 5** things (kitchen items, list entries, staples) is held,
 * not saved. `names` is every thing it would remove, as shown to the user. Under the reply the UI
 * shows **Yes, remove them** / **No, keep them**, which send those words as a chat message. The
 * held change is server-side only (never sent to the client); a yes applies exactly it.
 */
export const BulkConfirm = z.object({
  kind: z.literal("bulk-remove"),
  count: z.number().int().positive(),
  names: z.array(z.string()),
});
export type BulkConfirm = z.infer<typeof BulkConfirm>;

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

/**
 * "Update your kitchen" after cooking (0013, M8): the in-kitchen ingredients just recorded as used
 * in this meal. Each gets Still have some / Running low / Out; answer with `submitUpdateKitchen`.
 */
export const UpdateKitchenPrompt = z.object({
  mealId: Id,
  title: z.string(),
  items: z.array(z.object({ itemId: Id, name: z.string() })),
});
export type UpdateKitchenPrompt = z.infer<typeof UpdateKitchenPrompt>;

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
  /** The idea set failed part-way (e.g. a refusal): remove its cards; they can't be chosen. */
  z.object({ type: z.literal("ideas.dropped"), setId: Id }),
  /**
   * An idea card shown earlier changed (ai.md §5 "Refining an idea"): a chat edit to an idea with no
   * recipe yet, or its meal's recipe was written or changed (the card follows the latest recipe).
   * The whole card again; the UI replaces it in place and highlights the lines that differ.
   */
  z.object({ type: z.literal("idea.updated"), idea: MealIdea }),
  z.object({
    type: z.literal("recipe"),
    mealId: Id,
    /**
     * `edit`: a refinement applied as edits (ai.md §5): the WHOLE resulting recipe plus `changed`
     * line positions, sent once. The UI replaces the shown recipe in place (no blank-and-refill).
     */
    part: z.enum(["meta", "ingredient", "step", "basics", "edit"]),
    /** Part-specific; `meta` and `edit` carry `allergenFlags`. Shape owned by the AI specialist. */
    data: z.unknown(),
  }),
  z.object({
    type: z.literal("recipe.saved"),
    mealId: Id,
    recipeId: Id,
    version: z.number().int(),
    newVersion: z.number().int().nonnegative(),
  }),
  /** A staples answer from the saved staples (0054 SS6), after its `text`. Only when some are needed. */
  z.object({ type: z.literal("staples"), ...StaplesAnswer.shape }),
  /** A held bulk removal (0045 KOS16), after its `text`; nothing was saved. */
  z.object({ type: z.literal("confirm"), ...BulkConfirm.shape }),
  /** Open "Update your kitchen" for a meal just marked done (0013). */
  z.object({ type: z.literal("update-kitchen"), ...UpdateKitchenPrompt.shape }),
  z.object({ type: z.literal("done"), turnId: Id, assistantMessageId: Id }),
  z.object({ type: z.literal("error"), reason: Msg, changed: z.boolean(), retryable: z.boolean() }),
]);
export type StreamEvent = z.infer<typeof StreamEvent>;
export type StreamEventType = StreamEvent["type"];
