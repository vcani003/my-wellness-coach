/**
 * The edit sheet's pure parts (0045 KOS3, 0057, 0036, 0055 KOS4-e): what the sheet starts from,
 * what changed, how a save's answer reads, and which row stays drawn after it left the kitchen.
 * No React here, so every rule has a plain unit test.
 */
import type { ApplyResult } from "@/contracts/apply-result";
import type { ItemCategory, Location, StockLevel } from "@/contracts/common";
import type { BatchRow, ItemRow, KitchenState } from "@/contracts/kitchen-state";
import type { Receipt } from "@/ui/chat/chat-reducer";
import { batchesOf } from "./model";

/** "All batches", or one open batch's ID (KOS4-e). */
export const ALL_BATCHES = "all";

/** Sheet limits (item-actions.md §2), the same as the server's. */
export const NAME_MAX = 60;
export const AMOUNT_MAX = 40;

/** What the fields start from for the chosen batch (or the whole item). */
export interface EditBaseline {
  name: string;
  amount: string;
  place: Location | null;
  category: ItemCategory | null;
  level: StockLevel | null;
}

/** The open batches when there are several (the sheet's batch choice); none for a one-batch item. */
export function pickableBatches(item: ItemRow): BatchRow[] {
  const batches = batchesOf(item);
  return batches.length > 1 ? batches : [];
}

/**
 * The baseline for one batch, or for the whole item. With "All batches", the amount is the oldest
 * open batch's (that's where a new amount goes, IA4) and the place / level are the row's.
 */
export function baselineFor(item: ItemRow, batchId: string): EditBaseline {
  const batch = batchId === ALL_BATCHES ? undefined : batchesOf(item).find((b) => b.id === batchId);
  const oldest = batchesOf(item)[0];
  const amountSource = batch ?? oldest;
  return {
    name: item.name.value,
    amount: amountSource?.quantity?.value.asSaid ?? item.quantity?.value.asSaid ?? "",
    place: (batch ? batch.location?.value : item.location?.value) ?? null,
    category: item.category?.value ?? null,
    level: (batch ? batch.stock?.value : item.stock?.value) ?? null,
  };
}

/** The typed fields. `null` = untouched, so the field shows the baseline (it follows the batch picked). */
export interface EditDraft {
  name: string | null;
  amount: string | null;
  place: Location | null;
  category: ItemCategory | null;
}

export const EMPTY_DRAFT: EditDraft = { name: null, amount: null, place: null, category: null };

export interface ItemEditPayload {
  name?: string;
  amount?: string | null;
  place?: Location;
  category?: ItemCategory;
}

/** Only what differs from the baseline; empty = nothing to save (Save stays off). */
export function editPayload(draft: EditDraft, base: EditBaseline): ItemEditPayload {
  const edit: ItemEditPayload = {};
  if (draft.name !== null && draft.name.trim() !== base.name.trim()) edit.name = draft.name.trim();
  if (draft.amount !== null && draft.amount.trim() !== base.amount.trim()) edit.amount = draft.amount.trim() === "" ? null : draft.amount.trim();
  if (draft.place !== null && draft.place !== base.place) edit.place = draft.place;
  if (draft.category !== null && draft.category !== base.category) edit.category = draft.category;
  return edit;
}

export const hasChanges = (edit: ItemEditPayload) => Object.keys(edit).length > 0;

export type FieldError = { field: "name"; code: "nameRequired" | "nameTooLong" } | { field: "amount"; code: "amountTooLong" };

/** Checked on Save, not while typing (item-actions.md §2). */
export function validate(draft: EditDraft, base: EditBaseline): FieldError | null {
  const name = (draft.name ?? base.name).trim();
  if (!name) return { field: "name", code: "nameRequired" };
  if (name.length > NAME_MAX) return { field: "name", code: "nameTooLong" };
  if ((draft.amount ?? base.amount).trim().length > AMOUNT_MAX) return { field: "amount", code: "amountTooLong" };
  return null;
}

/**
 * How a save's answer reads (backend-data.md §6, item-actions.md §5):
 * - `stale`: someone changed the item since the sheet opened; nothing saved (STALE_TARGET).
 * - `gone`: it was removed or used up meanwhile (UNKNOWN_ITEM, ALREADY_OUT, UNKNOWN_TARGET).
 * - `saved`: something changed: the receipt, with Undo.
 * - `nothing`: the server found nothing to change.
 */
export type SaveOutcome = "stale" | "gone" | "saved" | "nothing";

const GONE = new Set(["UNKNOWN_ITEM", "ALREADY_OUT", "UNKNOWN_TARGET"]);

export function outcomeOf(result: ApplyResult): SaveOutcome {
  if (result.applied.length > 0) return "saved";
  const codes = result.rejected.map((r) => r.reason.code);
  if (codes.includes("STALE_TARGET")) return "stale";
  if (codes.some((c) => GONE.has(c))) return "gone";
  return result.rejected.length > 0 ? "saved" : "nothing";
}

/** What the row says while it's drawn after leaving the kitchen. */
export type GhostKind = "out" | "removed" | "gone";

/** One result shown under its row, until your next message (PlaceMemory). */
export interface ItemNote {
  itemId: string;
  /** The row as it was: drawn faded in place if the item has left the kitchen. */
  before: ItemRow;
  turn: number;
  kind: "receipt" | "stale" | "gone";
  receipt?: Receipt;
  /** For `stale`: who changed it ("Levi"). */
  who?: string;
  /** New on each result that should take focus once. */
  key: string;
  /** The sheet that made it (its receipt shows in the sheet too while it's open). */
  sheet?: string;
}

/** The item that left the kitchen, drawn in place while its note shows; null when it's still there. */
export function ghostOf(note: ItemNote | null, state: KitchenState): { row: ItemRow; kind: GhostKind } | null {
  if (!note || state.items.some((i) => i.id === note.itemId)) return null;
  if (note.kind === "gone") return { row: note.before, kind: "gone" };
  if (note.kind !== "receipt" || !note.receipt?.applied.length) return null;
  const codes = note.receipt.applied.map((a) => a.summary.code);
  if (codes.includes("ITEM_REMOVED")) return { row: note.before, kind: "removed" };
  if (codes.includes("ITEM_OUT")) return { row: note.before, kind: "out" };
  return { row: note.before, kind: "gone" };
}
