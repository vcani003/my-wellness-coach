/**
 * Ask before removing more than 5 things at once (0045 KOS16, rule from recipe-cat via 0043; ai.md §4).
 *
 * Pure and deterministic: no model, no database. The chat turn (`turn.ts`) runs it on the final
 * proposal, whichever interpreter wrote it (real or fake), after interpret and before apply. So the
 * model can't skip it, and buttons (which never come through chat) are never held.
 *
 * **What counts as a removal** (one per distinct thing, however many operations touch it):
 * - kitchen: `item.remove`, `item.use` that leaves it Out ("used up", "we're out of"),
 *   `item.stock.set` to Out, and `item.batch.close` ("the old eggs are gone");
 * - shopping list: `shopping.remove` (a cleared list is one per entry);
 * - staples: `staple.remove`.
 * Not counted: a use that leaves some, Low, ticking a list entry, Done shopping (button only),
 * Undo (`changeset.revert`: Undo only your own, 0017), moves and edits, profile changes.
 *
 * A held message is saved with the reply that asks (`chat_messages.pending_confirm`). A plain yes
 * as your very next message applies exactly that change, as one change set with one Undo (0007);
 * a plain no changes nothing; anything else passes it over and is read as a new message.
 */
import { z } from "zod";
import type { KitchenState } from "@/contracts/kitchen-state";
import { Operation } from "@/contracts/operations";
import type { BulkConfirm } from "@/contracts/stream";
import { standardName } from "@/shared/text";
import type { TurnFollowUp } from "./interpreter";

/** More than this many removals in one chat message asks first. */
export const BULK_REMOVE_LIMIT = 5;
/** Names spelled out in the question; the rest are counted ("and 4 more"). The buttons list all. */
const NAMED_IN_REPLY = 10;

type Op = z.infer<typeof Operation>;
type Where = "kitchen" | "list" | "staples";
export interface Removal {
  /** Dedupe key: `item:<id>`, `list:<name>`… */
  key: string;
  name: string;
  where: Where;
}

/** The things this proposal would remove, use up or mark Out, once each, in order. */
export function removals(operations: readonly Op[], state: Pick<KitchenState, "items" | "shoppingList" | "staples">): Removal[] {
  const out = new Map<string, Removal>();
  const add = (r: Removal | null) => {
    if (r && !out.has(r.key)) out.set(r.key, r);
  };
  for (const op of operations) add(removalOf(op, state));
  return [...out.values()];
}

function removalOf(op: Op, state: Pick<KitchenState, "items" | "shoppingList" | "staples">): Removal | null {
  const item = (target: { itemId: string } | { name: string }): Removal => {
    if ("itemId" in target) {
      const row = state.items.find((i) => i.id === target.itemId);
      return { key: `item:${target.itemId}`, name: row?.name.value ?? "an item", where: "kitchen" };
    }
    return { key: `item-name:${standardName(target.name)}`, name: target.name, where: "kitchen" };
  };
  switch (op.type) {
    case "item.remove":
    case "item.batch.close":
      return item(op.target);
    case "item.use":
      return op.fields.stock?.value === "out" ? item(op.target) : null;
    case "item.stock.set":
      return op.fields.stock.value === "out" ? item(op.target) : null;
    case "shopping.remove": {
      const t = op.target;
      if ("shoppingItemId" in t) {
        const row = (state.shoppingList ?? []).find((e) => e.id === t.shoppingItemId);
        return { key: `list:${t.shoppingItemId}`, name: row?.name.value ?? "a list item", where: "list" };
      }
      return { key: `list-name:${standardName(t.name)}`, name: t.name, where: "list" };
    }
    case "staple.remove": {
      const t = op.target;
      if ("stapleId" in t) {
        const row = (state.staples ?? []).find((s) => s.id === t.stapleId);
        return { key: `staple:${t.stapleId}`, name: row?.name.value ?? t.stapleId, where: "staples" };
      }
      return { key: `staple-name:${standardName(t.name)}`, name: t.name, where: "staples" };
    }
    default:
      return null;
  }
}

/** The question to ask, or null when this proposal saves right away (5 or fewer removals). */
export function bulkConfirmFor(
  operations: readonly Op[],
  state: Pick<KitchenState, "items" | "shoppingList" | "staples">,
): (BulkConfirm & { reply: string }) | null {
  const found = removals(operations, state);
  if (found.length <= BULK_REMOVE_LIMIT) return null;
  const counted = new Set(found.map((r) => r.key));
  const others = operations.some((op) => {
    const r = removalOf(op, state);
    return !r || !counted.has(r.key);
  });
  const names = displayNames(found);
  return { kind: "bulk-remove", count: found.length, names, reply: confirmQuestion(found, names, others) };
}

const PLACE: Record<Where, string> = { kitchen: "", list: "your shopping list", staples: "your staples" };

/** "eggs", or "eggs (shopping list)" when the things come from more than one place. */
function displayNames(found: Removal[]): string[] {
  const places = new Set(found.map((r) => r.where));
  if (places.size === 1) return found.map((r) => r.name);
  return found.map((r) => (r.where === "kitchen" ? r.name : `${r.name} (${r.where === "list" ? "shopping list" : "staples"})`));
}

const listFormat = (names: string[]) => new Intl.ListFormat("en", { type: "conjunction" }).format(names);

export function confirmQuestion(found: Removal[], names: string[], others: boolean): string {
  const places = new Set(found.map((r) => r.where));
  const only = places.size === 1 ? [...places][0] : null;
  const from = only && only !== "kitchen" ? ` from ${PLACE[only]}` : "";
  const shown = names.length > NAMED_IN_REPLY ? [...names.slice(0, NAMED_IN_REPLY), `${names.length - NAMED_IN_REPLY} more`] : names;
  const rest = others ? " Nothing from that message is saved until you say yes." : "";
  return `That would remove ${found.length} things${from}: ${listFormat(shown)}. Remove them all?${rest}`;
}

// ─── The answer ───────────────────────────────────────────────────────────────────────

const YES =
  /^(?:yes|yeah|yep|yup|sure|ok|okay|confirm|do it|go ahead|please do|(?:yes|yeah|yep|ok|okay|sure)?,? ?(?:please )?(?:remove|delete|clear) (?:them|it|those|everything|them all|all of them|all)(?: all)?|yes,? (?:please|do it|go ahead|all of them|all))(?: please)?$/;
const NO =
  /^(?:no|nope|nah|cancel|stop|don'?t|do not|never ?mind|(?:no,? )?(?:please )?keep (?:them|it|those|everything|them all)(?: all)?|no,? (?:thanks|thank you|don'?t|cancel|leave (?:them|it)))(?: please)?$/;

/**
 * A plain yes or no to "Remove them all?", else null. The whole message must be the answer, so
 * "yes but keep the eggs" is read as a new message (Lumi then asks again, or saves 5 or fewer).
 * Matches the button texts ("Yes, remove them" / "No, keep them", en.json `chat.confirm`).
 */
export function readConfirmAnswer(text: string): "yes" | "no" | null {
  const t = text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[.!?\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (YES.test(t)) return "yes";
  if (NO.test(t)) return "no";
  return null;
}

export const KEPT_REPLY = "Okay, I didn't remove anything.";
export const STALE_REPLY =
  "Your kitchen changed since I asked, so I didn't remove anything. Tell me again if you still want them gone.";

// ─── The held change (stored with the reply that asks) ────────────────────────────────

const FollowUp = z.union([
  z.object({ kind: z.literal("ideas"), request: z.string() }),
  z.object({
    kind: z.literal("recipe"),
    meal: z.union([z.object({ mealId: z.string() }), z.object({ chooseOpId: z.string() })]),
    refine: z.string().optional(),
    notes: z.string().optional(),
  }),
  z.object({ kind: z.literal("meal-step"), meal: z.object({ chooseOpId: z.string() }), to: z.enum(["planned", "cooking"]) }),
  z.object({ kind: z.literal("after-cooking"), mealId: z.string() }),
]);

/** What a yes applies: the message's whole change, as proposed, and its follow-ups. */
export const PendingBulkRemove = z.object({
  kind: z.literal("bulk-remove"),
  count: z.number().int().positive(),
  names: z.array(z.string()),
  /** The kitchen version when Lumi asked; any change since means asking again. */
  version: z.number().int().nonnegative(),
  /** The original message: its ID (the change's source) and text (the evidence is checked against it). */
  sourceMessageId: z.string(),
  messageText: z.string(),
  operations: z.array(Operation).min(1).max(50),
  followUps: z.array(FollowUp).default([]),
});
export type PendingBulkRemove = z.infer<typeof PendingBulkRemove>;

export function toPending(
  confirm: BulkConfirm,
  args: { version: number; sourceMessageId: string; messageText: string; operations: Op[]; followUps: TurnFollowUp[] },
): PendingBulkRemove {
  return { kind: confirm.kind, count: confirm.count, names: confirm.names, ...args };
}

/** The stored held change, or null if it can't be read (logged; then the message is read as new, 0018). */
export function readPending(raw: unknown): PendingBulkRemove | null {
  const parsed = PendingBulkRemove.safeParse(raw);
  if (parsed.success) return parsed.data;
  console.error("chat.bulk-remove: unreadable held change", { issues: parsed.error.issues });
  return null;
}
