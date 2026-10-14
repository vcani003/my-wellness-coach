/**
 * Validation: turns a ProposedChange into events, one operation at a time (backend-data.md §6).
 * Pure: everything it needs from the database is gathered by the command first.
 *
 * Each operation is validated on its own against the state left by the operations before it.
 * The valid ones become one change set; the rejected ones come back with reasons, so one bad
 * guess doesn't sink "I bought 4 things."
 */
import type { AppliedOp, ChangeRef, RefKind, RejectedOp } from "@/contracts/apply-result";
import type { Fact, Quantity, StockLevel } from "@/contracts/common";
import {
  PROFILE_OPERATION_TYPES,
  type ItemTarget,
  type Operation,
  type OperationOf,
} from "@/contracts/operations";
import type { ProposalSource, ProposedChange } from "@/contracts/proposed-change";
import { msg } from "@/shared/messages";
import { reject, type EventFactory, type OpOutcome } from "@/shared/ops";
import { nameTokens, normalizeText, standardName } from "@/shared/text";
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
import {
  KITCHEN_EVENT,
  apply,
  getKitchenEntity,
  kitchenTouchedKeys,
  tickId,
  type ChecklistTickedPayload,
  type Item,
  type ItemAddedPayload,
  type ItemRemovedPayload,
  type ItemUpdatedPayload,
  type ItemUsedPayload,
  type KitchenEntities,
  type Meal,
  type MealChosenPayload,
  type MealNotedPayload,
  type MealTransitionedPayload,
  type RecipeSavedPayload,
  type ReviewQueuedPayload,
  type ReviewResolvedPayload,
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
 * in pasted text may only be `recipe.save`; profile operations need evidence in the typed text.
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

  if (op.type === "recipe.save") return null;
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

function itemAdd(op: OperationOf<"item.add">, env: OpEnv): OpOutcome {
  const { kitchen, make, ctx } = env;
  const k = kitchenStream(ctx.kitchenId);
  const f = op.fields;
  const std = standardName(f.name.value);
  const facts = compact({
    quantity: nn(f.quantity),
    location: nn(f.location),
    frozen: nn(f.frozen),
    opened: nn(f.opened),
    occurredAt: nn(f.occurredAt),
  });

  // Adding the same item again clears `stock` (backend-data.md §6).
  const restock = Object.values(kitchen.items).filter((i) => i.standardName === std && i.stock);
  if (restock.length === 1) {
    const item = restock[0];
    const payload: ItemUpdatedPayload = { itemId: item.id, set: facts, clear: ["stock"] };
    return ok(
      [make(k, KITCHEN_EVENT.itemUpdated, payload, { occurredAt: facts.occurredAt?.value ?? null })],
      msg("ITEM_RESTOCKED", { name: item.name.value }),
      [{ kind: "item", id: item.id, change: "updated" }],
    );
  }

  const payload: ItemAddedPayload = { itemId: ctx.newId(), name: f.name, standardName: std, ...facts };
  return ok(
    [make(k, KITCHEN_EVENT.itemAdded, payload, { occurredAt: facts.occurredAt?.value ?? null })],
    msg("ITEM_ADDED", { name: f.name.value }),
    [{ kind: "item", id: payload.itemId, change: "added" }],
  );
}

function recordUnknownItem(name: Fact<string>, env: OpEnv, extra: Partial<ItemAddedPayload> = {}): EventEnvelope {
  const payload: ItemAddedPayload = {
    itemId: env.ctx.newId(),
    name,
    standardName: standardName(name.value),
    ...compact(extra),
  };
  return env.make(kitchenStream(env.ctx.kitchenId), KITCHEN_EVENT.itemAdded, payload);
}

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
  });
  if (clear.some((field) => field in set)) return reject("INVALID_OPERATION");

  const match = resolveItem(op.target, env.kitchen);
  if (match.kind === "unknown-id") return reject("UNKNOWN_ITEM");
  if (match.kind === "ambiguous") return reject("AMBIGUOUS_ITEM", { name: "name" in op.target ? op.target.name : "" });
  if (match.kind === "none") {
    const name = f.name ?? nameFact("name" in op.target ? op.target.name : "");
    const rest = compact({ ...set, name: undefined, standardName: undefined });
    const event = recordUnknownItem(name, env, rest);
    const itemId = (event.payload as ItemAddedPayload).itemId;
    return ok([event], msg("ITEM_RECORDED", { name: name.value }), [{ kind: "item", id: itemId, change: "added" }]);
  }

  const item = match.item;
  if (Object.keys(set).length === 0 && clear.length === 0) return noChange();
  const payload: ItemUpdatedPayload = { itemId: item.id, set, clear };
  const displayName = set.name?.value ?? item.name.value;
  const summary =
    set.location && set.location.value !== item.location?.value
      ? msg("ITEM_MOVED", { name: displayName, location: set.location.value })
      : msg("ITEM_UPDATED", { name: displayName });
  return ok(
    [emit(env, k, KITCHEN_EVENT.itemUpdated, payload, set.occurredAt?.value)],
    summary,
    [{ kind: "item", id: item.id, change: "updated" }],
  );
}

function emit(env: OpEnv, stream: string, type: string, payload: unknown, occurredAt?: string): EventEnvelope {
  return env.make(stream, type, payload, { occurredAt: occurredAt ?? null });
}

function itemUse(op: OperationOf<"item.use">, env: OpEnv): OpOutcome {
  const k = kitchenStream(env.ctx.kitchenId);
  const stock = nn(op.fields.stock);
  const amountUsed = nn(op.fields.amountUsed);
  const match = resolveItem(op.target, env.kitchen);
  if (match.kind === "unknown-id") return reject("UNKNOWN_ITEM");
  if (match.kind === "ambiguous") return reject("AMBIGUOUS_ITEM", { name: "name" in op.target ? op.target.name : "" });

  const events: EventEnvelope[] = [];
  let item: Item | undefined;
  let recorded = false;
  if (match.kind === "none") {
    // Used something the kitchen never heard about: record it without asking (0011).
    const event = recordUnknownItem(nameFact("name" in op.target ? op.target.name : ""), env);
    events.push(event);
    recorded = true;
    item = apply(env.kitchen, event).items[(event.payload as ItemAddedPayload).itemId];
  } else {
    item = match.item;
    if (item.stock?.value === "out") return reject("ALREADY_OUT", { name: item.name.value });
  }

  let quantityAfter: Fact<Quantity> | null | undefined;
  let finalStock: Fact<StockLevel> | undefined = stock;
  if (amountUsed) {
    quantityAfter = item.quantity ? remainder(item.quantity, amountUsed) : undefined;
    if (quantityAfter?.value.amount === 0 && !finalStock) {
      finalStock = { value: "out", basis: "inferred", confidence: "high" };
    }
  }
  const payload: ItemUsedPayload = compact({ itemId: item.id, stock: finalStock, amountUsed, quantityAfter });
  events.push(emit(env, k, KITCHEN_EVENT.itemUsed, payload));

  const name = item.name.value;
  const summary = recorded
    ? msg("ITEM_USED_RECORDED", { name })
    : finalStock?.value === "out"
      ? msg("ITEM_OUT", { name })
      : finalStock?.value === "low"
        ? msg("ITEM_LOW", { name })
        : msg("ITEM_USED", { name });
  return ok(events, summary, [{ kind: "item", id: item.id, change: recorded ? "added" : "updated" }]);
}

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
    if (item && item.stock?.value !== "out") found.set(item.id, item);
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
      const used: ItemUsedPayload = { itemId: item.id, mealId: meal.id };
      events.push(emit(env, k, KITCHEN_EVENT.itemUsed, used));
      refs.push({ kind: "item", id: item.id, change: "updated" });
    }
  }
  const summary =
    summaryCode === "MEAL_PLANNED" ? msg("MEAL_PLANNED", { title: meal.title }) : msg("MEAL_STATUS", { title: meal.title, status: to });
  return ok(events, summary, refs);
}

function mealPlan(op: OperationOf<"meal.plan">, env: OpEnv): OpOutcome {
  const meal = env.kitchen.meals[op.target.mealId];
  if (!meal) return reject("UNKNOWN_TARGET");
  if (meal.status === "planned" || meal.status === "cooking") return noChange();
  return mealTransition(meal, "planned", undefined, env, "MEAL_PLANNED");
}

function mealTransitionOp(op: OperationOf<"meal.transition">, env: OpEnv): OpOutcome {
  const meal = env.kitchen.meals[op.target.mealId];
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

function recipeSave(op: OperationOf<"recipe.save">, env: OpEnv): OpOutcome {
  const meal = env.kitchen.meals[op.target.mealId];
  if (!meal) return reject("UNKNOWN_TARGET");
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

function reviewQueue(op: OperationOf<"review.queue">, env: OpEnv): OpOutcome {
  if (!env.kitchen.meals[op.mealId]) return reject("UNKNOWN_TARGET");
  const payload: ReviewQueuedPayload = {
    reviewId: env.ctx.newId(),
    kind: op.kind,
    mealId: op.mealId,
    items: op.items.map((i) => compact(i)),
  };
  return ok([emit(env, kitchenStream(env.ctx.kitchenId), KITCHEN_EVENT.reviewQueued, payload)], msg("REVIEW_QUEUED"), [
    { kind: "review", id: payload.reviewId, change: "added" },
  ]);
}

function reviewResolve(op: OperationOf<"review.resolve">, env: OpEnv): OpOutcome {
  const review = env.kitchen.reviews[op.target.reviewId];
  if (!review) return reject("UNKNOWN_TARGET");
  if (review.status !== "pending") {
    return reject("INVALID_TRANSITION", { title: "To review", from: review.status, to: op.outcome });
  }
  const payload: ReviewResolvedPayload = { reviewId: review.id, outcome: op.outcome };
  return ok(
    [emit(env, kitchenStream(env.ctx.kitchenId), KITCHEN_EVENT.reviewResolved, payload)],
    msg("REVIEW_RESOLVED"),
    [{ kind: "review", id: review.id, change: "updated" }],
  );
}

const REF_KIND: Record<string, RefKind> = {
  item: "item",
  meal: "meal",
  recipe: "recipe",
  tick: "tick",
  review: "review",
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
      return "itemId" in op.target ? [`item:${op.target.itemId}`] : [];
    case "meal.choose":
      return "mealId" in op.target ? [`meal:${op.target.mealId}`] : [];
    case "meal.plan":
    case "meal.transition":
    case "recipe.save":
    case "checklist.tick":
      return [`meal:${op.target.mealId}`];
    case "review.resolve":
      return [`review:${op.target.reviewId}`];
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
    case "meal.choose":
      return mealChoose(op, env);
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
    case "changeset.revert":
      return changesetRevert(op, env);
    case "profile.restriction.add":
    case "profile.restriction.update":
    case "profile.restriction.remove":
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
    applied.push({ opId: op.opId, summary: outcome.summary, refs: outcome.refs });
  }

  return { applied, rejected, events, kitchen: world.kitchen, profiles: world.profiles, touched: [...touched], reverted };
}
