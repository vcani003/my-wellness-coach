/**
 * The seam between the chat pipeline and whatever reads the user's message (orchestrator spec,
 * milestone 2). Milestone 2 plugs in the deterministic FAKE in `./fake/`; the AI specialist adds
 * the real one behind this same interface (ai.md §1). Interpreters only PROPOSE: the backend's
 * validate → apply path decides what saves (0003).
 */
import type { ApplyResult } from "@/contracts/apply-result";
import type { KitchenState } from "@/contracts/kitchen-state";
import type { ProposedChange } from "@/contracts/proposed-change";
import type { StaplesAnswer } from "@/contracts/stream";

export type InterpretRequest = {
  kitchenId: string;
  userId: string;
  message: { id: string; text: string };
  /** Current kitchen state from domain queries. */
  state: KitchenState;
  /** Kitchen version the proposal is based on. */
  version: number;
  /** Recent turns, oldest first, max ~10. */
  history: Array<{ role: "user" | "assistant"; text: string }>;
  /**
   * The meal ideas this user was last shown, in card order, so "the second one" or "the
   * omelette" can be chosen (0013). Optional: without it, ideas can't be chosen from chat.
   */
  ideas?: Array<{
    ideaId: string;
    name: string;
    /** What the card says it uses (kitchen item names) and is missing, so "the curry with the yogurt" resolves. */
    uses?: string[];
    missing?: string[];
  }>;
  /**
   * Every member's allergies (0019: they count whoever is asking), so a general staples or
   * shopping guess leaves them out (0054 SS6). Optional: absent = none known.
   */
  allergies?: Array<{ subject: string; who: string }>;
  /**
   * The message's own day, "YYYY-MM-DD", in the person's time zone (0045 KOS1): relative days
   * ("Tuesday", "tomorrow") are resolved from it, by code. Absent → the clock's UTC date.
   */
  today?: string;
};

/** A meal that exists, or the one a `meal.choose` in this proposal creates (read its applied refs). */
export type MealPointer = { mealId: string } | { chooseOpId: string };

/**
 * What the route does after apply, decided by code (never the model), in this order (ai.md §1).
 * - `ideas`: generate meal ideas; `request` is the user's words, for this request only (0012).
 * - `recipe`: write the recipe for a just-chosen meal (R2: suggested by default), or refine the
 *   current one ("no oven"); `refine` is the user's words. `notes`: for a dish the user named
 *   (MI1), their own words about it ("with coconut milk, lemongrass, kaffir lime leaves").
 * - `meal-step`: plan or start cooking a meal this proposal just chose (it had no ID yet).
 * - `after-cooking`: open "Update your kitchen" for a meal just marked done (0013). UI, not AI.
 * - `idea-refine`: change an idea card that has no recipe yet, in place ("remove the yogurt from
 *   the curry"); no recipe is written and nothing navigates. `request` is the user's words.
 */
export type TurnFollowUp =
  | { kind: "ideas"; request: string }
  | { kind: "idea-refine"; ideaId: string; request: string }
  | { kind: "recipe"; meal: MealPointer; refine?: string; notes?: string }
  | { kind: "meal-step"; meal: { chooseOpId: string }; to: "planned" | "cooking"; date?: string }
  | { kind: "after-cooking"; mealId: string };

export type InterpretResult = {
  kind: "change" | "answer" | "clarify";
  /** null for pure answers. */
  proposal: ProposedChange | null;
  /** Draft reply; the route sends it only if every op applied. */
  reply: string;
  /** Steps to run after apply; absent = none. */
  followUps?: TurnFollowUp[];
  /**
   * A staples answer built by code from the saved staples (0054 SS6): sent as the `staples`
   * stream event after the reply, for its "Add these to my list" button. Absent = none.
   */
  staples?: StaplesAnswer;
  /**
   * "Add what we need for this week's meals" / "what do we need this week?" (0045 KOS12). The
   * turn computes the week's needs from the plan (it needs the recipes): `add` puts them on the
   * list in the same change set (source `week-plan`); otherwise it answers with them and offers
   * to add. Absent = neither.
   */
  weekNeeds?: { add: boolean };
};

export interface Interpreter {
  interpret(req: InterpretRequest): Promise<InterpretResult>;
  reword?(req: InterpretRequest, result: InterpretResult, applied: ApplyResult): Promise<string>;
}
