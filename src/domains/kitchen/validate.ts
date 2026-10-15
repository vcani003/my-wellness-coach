/**
 * Validation: turns a ProposedChange into events, one operation at a time (backend-data.md §6).
 * Pure: everything it needs from the database is gathered by the command first.
 *
 * Each operation is validated on its own against the state left by the operations before it.
 * The valid ones become one change set; the rejected ones come back with reasons, so one bad
 * guess doesn't sink "I bought 4 things."
 */
import type { AppliedOp, BatchOffer, ChangeRef, RefKind, RejectedOp } from "@/contracts/apply-result";
import { MAX_OPEN_BATCHES, type BatchWhich, type Fact, type ItemCategory, type Location, type Msg, type Quantity, type StockLevel } from "@/contracts/common";
import {
  PASTE_ALLOWED_OPERATION_TYPES,
  PROFILE_OPERATION_TYPES,
  type BatchTarget,
  type ItemBatchTarget,
  type ItemTarget,
  type ReviewEntry,
  type ShoppingTarget,
  type Operation,
  type OperationOf,
} from "@/contracts/operations";
import type { ProposalSource, ProposedChange } from "@/contracts/proposed-change";
import { msg } from "@/shared/messages";
import { reject, type EventFactory, type OpOutcome } from "@/shared/ops";
import { foldText, nameTokens, normalizeText, standardName } from "@/shared/text";
import {
  CHANGESET_REVERTED,
  compact,
  kitchenStream,
  splitEntityKey,
  streamKind,
  type ChangesetRevertedPayload,
  type EventEnvelope,
  type Via,
} from "@/shared/events/types";
import { applyProfileEvent, profileTouchedKeys, type ProfileState } from "@/shared/profile/state";
import { validateProfileOperation } from "@/shared/profile/validate";
import { canTransition } from "./lifecycle";
import { openBatches, type Batch } from "./batches";
import { categoryForNewItem, categoryOnRestock, categoryOnUpdate, defaultCategory, effectiveCategory } from "./categories";
import { CATEGORY_LABEL_EN } from "@/shared/item-category";
import { placeForNewBatch } from "./places";
import {
  KITCHEN_EVENT,
  apply,
  getKitchenEntity,
  kitchenTouchedKeys,
  tickId,
  type BatchAddedPayload,
  type BatchClosedPayload,
  type BatchDefrostedPayload,
  type BatchKeptPayload,
  type CategoryRememberedPayload,
  type LocationRememberedPayload,
  type ChecklistTickedPayload,
  type Item,
  type ItemAddedPayload,
  type ItemRemovedPayload,
  type ItemUpdatedPayload,
  type ItemUsedPayload,
  type KitchenEntities,
  type Meal,
  type MealChosenPayload,
  type Recipe,
  type MealNotedPayload,
  type MealTransitionedPayload,
  type RecipeSavedPayload,
  type Review,
  type ReviewQueuedPayload,
  type ReviewResolvedPayload,
  type ReviewUpdatedPayload,
  type ShoppingAddedPayload,
  type ShoppingItem,
  type ShoppingMovedPayload,
  type ShoppingRemovedPayload,
  type ShoppingTickedPayload,
  type ShoppingUpdatedPayload,
} from "./state";
import { getProfileEntity } from "@/shared/profile/state";

/** Messages longer than this with no `pastedRanges` count as pasted (backend-data.md §6). */
export const PASTE_FALLBACK_LENGTH = 1500;

/** Prepared by the command for each `changeset.revert` target. */
export type RevertPlan =
  | {
      ok: true;
      /** stream → (entity key → value before the change set, or null). */
      restoreByStream: Record<string, Record<string, unknown>>;
    }
  | { ok: false; code: "UNKNOWN_TARGET" | "NOT_ALLOWED" | "ALREADY_UNDONE" | "UNDO_CONFLICT" | "UNDO_OF_UNDO" };

export interface PlanContext {
  kitchenId: string;
  actorId: string;
  via: Via;
  /** ISO 8601; the `recordedAt` of every event in this change set. */
  now: string;
  changeSetId: string;
  source: ProposalSource;
  /** The chat message text, for evidence and paste checks. */
  messageText?: string;
  /** userId → display name, for the kitchen's members. */
  members: Map<string, string>;
  kitchen: KitchenEntities;
  profiles: ProfileState;
  /** Entity keys changed by change sets after `basedOnVersion` (empty when up to date). */
  staleKeys: ReadonlySet<string>;
  ideas: ReadonlyMap<string, { name: string }>;
  reverts: ReadonlyMap<string, RevertPlan>;
  /** Event IDs a `corrects` may point at (they exist in this kitchen's or a member's stream). */
  knownEventIds: ReadonlySet<string>;
  newId: () => string;
}

export interface Plan {
  applied: AppliedOp[];
  rejected: RejectedOp[];
  /** Events in order, `seq` not yet assigned. */
  events: EventEnvelope[];
  kitchen: KitchenEntities;
  profiles: ProfileState;
  /** Entity keys this change set touched. */
  touched: string[];
  /** Change sets undone by this one. */
  reverted: string[];
}

// ─── Evidence and pasted text (backend-data.md §5–§7) ─────────────────────────────────

function occurrences(text: string, needle: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const hay = text.toLowerCase();
  const n = needle.trim().toLowerCase();
  if (!n) return out;
  for (let i = hay.indexOf(n); i !== -1; i = hay.indexOf(n, i + 1)) out.push({ start: i, end: i + n.length });
  return out;
}

/**
 * Chat operations need `evidence` (the user's exact words). Operations whose evidence sits only
 * in pasted text may only be `recipe.save` or `shopping.add` (a pasted list, 0027); profile
 * operations need evidence in the typed text.
 * Returns null when the operation passes.
 */
export function checkEvidence(op: Operation, ctx: Pick<PlanContext, "source" | "messageText">): OpOutcome | null {
  if (ctx.source.via !== "chat") return null;
  if (!op.evidence) return reject("EVIDENCE_NOT_FOUND");
  const isProfile = (PROFILE_OPERATION_TYPES as readonly string[]).includes(op.type);
  const text = ctx.messageText;
  if (text === undefined) return isProfile ? reject("EVIDENCE_NOT_FOUND") : null;

  const pasted =
    ctx.source.pastedRanges ?? (text.length > PASTE_FALLBACK_LENGTH ? [{ start: 0, end: text.length }] : []);
  const found = occurrences(text, op.evidence);
  const typed = found.some((o) => !pasted.some((r) => o.start < r.end && o.end > r.start));

  if ((PASTE_ALLOWED_OPERATION_TYPES as readonly string[]).includes(op.type)) return null;
  if (isProfile) {
    if (found.length === 0) return reject("EVIDENCE_NOT_FOUND");
    return typed ? null : reject("NOT_ALLOWED");
  }
  if (typed) return null;
  // Found only inside a paste, or not found while the message contains a paste: we can't show
  // it came from the user's own words, so pasted content can't produce it.
  if (found.length > 0 || pasted.length > 0) return reject("NOT_ALLOWED");
  return null;
}

// ─── Item matching (0011) ─────────────────────────────────────────────────────────────

type ItemMatch =
  | { kind: "found"; item: Item }
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "unknown-id" };

function matchByName(items: Item[], name: string): Item[] {
  const std = standardName(name);
  const exact = items.filter((i) => i.standardName === std);
  if (exact.length > 0) return exact;
  const tokens = nameTokens(name);
  if (tokens.length === 0) return [];
  return items.filter((i) => {
    const words = i.standardName.split(" ");
    return tokens.every((t) => words.includes(t));
  });
}

/** `{itemId}` exact; `{name}`: one match → used, none → none, several → ambiguous. Current items win over `out` ones. */
export function resolveItem(target: ItemTarget, kitchen: KitchenEntities): ItemMatch {
  if ("itemId" in target) {
    const item = kitchen.items[target.itemId];
    return item ? { kind: "found", item } : { kind: "unknown-id" };
  }
  const all = Object.values(kitchen.items);
  for (const pool of [all.filter((i) => i.stock?.value !== "out"), all.filter((i) => i.stock?.value === "out")]) {
    const m = matchByName(pool, target.name);
    if (m.length === 1) return { kind: "found", item: m[0] };
    if (m.length > 1) return { kind: "ambiguous" };
  }
  return { kind: "none" };
}

const nameFact = (name: string): Fact<string> => ({ value: name, basis: "said", confidence: "medium" });

function nn<T>(v: T | null | undefined): T | undefined {
  return v === null ? undefined : v;
}

function remainder(have: Fact<Quantity> | undefined, used: Fact<Quantity>): Fact<Quantity> | null {
  const a = have?.value;
  const b = used.value;
  if (a?.amount === undefined || b.amount === undefined || !a.unit || !b.unit) return null;
  if (normalizeText(a.unit) !== normalizeText(b.unit)) return null;
  const rest = Math.max(0, Math.round((a.amount - b.amount) * 1000) / 1000);
  return { value: { asSaid: `${rest} ${a.unit}`, amount: rest, unit: a.unit }, basis: "inferred", confidence: "high" };
}

// ─── Operations ───────────────────────────────────────────────────────────────────────

interface OpEnv {
  ctx: PlanContext;
  kitchen: KitchenEntities;
  profiles: ProfileState;
  make: EventFactory;
  touchedSoFar: ReadonlySet<string>;
}

const ok = (events: EventEnvelope[], summary: ReturnType<typeof msg>, refs: ChangeRef[]): OpOutcome => ({
  ok: true,
  events,
  summary,
  refs,
});
const noChange = () => ok([], msg("NO_CHANGE"), []);

function nextPlanPosition(kitchen: KitchenEntities): number {
  const positions = Object.values(kitchen.meals)
    .filter((m) => m.status === "planned" || m.status === "cooking")
    .map((m) => m.planPosition ?? 0);
  return positions.length ? Math.max(...positions) + 1 : 1;
}

type KitchenFacts = Partial<Pick<ItemAddedPayload, "quantity" | "location" | "frozen" | "opened" | "occurredAt">>;

interface Added {
  events: EventEnvelope[];
  itemId: string;
  batchId: string;
  /** The Out item it brought back (no open batches before). */
  restocked: Item | null;
  /** The item it joined as a new batch, next to open ones (0025). */
  merged: Item | null;
  offer?: BatchOffer;
}

const byUpdatedDesc = (a: Item, b: Item) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);

/**
 * `item.add`'s rules, shared with "Done shopping" (0025): buying something already in the kitchen
 * (same standard name) adds a **batch** to it; a 4th open batch closes the oldest, as its own
 * event. An Out item of that name comes back with the new batch. Otherwise it's a new item.
 * With several matches (duplicates saved before batches), the most recently changed one wins.
 */
function addToKitchen(
  name: Fact<string>,
  facts: KitchenFacts,
  kitchen: KitchenEntities,
  env: OpEnv,
  category?: Fact<ItemCategory>,
): Added {
  const k = kitchenStream(env.ctx.kitchenId);
  const std = standardName(name.value);
  const extra = { occurredAt: facts.occurredAt?.value ?? null };
  const same = Object.values(kitchen.items).filter((i) => i.standardName === std);
  const target =
    same.filter((i) => openBatches(i).length > 0).sort(byUpdatedDesc)[0] ?? same.sort(byUpdatedDesc)[0];
  const remember = [...rememberCategory(std, category, kitchen, env), ...rememberPlace(std, facts.location, kitchen, env)];
  // 0041: the batch goes where it usually goes when no place was said.
  const place = (cat: Fact<ItemCategory> | undefined, existing: Item | null) =>
    placeForNewBatch({ given: facts.location, frozen: facts.frozen, name: name.value, standardName: std, category: cat, existing }, kitchen);
  if (!target) {
    const itemCategory = categoryForNewItem(category, name.value, std, kitchen);
    const location = place(itemCategory, null);
    const payload: ItemAddedPayload = {
      itemId: env.ctx.newId(),
      name,
      standardName: std,
      category: itemCategory,
      batchId: env.ctx.newId(),
      ...facts,
      ...(location ? { location } : {}),
    };
    return {
      events: [env.make(k, KITCHEN_EVENT.itemAdded, payload, extra), ...remember],
      itemId: payload.itemId,
      batchId: payload.batchId!,
      restocked: null,
      merged: null,
    };
  }
  const open = openBatches(target);
  const events: EventEnvelope[] = [];
  let autoClosed: Batch | undefined;
  if (open.length >= MAX_OPEN_BATCHES) {
    autoClosed = open[0];
    const closed: BatchClosedPayload = { itemId: target.id, batchId: autoClosed.id, reason: "replaced" };
    events.push(emit(env, k, KITCHEN_EVENT.batchClosed, closed));
  }
  const batchId = env.ctx.newId();
  const location = place(effectiveCategory(target, kitchen), target);
  const added: BatchAddedPayload = { itemId: target.id, batchId, ...facts, ...(location ? { location } : {}) };
  events.push(env.make(k, KITCHEN_EVENT.batchAdded, added, extra));
  // The item keeps its category unless the user said one now (CAT1, said beats inferred).
  const recategorized = categoryOnRestock(target.category, category);
  if (recategorized) {
    const update: ItemUpdatedPayload = { itemId: target.id, set: { category: recategorized }, clear: [] };
    events.push(emit(env, k, KITCHEN_EVENT.itemUpdated, update));
  }
  events.push(...remember);
  const older = open.filter((b) => b !== autoClosed);
  const offer: BatchOffer | undefined = older.length
    ? {
        itemId: target.id,
        name: target.name.value,
        newBatchId: batchId,
        older: older.map((b) => ({ batchId: b.id, addedAt: b.addedAt, ...(b.quantity ? { quantity: b.quantity } : {}) })),
        ...(autoClosed ? { autoClosed: { batchId: autoClosed.id, addedAt: autoClosed.addedAt } } : {}),
      }
    : undefined;
  return {
    events,
    itemId: target.id,
    batchId,
    restocked: open.length === 0 ? target : null,
    merged: open.length > 0 ? target : null,
    ...(offer ? { offer } : {}),
  };
}

/** "Added eggs (2 batches)", optionally "; closed the oldest batch" and "and took it off the shopping list". */
function batchAddedMsg(name: string, batches: number, closedOldest: boolean, fromList: boolean): Msg {
  let text = `Added ${name} (${batches} batches)`;
  if (closedOldest) text += "; the oldest batch is closed";
  if (fromList) text += " and took it off the shopping list";
  return { code: "ITEM_BATCH_ADDED", params: { name, batches, closedOldest, fromList }, text };
}

function addedSummary(added: Added, name: string, fromList: boolean, kitchenAfter: KitchenEntities): Msg {
  if (added.merged) {
    const after = kitchenAfter.items[added.itemId];
    return batchAddedMsg(name, after ? openBatches(after).length : 2, !!added.offer?.autoClosed, fromList);
  }
  if (added.restocked) return msg(fromList ? "ITEM_RESTOCKED_FROM_LIST" : "ITEM_RESTOCKED", { name });
  return msg(fromList ? "ITEM_ADDED_FROM_LIST" : "ITEM_ADDED", { name });
}

const applyAll = (kitchen: KitchenEntities, events: EventEnvelope[]) => events.reduce(apply, kitchen);

/**
 * CAT1: a category the user **said** is remembered for that standard name, so the next add of
 * it defaults to it. Nothing for a guess, or when that's already what's remembered.
 */
function rememberCategory(
  std: string,
  category: Fact<ItemCategory> | undefined,
  kitchen: KitchenEntities,
  env: OpEnv,
): EventEnvelope[] {
  if (category?.basis !== "said" || !std) return [];
  if (kitchen.categoryPrefs[std]?.category === category.value) return [];
  const payload: CategoryRememberedPayload = { standardName: std, category: category.value };
  return [emit(env, kitchenStream(env.ctx.kitchenId), KITCHEN_EVENT.categoryRemembered, payload)];
}

/**
 * 0041: a place the user **said** is remembered for that standard name, so the next add of it goes
 * there ("onions go in the pantry", "put the rice in the pantry"). Nothing for an implied or guessed
 * place, or when that's already what's remembered.
 */
function rememberPlace(std: string, location: Fact<Location> | undefined, kitchen: KitchenEntities, env: OpEnv): EventEnvelope[] {
  if (location?.basis !== "said" || !std) return [];
  if (kitchen.locationPrefs?.[std]?.location === location.value) return [];
  const payload: LocationRememberedPayload = { standardName: std, location: location.value };
  return [emit(env, kitchenStream(env.ctx.kitchenId), KITCHEN_EVENT.locationRemembered, payload)];
}

/** The summary for a change that only remembered a place and/or a type for next time. */
function rememberedMsg(name: string, f: { location?: Fact<Location> | null; category?: Fact<ItemCategory> | null }): Msg {
  if (f.location?.basis === "said") return msg("PLACE_REMEMBERED", { name, location: f.location.value });
  return msg("CATEGORY_REMEMBERED", categoryParams(name, f.category!.value));
}

const categoryParams = (name: string, category: ItemCategory) => ({ name, category, categoryName: CATEGORY_LABEL_EN[category] });

function itemAdd(op: OperationOf<"item.add">, env: OpEnv): OpOutcome {
  const f = op.fields;
  const facts = compact({
    quantity: nn(f.quantity),
    location: nn(f.location),
    frozen: nn(f.frozen),
    opened: nn(f.opened),
    occurredAt: nn(f.occurredAt),
  });
  const added = addToKitchen(f.name, facts, env.kitchen, env, nn(f.category));
  const existing = added.restocked ?? added.merged;
  const itemRef: ChangeRef = { kind: "item", id: added.itemId, change: existing ? "updated" : "added", batchId: added.batchId };
  const name = existing ? existing.name.value : f.name.value;
  const fromList = boughtClearsListItems(f.name, added.itemId, env);
  const summary = addedSummary(added, name, fromList.events.length > 0, applyAll(env.kitchen, added.events));
  return {
    ...ok([...added.events, ...fromList.events], summary, [itemRef, ...fromList.refs]),
    ...(added.offer ? { batchOffers: [added.offer] } : {}),
  };
}

/**
 * SL5 Rec (pending Vero's answer; ux.md §10): telling Kitchen in chat that you bought something
 * takes the matching open shopping-list item (same standard name) off the list as moved, in the
 * same change set, so one Undo restores both. Set to false to switch the rule off.
 */
export const SL5_BOUGHT_IN_CHAT_CLEARS_LIST = true;

function boughtClearsListItems(name: Fact<string>, itemId: string, env: OpEnv): { events: EventEnvelope[]; refs: ChangeRef[] } {
  if (!SL5_BOUGHT_IN_CHAT_CLEARS_LIST || env.ctx.via !== "chat") return { events: [], refs: [] };
  const std = standardName(name.value);
  const matches = Object.values(env.kitchen.shopping).filter((e) => e.status === "open" && e.standardName === std);
  const k = kitchenStream(env.ctx.kitchenId);
  return {
    events: matches.map((e) => {
      const payload: ShoppingMovedPayload = { shoppingItemId: e.id, itemId };
      return emit(env, k, KITCHEN_EVENT.shoppingMoved, payload);
    }),
    refs: matches.map((e) => ({ kind: "shopping", id: e.id, change: "removed" })),
  };
}

function recordUnknownItem(name: Fact<string>, env: OpEnv, extra: Partial<ItemAddedPayload> = {}): EventEnvelope {
  const std = standardName(name.value);
  const payload: ItemAddedPayload = {
    itemId: env.ctx.newId(),
    name,
    standardName: std,
    batchId: env.ctx.newId(),
    ...compact(extra),
    category: categoryForNewItem(extra.category, name.value, std, env.kitchen),
  };
  return env.make(kitchenStream(env.ctx.kitchenId), KITCHEN_EVENT.itemAdded, payload);
}

// ─── Batches (0025) ───────────────────────────────────────────────────────────────────

type BatchSpec = { batchId: string } | { which: BatchWhich } | null;

/** The item part of a batch target. */
function itemPart(target: ItemBatchTarget | BatchTarget): ItemTarget {
  return "itemId" in target ? { itemId: target.itemId } : { name: target.name };
}

function batchSpec(target: ItemBatchTarget | BatchTarget): BatchSpec {
  if ("batchId" in target) return { batchId: target.batchId };
  if ("which" in target) return { which: target.which };
  return null;
}

const targetName = (target: ItemBatchTarget | BatchTarget) => ("name" in target ? target.name : "");

/** Exactly one batch: by ID (unknown → UNKNOWN_TARGET), or the oldest / newest open one. Closed → ALREADY_OUT. */
function pickBatch(item: Item, spec: NonNullable<BatchSpec>): { ok: true; batch: Batch } | { ok: false; outcome: OpOutcome } {
  if ("batchId" in spec) {
    const batch = item.batches.find((b) => b.id === spec.batchId);
    if (!batch) return { ok: false, outcome: reject("UNKNOWN_TARGET") };
    if (batch.closedAt) return { ok: false, outcome: reject("ALREADY_OUT", { name: item.name.value }) };
    return { ok: true, batch };
  }
  const open = openBatches(item);
  const batch = spec.which === "oldest" ? open[0] : open.at(-1);
  return batch ? { ok: true, batch } : { ok: false, outcome: reject("ALREADY_OUT", { name: item.name.value }) };
}

function resolveTargetItem(target: ItemBatchTarget | BatchTarget, kitchen: KitchenEntities): ItemMatch | { kind: "rejected"; outcome: OpOutcome } {
  const match = resolveItem(itemPart(target), kitchen);
  if (match.kind === "unknown-id") return { kind: "rejected", outcome: reject("UNKNOWN_ITEM") };
  if (match.kind === "ambiguous") return { kind: "rejected", outcome: reject("AMBIGUOUS_ITEM", { name: targetName(target) }) };
  return match;
}

/**
 * Name changes apply to the item; every other field to one batch: the one named, else the oldest
 * open one (the batch used next), else (Out) the last one.
 */
function itemUpdate(op: OperationOf<"item.update">, env: OpEnv): OpOutcome {
  const k = kitchenStream(env.ctx.kitchenId);
  const f = op.fields;
  const clear = op.clear ?? [];
  const set = compact({
    name: nn(f.name),
    standardName: f.name ? standardName(f.name.value) : undefined,
    quantity: nn(f.quantity),
    location: nn(f.location),
    frozen: nn(f.frozen),
    opened: nn(f.opened),
    occurredAt: nn(f.occurredAt),
    category: nn(f.category),
  });
  if (clear.some((field) => field in set)) return reject("INVALID_OPERATION");

  const match = resolveTargetItem(op.target, env.kitchen);
  if (match.kind === "rejected") return match.outcome;
  if (match.kind === "unknown-id" || match.kind === "ambiguous") return reject("UNKNOWN_ITEM");
  if (match.kind === "none") {
    const name = f.name ?? nameFact(targetName(op.target));
    const std = standardName(name.value);
    const remember = [...rememberCategory(std, set.category, env.kitchen, env), ...rememberPlace(std, set.location, env.kitchen, env)];
    // "Fish sauce goes under sauces" / "onions go in the pantry" with none in the kitchen: only
    // remember it (CAT1, 0041).
    const onlyHabit = Object.keys(set).every((key) => key === "category" || (key === "location" && set.location?.basis === "said"));
    if (onlyHabit && clear.length === 0) {
      if (remember.length === 0) return noChange();
      return ok(remember, rememberedMsg(name.value, set), []);
    }
    const rest = compact({ ...set, name: undefined, standardName: undefined });
    const event = recordUnknownItem(name, env, rest);
    const itemId = (event.payload as ItemAddedPayload).itemId;
    return ok([event, ...remember], msg("ITEM_RECORDED", { name: name.value }), [{ kind: "item", id: itemId, change: "added" }]);
  }

  const item = match.item;
  const std = set.standardName ?? item.standardName;
  const remember = [...rememberCategory(std, set.category, env.kitchen, env), ...rememberPlace(std, set.location, env.kitchen, env)];
  // CAT1: said beats inferred, and a same-as-before category is no change.
  const category = categoryOnUpdate(item.category, set.category);
  if (category) set.category = category;
  else delete set.category;
  // A rename re-sorts an item the user never sorted themselves ("chicken" → "fish sauce").
  if (set.name && !f.category && item.category?.basis !== "said") {
    const guess = defaultCategory(set.name.value, std, env.kitchen);
    if (guess.value !== item.category?.value || guess.basis !== item.category?.basis) set.category = guess;
  }
  if (Object.keys(set).length === 0 && clear.length === 0) {
    if (remember.length === 0) return noChange();
    return ok(remember, rememberedMsg(item.name.value, f), []);
  }
  const hasBatchFields =
    clear.length > 0 || Object.keys(set).some((key) => key !== "name" && key !== "standardName" && key !== "category");
  let batch: Batch | undefined;
  if (hasBatchFields) {
    const spec = batchSpec(op.target);
    if (spec) {
      const picked = pickBatch(item, spec);
      if (!picked.ok) return picked.outcome;
      batch = picked.batch;
    } else {
      batch = openBatches(item)[0] ?? item.batches.at(-1);
    }
  }
  const payload: ItemUpdatedPayload = compact({ itemId: item.id, batchId: batch?.id, set, clear });
  const displayName = set.name?.value ?? item.name.value;
  const summary =
    set.location && set.location.value !== (batch ?? item).location?.value
      ? msg("ITEM_MOVED", { name: displayName, location: set.location.value })
      : set.category && Object.keys(set).length === 1 && clear.length === 0
        ? msg("ITEM_CATEGORY", categoryParams(displayName, set.category.value))
        : msg("ITEM_UPDATED", { name: displayName });
  return ok(
    [emit(env, k, KITCHEN_EVENT.itemUpdated, payload, set.occurredAt?.value), ...remember],
    summary,
    [compact({ kind: "item" as const, id: item.id, change: "updated" as const, batchId: batch?.id })],
  );
}

function emit(env: OpEnv, stream: string, type: string, payload: unknown, occurredAt?: string): EventEnvelope {
  return env.make(stream, type, payload, { occurredAt: occurredAt ?? null });
}

const OUT_INFERRED: Fact<StockLevel> = { value: "out", basis: "inferred", confidence: "high" };

/**
 * Using an item (0025): without a batch, an amount comes off the **oldest** batch first and spills
 * into the next when the units match; `stock` applies to the whole item (Out closes every open
 * batch, 0011). With a batch, only that batch. A batch whose same-unit remainder reaches 0 closes
 * (auto-Out, 0011); the item is Out once its last batch closes.
 */
function itemUse(op: OperationOf<"item.use">, env: OpEnv): OpOutcome {
  const k = kitchenStream(env.ctx.kitchenId);
  const stock = nn(op.fields.stock);
  const amountUsed = nn(op.fields.amountUsed);
  const match = resolveTargetItem(op.target, env.kitchen);
  if (match.kind === "rejected") return match.outcome;
  if (match.kind === "unknown-id" || match.kind === "ambiguous") return reject("UNKNOWN_ITEM");

  const events: EventEnvelope[] = [];
  let item: Item;
  let recorded = false;
  if (match.kind === "none") {
    // Used something the kitchen never heard about: record it without asking (0011).
    const event = recordUnknownItem(nameFact(targetName(op.target)), env);
    events.push(event);
    recorded = true;
    item = apply(env.kitchen, event).items[(event.payload as ItemAddedPayload).itemId];
  } else {
    item = match.item;
    if (openBatches(item).length === 0) return reject("ALREADY_OUT", { name: item.name.value });
  }

  const spec = recorded ? null : batchSpec(op.target);
  let targets: Batch[];
  if (spec) {
    const picked = pickBatch(item, spec);
    if (!picked.ok) return picked.outcome;
    targets = [picked.batch];
  } else {
    targets = openBatches(item);
  }

  // Per batch, oldest first: what this use does to it.
  const plan = new Map<string, { quantityAfter?: Fact<Quantity> | null; stock?: Fact<StockLevel> }>();
  if (amountUsed) {
    let left = amountUsed.value.amount;
    for (const b of targets) {
      if (!b.quantity) {
        if (plan.size === 0) plan.set(b.id, {});
        break;
      }
      const used: Fact<Quantity> = left === undefined ? amountUsed : { ...amountUsed, value: { ...amountUsed.value, amount: left } };
      const rest = remainder(b.quantity, used);
      if (rest === null) {
        if (plan.size === 0) plan.set(b.id, { quantityAfter: null });
        break;
      }
      plan.set(b.id, { quantityAfter: rest, ...(rest.value.amount === 0 ? { stock: OUT_INFERRED } : {}) });
      left = Math.round(((left ?? 0) - ((b.quantity.value.amount ?? 0) - (rest.value.amount ?? 0))) * 1000) / 1000;
      if (left <= 0) break;
    }
  } else if (!stock) {
    plan.set(targets[0].id, {});
  }
  if (stock) for (const b of targets) plan.set(b.id, { ...plan.get(b.id), stock });

  let first = true;
  for (const b of targets) {
    const step = plan.get(b.id);
    if (!step) continue;
    const payload: ItemUsedPayload = compact({
      itemId: item.id,
      batchId: b.id,
      stock: step.stock,
      amountUsed: first ? amountUsed : undefined,
      quantityAfter: step.quantityAfter,
    });
    first = false;
    events.push(emit(env, k, KITCHEN_EVENT.itemUsed, payload));
  }

  const after = applyAll(env.kitchen, events).items[item.id];
  const openAfter = after ? openBatches(after).length : 0;
  const closedNow = targets.filter((b) => {
    const now = after?.batches.find((x) => x.id === b.id);
    return now?.closedAt && !b.closedAt;
  }).length;
  const name = item.name.value;
  const summary = recorded
    ? msg("ITEM_USED_RECORDED", { name })
    : openAfter === 0
      ? msg("ITEM_OUT", { name })
      : closedNow > 0
        ? msg("ITEM_BATCH_USED_UP", { name, left: openAfter })
        : plan.size > 0 && [...plan.values()].some((p) => p.stock?.value === "low")
          ? msg("ITEM_LOW", { name })
          : msg("ITEM_USED", { name });
  const touched = targets.filter((b) => plan.has(b.id));
  const ref: ChangeRef = compact({
    kind: "item" as const,
    id: item.id,
    change: recorded ? ("added" as const) : ("updated" as const),
    batchId: touched.length === 1 ? touched[0].id : undefined,
  });
  return ok(events, summary, [ref]);
}

/** "Those are gone" (0025): one batch closes. Already closed → no change (a double tap is harmless). */
function batchClose(op: OperationOf<"item.batch.close">, env: OpEnv): OpOutcome {
  const match = resolveTargetItem(op.target, env.kitchen);
  if (match.kind === "rejected") return match.outcome;
  if (match.kind !== "found") return ok([], msg("ITEM_REMOVE_NOT_FOUND", { name: targetName(op.target) }), []);
  const item = match.item;
  const spec = batchSpec(op.target)!;
  if ("batchId" in spec) {
    const b = item.batches.find((x) => x.id === spec.batchId);
    if (!b) return reject("UNKNOWN_TARGET");
    if (b.closedAt) return noChange();
  }
  const picked = pickBatch(item, spec);
  if (!picked.ok) return picked.outcome;
  const payload: BatchClosedPayload = { itemId: item.id, batchId: picked.batch.id, reason: "gone" };
  const left = openBatches(item).length - 1;
  const name = item.name.value;
  return ok(
    [emit(env, kitchenStream(env.ctx.kitchenId), KITCHEN_EVENT.batchClosed, payload)],
    left === 0 ? msg("ITEM_OUT", { name }) : msg("ITEM_BATCH_GONE", { name, left }),
    [{ kind: "item", id: item.id, change: "updated", batchId: picked.batch.id }],
  );
}

/**
 * "Still have them" (0025): records that the older batch is still there, which dismisses the
 * receipt's choice. A soft change: no refs (it stays out of "Since your last visit"), it can't be
 * undone, and it never blocks undoing the purchase (see `SOFT_SUMMARY_CODES`).
 */
function batchKeep(op: OperationOf<"item.batch.keep">, env: OpEnv): OpOutcome {
  const item = env.kitchen.items[op.target.itemId];
  if (!item) return reject("UNKNOWN_ITEM");
  const b = item.batches.find((x) => x.id === op.target.batchId);
  if (!b) return reject("UNKNOWN_TARGET");
  if (b.closedAt) return reject("ALREADY_OUT", { name: item.name.value });
  if (b.keptAt) return noChange();
  const payload: BatchKeptPayload = { itemId: item.id, batchId: b.id };
  return ok([emit(env, kitchenStream(env.ctx.kitchenId), KITCHEN_EVENT.batchKept, payload)], msg("ITEM_BATCH_KEPT", { name: item.name.value }), []);
}

/**
 * DF1 Rec (OPEN-QUESTIONS, not yet answered): defrosted food is in the fridge, since that's where
 * people defrost, so it's marked *inferred*. A place the user said in the same operation wins.
 * The one place this rule lives; change it here if Vero answers differently.
 */
export function locationAfterDefrost(said: Fact<Location> | undefined): Fact<Location> {
  if (said?.basis === "said") return said;
  return { value: "fridge", basis: "inferred", confidence: "high" };
}

/**
 * "I defrosted the chicken" (0025, AI8): the batch's "defrosted on" date (said, else now),
 * `frozen: false` and its place after defrosting (`locationAfterDefrost`). Without a batch: the oldest frozen open batch, else the oldest open one. An
 * item the kitchen never heard about is recorded first (0011).
 */
function itemDefrost(op: OperationOf<"item.defrost">, env: OpEnv): OpOutcome {
  const k = kitchenStream(env.ctx.kitchenId);
  const match = resolveTargetItem(op.target, env.kitchen);
  if (match.kind === "rejected") return match.outcome;
  if (match.kind === "unknown-id" || match.kind === "ambiguous") return reject("UNKNOWN_ITEM");
  const events: EventEnvelope[] = [];
  let item: Item;
  let recorded = false;
  if (match.kind === "none") {
    const event = recordUnknownItem(nameFact(targetName(op.target)), env);
    events.push(event);
    recorded = true;
    item = apply(env.kitchen, event).items[(event.payload as ItemAddedPayload).itemId];
  } else {
    item = match.item;
    if (openBatches(item).length === 0) return reject("ALREADY_OUT", { name: item.name.value });
  }
  const spec = recorded ? null : batchSpec(op.target);
  let batch: Batch;
  if (spec) {
    const picked = pickBatch(item, spec);
    if (!picked.ok) return picked.outcome;
    batch = picked.batch;
  } else {
    const open = openBatches(item);
    batch = open.find((b) => b.frozen?.value === true || b.location?.value === "freezer") ?? open[0];
  }
  const said = nn(op.fields?.defrostedOn);
  const defrostedOn: Fact<string> = said
    ? { ...said, value: new Date(said.value).toISOString() }
    : { value: env.ctx.now, basis: "inferred", confidence: "high" };
  const payload: BatchDefrostedPayload = {
    itemId: item.id,
    batchId: batch.id,
    defrostedOn,
    frozen: { value: false, basis: "inferred", confidence: "high" },
    location: locationAfterDefrost(nn(op.fields?.location)),
  };
  events.push(emit(env, k, KITCHEN_EVENT.batchDefrosted, payload, said?.value));
  return ok(events, msg("ITEM_DEFROSTED", { name: item.name.value }), [
    { kind: "item", id: item.id, change: recorded ? "added" : "updated", batchId: batch.id },
  ]);
}

/**
 * Summary codes of "soft" changes: they never block an Undo of an earlier change (prepareRevert)
 * and are not undoable themselves. Only "Still have them" (0025).
 */
export const SOFT_SUMMARY_CODES: ReadonlySet<string> = new Set(["ITEM_BATCH_KEPT"]);

function itemRemove(op: OperationOf<"item.remove">, env: OpEnv): OpOutcome {
  const match = resolveItem(op.target, env.kitchen);
  const targetName = "name" in op.target ? op.target.name : "";
  if (match.kind === "unknown-id") return reject("UNKNOWN_ITEM");
  if (match.kind === "ambiguous") return reject("AMBIGUOUS_ITEM", { name: targetName });
  if (match.kind === "none") return ok([], msg("ITEM_REMOVE_NOT_FOUND", { name: targetName }), []);
  const payload: ItemRemovedPayload = compact({ itemId: match.item.id, reason: nn(op.fields?.reason) });
  return ok(
    [emit(env, kitchenStream(env.ctx.kitchenId), KITCHEN_EVENT.itemRemoved, payload)],
    msg("ITEM_REMOVED", { name: match.item.name.value }),
    [{ kind: "item", id: match.item.id, change: "removed" }],
  );
}

function mealChoose(op: OperationOf<"meal.choose">, env: OpEnv): OpOutcome {
  const k = kitchenStream(env.ctx.kitchenId);
  const live = (m: Meal) => m.status !== "done" && m.status !== "cancelled";
  let meal: Meal | undefined;
  let payload: MealChosenPayload;
  if ("ideaId" in op.target) {
    const ideaId = op.target.ideaId;
    const idea = env.ctx.ideas.get(ideaId);
    if (!idea) return reject("UNKNOWN_TARGET");
    // Choosing the same idea twice points at the same meal.
    meal = Object.values(env.kitchen.meals).find((m) => m.ideaId === ideaId && live(m));
    payload = meal
      ? { mealId: meal.id, title: meal.title, isNew: false }
      : { mealId: env.ctx.newId(), title: idea.name, ideaId, isNew: true };
  } else if ("title" in op.target) {
    // A dish named in chat (MI1): always a new meal, with no idea behind it.
    const notes = op.target.notes?.trim();
    payload = { mealId: env.ctx.newId(), title: op.target.title.trim(), ...(notes ? { notes } : {}), isNew: true };
  } else {
    meal = env.kitchen.meals[op.target.mealId];
    if (!meal) return reject("UNKNOWN_TARGET");
    if (!live(meal)) return reject("INVALID_TRANSITION", { title: meal.title, from: meal.status, to: "chosen" });
    payload = { mealId: meal.id, title: meal.title, isNew: false };
  }
  return ok([emit(env, k, KITCHEN_EVENT.mealChosen, payload)], msg("MEAL_CHOSEN", { title: payload.title }), [
    { kind: "meal", id: payload.mealId, change: payload.isNew ? "added" : "updated" },
  ]);
}

function inKitchenIngredientItems(meal: Meal, kitchen: KitchenEntities): Item[] {
  const recipe = meal.recipeId ? kitchen.recipes[meal.recipeId] : undefined;
  if (!recipe) return [];
  const found = new Map<string, Item>();
  for (const ing of recipe.ingredients) {
    if (ing.basic) continue;
    let item = ing.itemId ? kitchen.items[ing.itemId] : undefined;
    if (!item) {
      const m = resolveItem({ name: ing.name }, kitchen);
      item = m.kind === "found" ? m.item : undefined;
    }
    if (item && openBatches(item).length > 0) found.set(item.id, item);
  }
  return [...found.values()];
}

function mealTransition(
  meal: Meal,
  to: Meal["status"],
  note: string | undefined,
  env: OpEnv,
  summaryCode: "MEAL_STATUS" | "MEAL_PLANNED",
): OpOutcome {
  const k = kitchenStream(env.ctx.kitchenId);
  if (!canTransition(meal.status, to)) {
    return reject("INVALID_TRANSITION", { title: meal.title, from: meal.status, to });
  }
  let planPosition: number | null | undefined;
  if (to === "planned") planPosition = nextPlanPosition(env.kitchen);
  else if (to === "cooking") planPosition = meal.planPosition ?? nextPlanPosition(env.kitchen);
  else if (to === "done" || to === "cancelled") planPosition = meal.planPosition !== undefined ? null : undefined;

  const payload: MealTransitionedPayload = compact({ mealId: meal.id, from: meal.status, to, planPosition, note });
  const events = [emit(env, k, KITCHEN_EVENT.mealTransitioned, payload)];
  const refs: ChangeRef[] = [{ kind: "meal", id: meal.id, change: "updated" }];

  // Finishing a meal records its in-kitchen ingredients as used in it, amount unknown (0013).
  // Cancelling never changes the kitchen.
  if (to === "done") {
    for (const item of inKitchenIngredientItems(meal, env.kitchen)) {
      // Used in this meal, amount unknown (0013): the oldest batch, the one used first (0025).
      const used: ItemUsedPayload = compact({ itemId: item.id, batchId: openBatches(item)[0]?.id, mealId: meal.id });
      events.push(emit(env, k, KITCHEN_EVENT.itemUsed, used));
      refs.push({ kind: "item", id: item.id, change: "updated" });
    }
  }
  const summary =
    summaryCode === "MEAL_PLANNED" ? msg("MEAL_PLANNED", { title: meal.title }) : msg("MEAL_STATUS", { title: meal.title, status: to });
  return ok(events, summary, refs);
}

/**
 * `{mealId}`, or `{ideaId}` = the live meal chosen from that card (a `meal.choose` earlier in the
 * same proposal has already been applied to `env.kitchen`, so "plan the omelette" is one change set).
 */
function stepMeal(target: OperationOf<"meal.plan">["target"], kitchen: KitchenEntities): Meal | undefined {
  if ("mealId" in target) return kitchen.meals[target.mealId];
  return Object.values(kitchen.meals).find(
    (m) => m.ideaId === target.ideaId && m.status !== "done" && m.status !== "cancelled",
  );
}

function mealPlan(op: OperationOf<"meal.plan">, env: OpEnv): OpOutcome {
  const meal = stepMeal(op.target, env.kitchen);
  if (!meal) return reject("UNKNOWN_TARGET");
  if (meal.status === "planned" || meal.status === "cooking") return noChange();
  return mealTransition(meal, "planned", undefined, env, "MEAL_PLANNED");
}

function mealTransitionOp(op: OperationOf<"meal.transition">, env: OpEnv): OpOutcome {
  const meal = stepMeal(op.target, env.kitchen);
  if (!meal) return reject("UNKNOWN_TARGET");
  if (op.note !== undefined && op.to !== "done") return reject("INVALID_OPERATION");
  if (op.to === meal.status) {
    // The after-cooking step done later ("Do later"): the meal is already done, save the note.
    if (op.to === "done" && op.note !== undefined) {
      const payload: MealNotedPayload = { mealId: meal.id, note: op.note };
      return ok(
        [emit(env, kitchenStream(env.ctx.kitchenId), KITCHEN_EVENT.mealNoted, payload)],
        msg("MEAL_NOTE_SAVED", { title: meal.title }),
        [{ kind: "meal", id: meal.id, change: "updated" }],
      );
    }
    return noChange();
  }
  return mealTransition(meal, op.to, op.note, env, "MEAL_STATUS");
}

/** Finished meals keep their recipe as cooked (0040 A2): the newest version at Done is the cooked one. */
const isFinished = (meal: Meal) => meal.status === "done" || meal.status === "cancelled";

/**
 * A dish's live "made again" copy (0040 RBX1): a chosen, planned or cooking meal that was made
 * again from a Done meal, with the same title folded (titles can't be renamed, RB4). The most
 * recently chosen wins. Exported for the read side.
 */
export function activeCopyOf(title: string, kitchen: KitchenEntities): Meal | undefined {
  const key = foldText(title);
  return Object.values(kitchen.meals)
    .filter((m) => m.madeAgainFromMealId && !isFinished(m) && foldText(m.title) === key)
    .sort((a, b) => b.chosenAt.localeCompare(a.chosenAt) || b.id.localeCompare(a.id))[0];
}

/** The recipe a meal was cooked with: the one it points at, else its newest version. */
function cookedRecipe(meal: Meal, kitchen: KitchenEntities): Recipe | undefined {
  return (
    (meal.recipeId ? kitchen.recipes[meal.recipeId] : undefined) ??
    Object.values(kitchen.recipes)
      .filter((r) => r.mealId === meal.id)
      .sort((a, b) => b.version - a.version)[0]
  );
}

function recipeSave(op: OperationOf<"recipe.save">, env: OpEnv): OpOutcome {
  const meal = env.kitchen.meals[op.target.mealId];
  if (!meal) return reject("UNKNOWN_TARGET");
  if (isFinished(meal)) return reject("RECIPE_LOCKED", { title: meal.title, status: meal.status });
  const versions = Object.values(env.kitchen.recipes)
    .filter((r) => r.mealId === meal.id)
    .map((r) => r.version);
  const payload: RecipeSavedPayload = {
    recipeId: env.ctx.newId(),
    mealId: meal.id,
    version: versions.length ? Math.max(...versions) + 1 : 1,
    source: op.source,
    text: op.text,
    ingredients: op.ingredients.map((i) => compact(i)),
    steps: op.steps,
    basicsAssumed: op.basicsAssumed,
  };
  return ok(
    [emit(env, kitchenStream(env.ctx.kitchenId), KITCHEN_EVENT.recipeSaved, payload)],
    msg("RECIPE_SAVED", { title: meal.title, version: payload.version }),
    [
      { kind: "recipe", id: payload.recipeId, change: "added" },
      { kind: "meal", id: meal.id, change: "updated" },
    ],
  );
}

/**
 * "Make again" (0040 C): a new `chosen` meal with the same title and, when the source had one, a
 * v1 recipe copying its cooked version (source, text, ingredients, steps, basics). One operation,
 * so one receipt and one Undo. The source meal gets no event: it's never changed. Item links
 * (`itemId`) are dropped so the copy is matched against today's kitchen by name.
 */
function mealMakeAgain(op: OperationOf<"meal.makeAgain">, env: OpEnv): OpOutcome {
  const k = kitchenStream(env.ctx.kitchenId);
  const source = env.kitchen.meals[op.fromMealId];
  if (!source) return reject("UNKNOWN_TARGET");
  // RB1: only a cooked meal is in "Cooked before".
  if (source.status !== "done") return reject("INVALID_OPERATION");
  // RBX1: one live made-again copy per dish; point at it instead of making another.
  const active = activeCopyOf(source.title, env.kitchen);
  if (active) return reject("ALREADY_MAKING", { title: active.title, mealId: active.id });
  const mealId = env.ctx.newId();
  const chosen: MealChosenPayload = { mealId, title: source.title, isNew: true, fromMealId: source.id };
  const events = [emit(env, k, KITCHEN_EVENT.mealChosen, chosen)];
  const refs: ChangeRef[] = [{ kind: "meal", id: mealId, change: "added" }];
  const cooked = cookedRecipe(source, env.kitchen);
  if (cooked) {
    const recipe: RecipeSavedPayload = {
      recipeId: env.ctx.newId(),
      mealId,
      version: 1,
      source: cooked.source,
      text: cooked.text,
      ingredients: cooked.ingredients.map(({ itemId: _itemId, ...rest }) => {
        void _itemId;
        return compact(rest);
      }),
      steps: [...cooked.steps],
      basicsAssumed: [...cooked.basicsAssumed],
      copiedFromRecipeId: cooked.id,
    };
    events.push(emit(env, k, KITCHEN_EVENT.recipeSaved, recipe));
    refs.push({ kind: "recipe", id: recipe.recipeId, change: "added" });
  }
  return ok(events, msg("MEAL_MADE_AGAIN", { title: source.title }), refs);
}

function checklistTick(op: OperationOf<"checklist.tick">, env: OpEnv): OpOutcome {
  const meal = env.kitchen.meals[op.target.mealId];
  if (!meal) return reject("UNKNOWN_TARGET");
  const ingredientKey = standardName(op.ingredient);
  const id = tickId(meal.id, ingredientKey);
  const exists = Boolean(env.kitchen.ticks[id]);
  if (exists === op.ticked) return noChange();
  const payload: ChecklistTickedPayload = { mealId: meal.id, ingredient: op.ingredient, ingredientKey, ticked: op.ticked };
  return ok(
    [emit(env, kitchenStream(env.ctx.kitchenId), KITCHEN_EVENT.checklistTicked, payload)],
    msg(op.ticked ? "TICKED" : "UNTICKED", { ingredient: op.ingredient }),
    [{ kind: "tick", id, change: op.ticked ? "added" : "removed" }],
  );
}

type QueueEntry = OperationOf<"review.queue">["items"][number];
const listItemId = (e: QueueEntry) => ("shoppingItemId" in e ? e.shoppingItemId : undefined);

function reviewQueue(op: OperationOf<"review.queue">, env: OpEnv): OpOutcome {
  if (op.mealId === undefined) return queueShoppingReview(op, env);
  if (!env.kitchen.meals[op.mealId]) return reject("UNKNOWN_TARGET");
  // A meal's card names its entries; list items belong on the shopping-list card.
  if (op.items.some((i) => listItemId(i) !== undefined)) return reject("INVALID_OPERATION");
  const payload: ReviewQueuedPayload = {
    reviewId: env.ctx.newId(),
    kind: op.kind,
    mealId: op.mealId,
    items: op.items.map((i) => compact(i as ReviewEntry)),
  };
  return ok([emit(env, kitchenStream(env.ctx.kitchenId), KITCHEN_EVENT.reviewQueued, payload)], msg("REVIEW_QUEUED"), [
    { kind: "review", id: payload.reviewId, change: "added" },
  ]);
}

/** The shopping list's pending "Add to your kitchen?" card, if there is one. */
const pendingShoppingReview = (kitchen: KitchenEntities): Review | undefined =>
  Object.values(kitchen.reviews).find((r) => r.status === "pending" && r.origin === "shopping-list");

const stillOnList = (e: ReviewEntry, kitchen: KitchenEntities) =>
  e.shoppingItemId !== undefined && kitchen.shopping[e.shoppingItemId]?.status === "open";

/**
 * "Do later" on the Done-shopping sheet (ux.md §10): the chosen list items wait in To review as
 * "N items to add · Shopping list". Nothing on the list changes (ticks stay). The items must be
 * open on the list; ticking isn't needed yet, since the sheet lets you choose unticked ones.
 * There's one such card: queuing again adds to it, so nothing queued earlier is lost.
 */
function queueShoppingReview(op: OperationOf<"review.queue">, env: OpEnv): OpOutcome {
  if (op.kind !== "add-to-kitchen" || op.items.length === 0) return reject("INVALID_OPERATION");
  const seen = new Set<string>();
  const entries: ReviewEntry[] = [];
  for (const i of op.items) {
    const id = listItemId(i);
    if (id === undefined || seen.has(id)) return reject("INVALID_OPERATION");
    seen.add(id);
    const entry = env.kitchen.shopping[id];
    if (!entry) return reject("UNKNOWN_TARGET");
    if (entry.status !== "open") return reject("NOT_ON_LIST", { name: entry.name.value });
    entries.push({ name: entry.name.value, shoppingItemId: id });
  }

  const k = kitchenStream(env.ctx.kitchenId);
  const card = pendingShoppingReview(env.kitchen);
  if (!card) {
    const payload: ReviewQueuedPayload = {
      reviewId: env.ctx.newId(),
      kind: "add-to-kitchen",
      origin: "shopping-list",
      items: entries,
    };
    return ok(
      [emit(env, k, KITCHEN_EVENT.reviewQueued, payload)],
      msg("SHOPPING_REVIEW_QUEUED", { names: entries.map((e) => e.name).join(", ") }),
      [{ kind: "review", id: payload.reviewId, change: "added" }],
    );
  }
  // Keep what's still waiting on the list, then add the new ones.
  const kept = card.items.filter((e) => stillOnList(e, env.kitchen));
  const added = entries.filter((e) => !kept.some((x) => x.shoppingItemId === e.shoppingItemId));
  if (added.length === 0 && kept.length === card.items.length) return noChange();
  const payload: ReviewUpdatedPayload = { reviewId: card.id, items: [...kept, ...added] };
  return ok(
    [emit(env, k, KITCHEN_EVENT.reviewUpdated, payload)],
    msg("SHOPPING_REVIEW_QUEUED", { names: payload.items.map((e) => e.name).join(", ") }),
    [{ kind: "review", id: card.id, change: "updated" }],
  );
}

/**
 * Close a To review card. A shopping-list card resolved `done` moves the chosen `items` into the
 * kitchen with exactly "Done shopping"'s checks and events, and closes in the same operation, so
 * the card only closes if they all went in, and one Undo restores the list, the kitchen and the card.
 */
function reviewResolve(op: OperationOf<"review.resolve">, env: OpEnv): OpOutcome {
  const review = env.kitchen.reviews[op.target.reviewId];
  if (!review) return reject("UNKNOWN_TARGET");
  if (review.status !== "pending") {
    return reject("INVALID_TRANSITION", { title: "To review", from: review.status, to: op.outcome });
  }
  const k = kitchenStream(env.ctx.kitchenId);
  const ref: ChangeRef = { kind: "review", id: review.id, change: "updated" };
  const payload: ReviewResolvedPayload = { reviewId: review.id, outcome: op.outcome };
  if (review.origin !== "shopping-list" || op.outcome === "skipped") {
    // `items` only means something when a shopping-list card is done.
    if (op.items) return reject("INVALID_OPERATION");
    return ok([emit(env, k, KITCHEN_EVENT.reviewResolved, payload)], msg("REVIEW_RESOLVED"), [ref]);
  }

  if (!op.items) return reject("INVALID_OPERATION");
  const queued = new Set(review.items.map((e) => e.shoppingItemId));
  if (op.items.some((i) => !queued.has(i.shoppingItemId))) return reject("INVALID_OPERATION");
  const checked = checkDoneItems(op.items, env.kitchen);
  if (!checked.ok) return checked.outcome;
  const moved = moveToKitchen(checked.chosen, env);
  return {
    ...ok([...moved.events, emit(env, k, KITCHEN_EVENT.reviewResolved, payload)], moved.summary, [...moved.refs, ref]),
    ...(moved.batchOffers.length ? { batchOffers: moved.batchOffers } : {}),
  };
}

// ─── Shopping list (0027, SL1–SL3) ───────────────────────────────────────────────────

type ShoppingMatch =
  | { kind: "found"; entry: ShoppingItem }
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "unknown-id" }
  | { kind: "not-open"; entry: ShoppingItem };

const openShopping = (kitchen: KitchenEntities) => Object.values(kitchen.shopping).filter((e) => e.status === "open");

/** `{shoppingItemId}` exact; `{name}` matched like items (exact standard name, then all the words), open items only. */
export function resolveShopping(target: ShoppingTarget, kitchen: KitchenEntities): ShoppingMatch {
  if ("shoppingItemId" in target) {
    const entry = kitchen.shopping[target.shoppingItemId];
    if (!entry) return { kind: "unknown-id" };
    return entry.status === "open" ? { kind: "found", entry } : { kind: "not-open", entry };
  }
  const open = openShopping(kitchen);
  const std = standardName(target.name);
  let m = open.filter((e) => e.standardName === std);
  if (m.length === 0) {
    const tokens = nameTokens(target.name);
    m = tokens.length ? open.filter((e) => tokens.every((t) => e.standardName.split(" ").includes(t))) : [];
  }
  if (m.length === 1) return { kind: "found", entry: m[0] };
  return m.length > 1 ? { kind: "ambiguous" } : { kind: "none" };
}

/**
 * A store that matches one already on the list (ignoring case and punctuation) keeps that
 * spelling, so "md oriental" and "MD Oriental" don't become two groups (SL1).
 */
function canonicalStore(store: Fact<string> | undefined, kitchen: KitchenEntities): Fact<string> | undefined {
  if (!store) return undefined;
  const key = normalizeText(store.value);
  if (!key) return undefined;
  const known = openShopping(kitchen).find((e) => e.store && normalizeText(e.store.value) === key);
  return known?.store ? { ...store, value: known.store.value } : { ...store, value: store.value.trim() };
}

const sameQuantity = (a: Fact<Quantity> | undefined, b: Fact<Quantity>) =>
  a !== undefined && normalizeText(a.value.asSaid) === normalizeText(b.value.asSaid);

function shoppingRejectFor(match: ShoppingMatch, target: ShoppingTarget): OpOutcome | null {
  const targetName = "name" in target ? target.name : "";
  if (match.kind === "unknown-id") return reject("UNKNOWN_TARGET");
  if (match.kind === "not-open") return reject("NOT_ON_LIST", { name: match.entry.name.value });
  if (match.kind === "ambiguous") return reject("AMBIGUOUS_ITEM", { name: targetName });
  if (match.kind === "none") return ok([], msg("SHOPPING_NOT_FOUND", { name: targetName }), []);
  return null;
}

function shoppingAdd(op: OperationOf<"shopping.add">, env: OpEnv): OpOutcome {
  const k = kitchenStream(env.ctx.kitchenId);
  const f = op.fields;
  const std = standardName(f.name.value);
  if (!std) return reject("INVALID_OPERATION");
  const quantity = nn(f.quantity);
  const store = canonicalStore(nn(f.store), env.kitchen);

  // Already open on the list: merge instead of duplicating; a newly given store or quantity wins.
  const existing = openShopping(env.kitchen).find((e) => e.standardName === std);
  if (existing) {
    const set = compact({
      quantity: quantity && !sameQuantity(existing.quantity, quantity) ? quantity : undefined,
      store: store && store.value !== existing.store?.value ? store : undefined,
    });
    if (Object.keys(set).length === 0) return ok([], msg("SHOPPING_ALREADY", { name: existing.name.value }), []);
    const payload: ShoppingUpdatedPayload = { shoppingItemId: existing.id, set, clear: [] };
    return ok(
      [emit(env, k, KITCHEN_EVENT.shoppingUpdated, payload)],
      set.store
        ? msg("SHOPPING_STORE", { name: existing.name.value, store: set.store.value })
        : msg("SHOPPING_UPDATED", { name: existing.name.value }),
      [{ kind: "shopping", id: existing.id, change: "updated" }],
    );
  }

  const positions = Object.values(env.kitchen.shopping).map((e) => e.position);
  const payload: ShoppingAddedPayload = compact({
    shoppingItemId: env.ctx.newId(),
    name: f.name,
    standardName: std,
    quantity,
    store,
    source: op.source ?? "chat",
    position: positions.length ? Math.max(...positions) + 1 : 1,
  });
  return ok(
    [emit(env, k, KITCHEN_EVENT.shoppingAdded, payload)],
    store
      ? msg("SHOPPING_ADDED_STORE", { name: f.name.value, store: store.value })
      : msg("SHOPPING_ADDED", { name: f.name.value }),
    [{ kind: "shopping", id: payload.shoppingItemId, change: "added" }],
  );
}

function shoppingUpdate(op: OperationOf<"shopping.update">, env: OpEnv): OpOutcome {
  const f = op.fields;
  const clear = op.clear ?? [];
  const store = canonicalStore(nn(f.store), env.kitchen);
  const set = compact({
    name: nn(f.name),
    standardName: f.name ? standardName(f.name.value) : undefined,
    quantity: nn(f.quantity),
    store,
  });
  if (clear.some((field) => field in set)) return reject("INVALID_OPERATION");
  if (set.standardName === "") return reject("INVALID_OPERATION");

  const match = resolveShopping(op.target, env.kitchen);
  const rejected = shoppingRejectFor(match, op.target);
  if (rejected) return rejected;
  const entry = (match as { entry: ShoppingItem }).entry;
  if (Object.keys(set).length === 0 && clear.length === 0) return noChange();

  const payload: ShoppingUpdatedPayload = { shoppingItemId: entry.id, set, clear };
  const name = set.name?.value ?? entry.name.value;
  return ok(
    [emit(env, kitchenStream(env.ctx.kitchenId), KITCHEN_EVENT.shoppingUpdated, payload)],
    store ? msg("SHOPPING_STORE", { name, store: store.value }) : msg("SHOPPING_UPDATED", { name }),
    [{ kind: "shopping", id: entry.id, change: "updated" }],
  );
}

function shoppingTick(op: OperationOf<"shopping.tick">, env: OpEnv): OpOutcome {
  const match = resolveShopping(op.target, env.kitchen);
  const rejected = shoppingRejectFor(match, op.target);
  if (rejected) return rejected;
  const entry = (match as { entry: ShoppingItem }).entry;
  // Already as asked (e.g. both of you ticked it): the first tick, and who made it, stand.
  if (Boolean(entry.tickedAt) === op.ticked) return noChange();
  const payload: ShoppingTickedPayload = { shoppingItemId: entry.id, ticked: op.ticked };
  return ok(
    [emit(env, kitchenStream(env.ctx.kitchenId), KITCHEN_EVENT.shoppingTicked, payload)],
    msg(op.ticked ? "SHOPPING_TICKED" : "SHOPPING_UNTICKED", { name: entry.name.value }),
    [{ kind: "shopping", id: entry.id, change: "updated" }],
  );
}

function shoppingRemove(op: OperationOf<"shopping.remove">, env: OpEnv): OpOutcome {
  const match = resolveShopping(op.target, env.kitchen);
  const rejected = shoppingRejectFor(match, op.target);
  if (rejected) return rejected;
  const entry = (match as { entry: ShoppingItem }).entry;
  const payload: ShoppingRemovedPayload = { shoppingItemId: entry.id };
  return ok(
    [emit(env, kitchenStream(env.ctx.kitchenId), KITCHEN_EVENT.shoppingRemoved, payload)],
    msg("SHOPPING_REMOVED", { name: entry.name.value }),
    [{ kind: "shopping", id: entry.id, change: "removed" }],
  );
}

type DoneItem = OperationOf<"shopping.done">["items"][number];
type ChosenItem = { entry: ShoppingItem; fields: DoneItem["fields"] };

/** "Done shopping"'s checks: every chosen item open on the list and ticked, with no repeats. */
function checkDoneItems(
  items: DoneItem[],
  kitchen: KitchenEntities,
): { ok: true; chosen: ChosenItem[] } | { ok: false; outcome: OpOutcome } {
  const seen = new Set<string>();
  const chosen: ChosenItem[] = [];
  for (const { shoppingItemId, fields } of items) {
    if (seen.has(shoppingItemId)) return { ok: false, outcome: reject("INVALID_OPERATION") };
    seen.add(shoppingItemId);
    const entry = kitchen.shopping[shoppingItemId];
    if (!entry) return { ok: false, outcome: reject("UNKNOWN_TARGET") };
    if (entry.status !== "open") return { ok: false, outcome: reject("NOT_ON_LIST", { name: entry.name.value }) };
    if (!entry.tickedAt) return { ok: false, outcome: reject("NOT_TICKED", { name: entry.name.value }) };
    chosen.push({ entry, fields });
  }
  return { ok: true, chosen };
}

/** "Done shopping" (SL2): chosen ticked items go into the kitchen and leave the list. All or nothing. */
function shoppingDone(op: OperationOf<"shopping.done">, env: OpEnv): OpOutcome {
  const checked = checkDoneItems(op.items, env.kitchen);
  if (!checked.ok) return checked.outcome;
  const moved = moveToKitchen(checked.chosen, env);
  return { ...ok(moved.events, moved.summary, moved.refs), ...(moved.batchOffers.length ? { batchOffers: moved.batchOffers } : {}) };
}

/** Each chosen item goes in with `item.add`'s rules and leaves the list as moved, linked to its kitchen item. */
function moveToKitchen(
  chosen: ChosenItem[],
  env: OpEnv,
): { events: EventEnvelope[]; summary: ReturnType<typeof msg>; refs: ChangeRef[]; batchOffers: BatchOffer[] } {
  const k = kitchenStream(env.ctx.kitchenId);
  let working = env.kitchen;
  const events: EventEnvelope[] = [];
  const refs: ChangeRef[] = [];
  const batchOffers: BatchOffer[] = [];
  for (const { entry, fields } of chosen) {
    const facts: KitchenFacts = compact({
      quantity: nn(fields?.quantity) ?? entry.quantity,
      location: nn(fields?.location),
      frozen: nn(fields?.frozen),
      opened: nn(fields?.opened),
    });
    const added = addToKitchen(entry.name, facts, working, env);
    const moved: ShoppingMovedPayload = { shoppingItemId: entry.id, itemId: added.itemId };
    const movedEvent = emit(env, k, KITCHEN_EVENT.shoppingMoved, moved);
    for (const e of [...added.events, movedEvent]) {
      working = apply(working, e);
      events.push(e);
    }
    if (added.offer) batchOffers.push(added.offer);
    refs.push(
      { kind: "item", id: added.itemId, change: added.restocked || added.merged ? "updated" : "added", batchId: added.batchId },
      { kind: "shopping", id: entry.id, change: "removed" },
    );
  }
  const names = chosen.map((c) => c.entry.name.value);
  return { events, summary: msg("SHOPPING_DONE", { count: names.length, names: names.join(", ") }), refs, batchOffers };
}

const REF_KIND: Record<string, RefKind> = {
  item: "item",
  meal: "meal",
  recipe: "recipe",
  tick: "tick",
  review: "review",
  shopping: "shopping",
  restriction: "profile",
  preference: "profile",
};

function changesetRevert(op: OperationOf<"changeset.revert">, env: OpEnv): OpOutcome {
  const target = op.target.changeSetId;
  const plan = env.ctx.reverts.get(target);
  if (!plan) return reject("UNKNOWN_TARGET");
  if (!plan.ok) return reject(plan.code);
  const keys = Object.values(plan.restoreByStream).flatMap((r) => Object.keys(r));
  if (keys.some((key) => env.touchedSoFar.has(key))) return reject("UNDO_CONFLICT");

  const events: EventEnvelope[] = [];
  const refs: ChangeRef[] = [];
  for (const [stream, restore] of Object.entries(plan.restoreByStream)) {
    const payload: ChangesetRevertedPayload = { changeSetId: target, restore };
    events.push(env.make(stream, CHANGESET_REVERTED, payload, { reverses: target }));
    for (const [key, value] of Object.entries(restore)) {
      const { kind, id } = splitEntityKey(key);
      const now =
        streamKind(stream) === "kitchen" ? getKitchenEntity(env.kitchen, key) : getProfileEntity(env.profiles, key);
      const change = value === null ? "removed" : now ? "updated" : "added";
      if (REF_KIND[kind]) refs.push({ kind: REF_KIND[kind], id, change });
    }
  }
  return ok(events, msg("UNDONE"), refs);
}

/** IDs an operation targets directly; checked against `staleKeys`. */
function targetKeys(op: Operation): string[] {
  switch (op.type) {
    case "item.update":
    case "item.use":
    case "item.remove":
    case "item.defrost":
      return "itemId" in op.target ? [`item:${op.target.itemId}`] : [];
    case "item.batch.close":
      // An exact batch ID can't point at the wrong batch, so "Those are gone" from an older
      // receipt still works after other changes to the item.
      return "itemId" in op.target && !("batchId" in op.target) ? [`item:${op.target.itemId}`] : [];
    case "meal.choose":
      return "mealId" in op.target ? [`meal:${op.target.mealId}`] : [];
    case "meal.plan":
    case "meal.transition":
      return "mealId" in op.target ? [`meal:${op.target.mealId}`] : [];
    case "recipe.save":
    case "checklist.tick":
      return [`meal:${op.target.mealId}`];
    case "review.resolve":
      return [`review:${op.target.reviewId}`, ...(op.items ?? []).map((i) => `shopping:${i.shoppingItemId}`)];
    case "shopping.update":
    case "shopping.tick":
    case "shopping.remove":
      return "shoppingItemId" in op.target ? [`shopping:${op.target.shoppingItemId}`] : [];
    case "shopping.done":
      return op.items.map((i) => `shopping:${i.shoppingItemId}`);
    default:
      return [];
  }
}

function validateOperation(op: Operation, env: OpEnv): OpOutcome {
  const evidence = checkEvidence(op, env.ctx);
  if (evidence) return evidence;
  if (op.corrects && !env.ctx.knownEventIds.has(op.corrects)) return reject("UNKNOWN_TARGET");
  if (targetKeys(op).some((key) => env.ctx.staleKeys.has(key))) return reject("STALE_TARGET");

  switch (op.type) {
    case "item.add":
      return itemAdd(op, env);
    case "item.update":
      return itemUpdate(op, env);
    case "item.use":
      return itemUse(op, env);
    case "item.remove":
      return itemRemove(op, env);
    case "item.batch.close":
      return batchClose(op, env);
    case "item.batch.keep":
      return batchKeep(op, env);
    case "item.defrost":
      return itemDefrost(op, env);
    case "meal.choose":
      return mealChoose(op, env);
    case "meal.makeAgain":
      return mealMakeAgain(op, env);
    case "meal.plan":
      return mealPlan(op, env);
    case "meal.transition":
      return mealTransitionOp(op, env);
    case "recipe.save":
      return recipeSave(op, env);
    case "checklist.tick":
      return checklistTick(op, env);
    case "review.queue":
      return reviewQueue(op, env);
    case "review.resolve":
      return reviewResolve(op, env);
    case "shopping.add":
      return shoppingAdd(op, env);
    case "shopping.update":
      return shoppingUpdate(op, env);
    case "shopping.tick":
      return shoppingTick(op, env);
    case "shopping.remove":
      return shoppingRemove(op, env);
    case "shopping.done":
      return shoppingDone(op, env);
    case "changeset.revert":
      return changesetRevert(op, env);
    case "profile.restriction.add":
    case "profile.restriction.update":
    case "profile.restriction.remove":
    case "profile.restriction.verify":
    case "profile.preference.save":
    case "profile.preference.remove":
      return validateProfileOperation(op, {
        actorId: env.ctx.actorId,
        members: env.ctx.members,
        profiles: env.profiles,
        newId: env.ctx.newId,
        make: env.make,
      });
  }
}

/** Apply events from any stream to the working state. */
export function applyToWorld(
  world: { kitchen: KitchenEntities; profiles: ProfileState },
  event: EventEnvelope,
): { kitchen: KitchenEntities; profiles: ProfileState } {
  return streamKind(event.stream) === "kitchen"
    ? { ...world, kitchen: apply(world.kitchen, event) }
    : { ...world, profiles: applyProfileEvent(world.profiles, event) };
}

export function touchedKeys(event: EventEnvelope): string[] {
  return streamKind(event.stream) === "kitchen" ? kitchenTouchedKeys(event) : profileTouchedKeys(event);
}

/** Validate every operation in order and build the change set. Pure. */
export function planProposal(proposal: ProposedChange, ctx: PlanContext): Plan {
  let world = { kitchen: ctx.kitchen, profiles: ctx.profiles };
  const applied: AppliedOp[] = [];
  const rejected: RejectedOp[] = [];
  const events: EventEnvelope[] = [];
  const touched = new Set<string>();
  const reverted: string[] = [];
  const sourceMessageId = proposal.source.via === "chat" ? proposal.source.messageId : null;

  for (const op of proposal.operations) {
    const makeForOp: EventFactory = (stream, type, payload, extra) => ({
      id: ctx.newId(),
      stream,
      seq: 0,
      type,
      v: 1,
      actor: ctx.actorId,
      via: ctx.via,
      recordedAt: ctx.now,
      occurredAt: extra?.occurredAt ? new Date(extra.occurredAt).toISOString() : null,
      changeSetId: ctx.changeSetId,
      sourceMessageId,
      reverses: extra?.reverses ?? null,
      corrects: op.corrects ?? null,
      payload,
    });
    let outcome: OpOutcome;
    try {
      outcome = validateOperation(op, { ctx, ...world, make: makeForOp, touchedSoFar: touched });
    } catch (error) {
      // A bug in one operation's rules must not sink the others (0018).
      console.error("kitchen.validate: operation threw", { opId: op.opId, type: op.type, error });
      outcome = reject("INVALID_OPERATION");
    }
    if (!outcome.ok) {
      rejected.push({ opId: op.opId, reason: outcome.reason });
      continue;
    }
    for (const event of outcome.events) {
      world = applyToWorld(world, event);
      for (const key of touchedKeys(event)) touched.add(key);
      events.push(event);
    }
    if (op.type === "changeset.revert" && outcome.events.length > 0) reverted.push(op.target.changeSetId);
    applied.push({
      opId: op.opId,
      summary: outcome.summary,
      refs: outcome.refs,
      ...(outcome.batchOffers?.length ? { batchOffers: outcome.batchOffers } : {}),
    });
  }

  return { applied, rejected, events, kitchen: world.kitchen, profiles: world.profiles, touched: [...touched], reverted };
}
