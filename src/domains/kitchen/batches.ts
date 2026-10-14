/**
 * Item batches (0025): older and newer eggs. Pure helpers shared by `apply`, validation and the
 * read model. An item holds its batches; its own fields (the Kitchen list row) are derived from
 * them by `deriveItem`, so older code that reads only the item row keeps working (0028).
 *
 * - The **oldest open batch** is the one used next: the row's age, location, frozen and opened
 *   come from it.
 * - `quantity`: the single open batch's, or the sum when every open batch has an amount in the
 *   same unit; otherwise unknown.
 * - `stock`: `low` only when every open batch is low; `out` once no batch is open (0011: it drops
 *   off the list, history keeps it).
 * - Legacy items (from before batches) have exactly one batch whose ID is the item's ID. Migration
 *   0008 backfills that same row, so replaying old events and the backfill agree.
 */
import type { Fact, Location, Quantity, StockLevel } from "@/contracts/common";
import type { AuditFields } from "@/shared/events/types";
import { normalizeText } from "@/shared/text";
import type { Item } from "./state";

/** Why a batch closed: used up (or Out), "Those are gone", or a 4th batch replaced it (0025). */
export type BatchCloseReason = "used-up" | "gone" | "replaced";

export interface Batch extends AuditFields {
  id: string;
  /** When the user said they got it, else when it was recorded. */
  addedAt: string;
  occurredAt?: Fact<string>;
  quantity?: Fact<Quantity>;
  location?: Fact<Location>;
  frozen?: Fact<boolean>;
  opened?: Fact<boolean>;
  /** `low`, or `out` once it's closed by being used up. */
  stock?: Fact<StockLevel>;
  defrostedOn?: Fact<string>;
  lastUsedAt?: string;
  /** "Still have them" was tapped for it. */
  keptAt?: string;
  closedAt?: string;
  closedReason?: BatchCloseReason;
}

export type BatchFacts = Pick<Batch, "quantity" | "location" | "frozen" | "opened" | "occurredAt">;

export const isOpen = (b: Batch) => b.closedAt === undefined;

const byAge = (a: Batch, b: Batch) => a.addedAt.localeCompare(b.addedAt);

/** Open batches, oldest first (stable for equal dates: the order they were added). */
export function openBatches(item: Pick<Item, "batches">): Batch[] {
  return item.batches.filter(isOpen).sort(byAge);
}

/**
 * The one batch of an item from before batches existed: its ID is the item's, its facts are the
 * item's. Must match migration 0008's backfill.
 */
export function legacyBatch(item: Omit<Item, "batches"> & { batches?: Batch[] }): Batch {
  const out = item.stock?.value === "out";
  return compactBatch({
    id: item.id,
    addedAt: item.addedAt,
    occurredAt: item.occurredAt,
    quantity: item.quantity,
    location: item.location,
    frozen: item.frozen,
    opened: item.opened,
    stock: item.stock,
    lastUsedAt: item.lastUsedAt,
    closedAt: out ? item.updatedAt : undefined,
    closedReason: out ? "used-up" : undefined,
    createdAt: item.createdAt,
    createdBy: item.createdBy,
    updatedAt: item.updatedAt,
    updatedBy: item.updatedBy,
  });
}

/** An item as stored by an older build (no batches) gets its one legacy batch. */
export function ensureBatches(item: Omit<Item, "batches"> & { batches?: Batch[] }): Item {
  if (item.batches && item.batches.length > 0) return item as Item;
  return { ...item, batches: [legacyBatch(item)] } as Item;
}

function compactBatch(b: Batch): Batch {
  return Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) as unknown as Batch;
}

function sumQuantities(batches: Batch[]): Fact<Quantity> | undefined {
  if (batches.length === 1) return batches[0].quantity;
  const qs = batches.map((b) => b.quantity?.value);
  if (qs.some((q) => q?.amount === undefined)) return undefined;
  const units = new Set(qs.map((q) => normalizeText(q!.unit ?? "")));
  if (units.size !== 1) return undefined;
  const unit = qs[0]!.unit;
  const amount = Math.round(qs.reduce((n, q) => n + q!.amount!, 0) * 1000) / 1000;
  return {
    value: { asSaid: unit ? `${amount} ${unit}` : String(amount), amount, ...(unit ? { unit } : {}) },
    basis: "inferred",
    confidence: "high",
  };
}

const OUT_INFERRED: Fact<StockLevel> = { value: "out", basis: "inferred", confidence: "high" };

/** Recompute the item row's fields from its batches. Pure; keeps name, ID and audit. */
export function deriveItem(item: Item): Item {
  const open = openBatches(item);
  const {
    quantity: _q,
    location: _l,
    frozen: _f,
    opened: _o,
    stock: _s,
    occurredAt: _oa,
    lastUsedAt: _lu,
    defrostedOn: _d,
    ...rest
  } = item;
  void [_q, _l, _f, _o, _s, _oa, _lu, _d];
  const lastUsed = item.batches
    .map((b) => b.lastUsedAt)
    .filter((x): x is string => !!x)
    .sort()
    .at(-1);
  if (open.length === 0) {
    // Out: describe the batch that closed last, so "back in stock" and history read naturally.
    const last = [...item.batches].sort((a, b) => (a.closedAt ?? "").localeCompare(b.closedAt ?? "")).at(-1);
    return clean({
      ...rest,
      quantity: last?.quantity,
      location: last?.location,
      frozen: last?.frozen,
      opened: last?.opened,
      occurredAt: last?.occurredAt,
      addedAt: last?.addedAt ?? item.addedAt,
      stock: last?.stock?.value === "out" ? last.stock : OUT_INFERRED,
      lastUsedAt: lastUsed,
    });
  }
  const oldest = open[0];
  const defrosted = open
    .map((b) => b.defrostedOn)
    .filter((d): d is Fact<string> => !!d)
    .sort((a, b) => a.value.localeCompare(b.value))
    .at(-1);
  return clean({
    ...rest,
    quantity: sumQuantities(open),
    location: oldest.location,
    frozen: oldest.frozen,
    opened: oldest.opened,
    occurredAt: oldest.occurredAt,
    addedAt: oldest.addedAt,
    stock: open.every((b) => b.stock?.value === "low") ? oldest.stock : undefined,
    lastUsedAt: lastUsed,
    defrostedOn: defrosted,
  });
}

function clean(item: Item): Item {
  return Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined)) as unknown as Item;
}

/** Replace one batch (by ID) and re-derive the item. */
export function withBatch(item: Item, batch: Batch): Item {
  return deriveItem({ ...item, batches: item.batches.map((b) => (b.id === batch.id ? compactBatch(batch) : b)) });
}

export function addBatch(item: Item, batch: Batch): Item {
  return deriveItem({ ...item, batches: [...item.batches, compactBatch(batch)] });
}

export { compactBatch };
