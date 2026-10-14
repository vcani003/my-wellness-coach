/**
 * Code guards (ai.md §6): the model's output becomes a `ProposedChange` only through here.
 * - Labels become real item IDs; unknown labels fall back to the name or are dropped.
 * - Low-confidence and "assumed" facts are dropped (unknown stays unknown, 0010/0011).
 * - Evidence that isn't in the user's words downgrades "said" to "inferred".
 * - A preference is saved only on a "yes" right after Kitchen offered to remember (0012).
 * - Shopping list (0027): "need to buy X" never lands in the kitchen; a pasted list's repeats are
 *   added once; nothing goes on the list from an Out/Low alone (SL3) or from a "yes" unless
 *   Kitchen offered those items in its last turn.
 * - Batches (0025): a batch ("the new eggs") is targeted only when the user's words name one;
 *   otherwise the backend's default applies (the oldest first). "Those are gone" closes one batch
 *   (the oldest unless they said otherwise); "I defrosted X" is `item.defrost`.
 * - Categories (CAT1): an add carries the model's guess (`inferred`); the backend still prefers a
 *   remembered correction. A `said` category needs the user's words to talk about categories
 *   ("goes under sauces"), else an add's is downgraded to `inferred` (a said one is remembered)
 *   and an update's is dropped: an update only ever carries the user's own correction.
 * - The result must pass the contract's Zod schema, or nothing is proposed.
 */
import type { BatchWhich, Fact, ItemCategory, ShoppingSource } from "@/contracts/common";
import type { ItemBatchTarget, Operation, ShoppingTarget } from "@/contracts/operations";
import { nameTokens, standardName } from "@/shared/text";
import { ProposedChange } from "@/contracts/proposed-change";
import type { InterpretRequest, InterpretResult } from "../interpreter";
import type { ModelOp, ModelOutput } from "./model-output";
import { guardDishIngredients, mealOperations } from "./meal-ops";
import { itemLabels, shoppingLabels } from "./prompt";

type MetaFact = { basis: Fact<unknown>["basis"]; confidence: Fact<unknown>["confidence"] };

export const NOTHING_TO_CHANGE_REPLY =
  "I couldn't tell what to change from that, so nothing changed. Could you say it another way?";

function inMessage(text: string, evidence: string): boolean {
  const n = evidence.trim().toLowerCase();
  return n.length > 0 && text.toLowerCase().includes(n);
}

/** Drops unusable facts; downgrades "said" when the quote isn't really the user's words. */
function keep<T extends MetaFact, V>(f: T | null, value: (f: T) => V, evidenceOk: boolean): Fact<V> | undefined {
  if (!f || f.confidence === "low" || f.basis === "assumed") return undefined;
  const basis = f.basis === "said" && !evidenceOk ? "inferred" : f.basis;
  return { value: value(f), basis, confidence: f.confidence };
}

function quantityOf(q: { asSaid: string; amount: number | null; unit: string | null }) {
  const out: { asSaid: string; amount?: number; unit?: string } = { asSaid: q.asSaid.trim() };
  if (q.amount !== null && Number.isFinite(q.amount) && q.amount >= 0) out.amount = q.amount;
  if (q.unit !== null && q.unit.trim()) out.unit = q.unit.trim();
  return out;
}

/** Store spellings that should land in one group (SL1). Everything else stays as said. */
const STORE_ALIASES: Array<[RegExp, string]> = [[/^md oriental( super)?( market)?$/i, "MD Oriental"]];

export function storeName(value: string): string {
  const v = value.trim().replace(/\s+/g, " ");
  for (const [pattern, name] of STORE_ALIASES) if (pattern.test(v)) return name;
  return v;
}

/** Words that mean "to buy", not "bought": an item.add with this evidence belongs on the list. */
const BUY_INTENT =
  /\b(need to (buy|get|grab|pick up|shop)|(i|we) need\b|(add|put)\b.*\blist\b|on (my|the|our) (shopping )?list|to (my|the|our) (shopping )?list|shopping list)/i;

/** The message talks about the list or buying, so a list add next to an Out/Low was asked for. */
const LIST_INTENT = /\b(list|buy|need|shop|shopping|pick up|grab)\b/i;

/** Some word of the name (or its standard name) appears in the text. */
function mentions(text: string, name: string): boolean {
  const hay = ` ${standardName(text)} `;
  return nameTokens(name).some((t) => t.length > 1 && hay.includes(` ${t} `));
}

type Labels = { items: Map<string, string>; shopping: Map<string, string> };

/**
 * Words that name one of an item's batches (0025): "the old eggs", "the newer ones", "the ones I
 * just bought". The model's `batch` is used only when the user's own words say one of these, so a
 * plain "we're out of eggs" still means every batch.
 */
export const BATCH_WORDS =
  /\b(old|older|oldest|new|newer|newest|fresh|earlier|latest|(just|recently) (bought|got|picked up|grabbed))\b/i;

/** "Defrosted" / "thawed": an update that only unfreezes becomes `item.defrost` (0025). */
const DEFROST_WORDS = /\b(defrost(ed|ing)?|thaw(ed|ing)?|unfroze)\b/i;

/**
 * The user's words talk about a category (CAT1): "fish sauce goes under sauces", "put the tofu in
 * dairy & eggs", "hoisin is a condiment". Without this, a "said" category is the model's guess.
 */
export const CATEGORY_WORDS =
  /\b(under|categor(y|ies|ise|ize)|section|goes (in|into|under|with)|go (in|into|under|with)|belongs?|counts? as|is an? (condiment|sauce|spice|seasoning|grain|snack|sweet|drink|vegetable|fruit)|produce|condiments?|seasonings|grains|dairy|snacks|sweets|drinks|baking|canned|jarred|leftovers)\b/i;

/** The category to propose for an add or update, after the guards above (or none). */
function categoryOf(op: ModelOp, action: "add" | "update", text: string, evidenceOk: boolean): Fact<ItemCategory> | undefined {
  const f = keep(op.category ?? null, (c) => c.value, evidenceOk);
  if (!f) return undefined;
  const said = f.basis === "said" && CATEGORY_WORDS.test(text);
  if (action === "update") return said ? f : undefined;
  return said ? f : { ...f, basis: "inferred" };
}

function namedBatch(op: ModelOp, evidenceOk: boolean): BatchWhich | undefined {
  if (!op.batch || !evidenceOk) return undefined;
  return BATCH_WORDS.test(op.evidence) ? op.batch : undefined;
}

function withBatch(target: { itemId: string } | { name: string }, which: BatchWhich | undefined): ItemBatchTarget {
  return which ? { ...target, which } : target;
}

function shoppingTarget(op: ModelOp, labels: Labels, name: Fact<string> | undefined): ShoppingTarget | null {
  const id = op.item ? labels.shopping.get(op.item.trim()) : undefined;
  if (id) return { shoppingItemId: id };
  return name ? { name: name.value } : null;
}

function toOperation(op: ModelOp, opId: string, req: InterpretRequest, labels: Labels): Operation[] {
  const one = toOperationOrNull(op, opId, req, labels);
  return Array.isArray(one) ? one : one ? [one] : [];
}

function toOperationOrNull(op: ModelOp, opId: string, req: InterpretRequest, labels: Labels): Operation | Operation[] | null {
  const evidenceOk = inMessage(req.message.text, op.evidence);
  const evidence = op.evidence.trim() || undefined;
  const itemId = op.item ? labels.items.get(op.item.trim()) : undefined;
  const name = op.name?.value.trim() ? keep(op.name, (f) => f.value.trim(), evidenceOk) : undefined;
  const target = itemId ? { itemId } : name ? { name: name.value } : null;

  const quantity = keep(op.quantity, quantityOf, evidenceOk);
  const location = keep(op.location, (f) => f.value, evidenceOk);
  const frozen = keep(op.frozen, (f) => f.value, evidenceOk);
  const common = { opId, ...(evidence ? { evidence } : {}) };
  const store = keep(op.store, (f) => storeName(f.value), evidenceOk);
  const which = namedBatch(op, evidenceOk);

  // An older-style "update frozen: false" for "I defrosted the chicken" is a defrost (0025).
  const action =
    op.action === "update" && frozen?.value === false && !quantity && DEFROST_WORDS.test(op.evidence)
      ? "defrost"
      : op.action;

  switch (action) {
    case "list_add": {
      if (!name) return null;
      const fields = { name, ...(quantity && { quantity }), ...(store && store.value && { store }) };
      return { ...common, type: "shopping.add", fields };
    }
    case "list_update": {
      const target = shoppingTarget(op, labels, name);
      if (!target) return null;
      const fields = { ...(quantity && { quantity }), ...(store && store.value && { store }) };
      if (Object.keys(fields).length === 0) return null;
      return { ...common, type: "shopping.update", target, fields };
    }
    case "list_tick":
    case "list_untick": {
      const target = shoppingTarget(op, labels, name);
      if (!target) return null;
      return { ...common, type: "shopping.tick", target, ticked: op.action === "list_tick" };
    }
    case "list_remove": {
      const target = shoppingTarget(op, labels, name);
      if (!target) return null;
      return { ...common, type: "shopping.remove", target };
    }
    case "add": {
      // Restocking a listed item: reuse its exact name so the backend matches it (0025).
      const listed = itemId ? req.state.items.find((i) => i.id === itemId) : undefined;
      const addName = listed ? { ...(name ?? { basis: "said", confidence: "high" }), value: listed.name.value } : name;
      if (!addName) return null;
      // "I need to buy X" / "add X to my list" is never a kitchen add (0027): it goes on the list.
      if (!listed && evidence && BUY_INTENT.test(evidence)) {
        return { ...common, type: "shopping.add", fields: { name: addName as Fact<string>, ...(quantity && { quantity }) } };
      }
      const category = categoryOf(op, "add", req.message.text, evidenceOk);
      return {
        ...common,
        type: "item.add",
        fields: { name: addName as Fact<string>, quantity, location, frozen, ...(category && { category }) },
      };
    }
    case "update": {
      if (!target) return null;
      const category = categoryOf(op, "update", req.message.text, evidenceOk);
      const fields = {
        ...(quantity && { quantity }),
        ...(location && { location }),
        ...(frozen && { frozen }),
        ...(category && { category }),
      };
      if (Object.keys(fields).length === 0) return null;
      return { ...common, type: "item.update", target: withBatch(target, which), fields };
    }
    case "use": {
      if (!target) return null;
      const stock = keep(op.stock, (f) => f.value, evidenceOk);
      const amountUsed = keep(op.amountUsed, quantityOf, evidenceOk);
      return { ...common, type: "item.use", target: withBatch(target, which), fields: { stock, amountUsed } };
    }
    case "batch_gone":
      // "The old eggs are gone": one batch closes, the oldest unless they named the newer one.
      if (!target) return null;
      return { ...common, type: "item.batch.close", target: { ...target, which: which ?? "oldest" } };
    case "defrost": {
      if (!target) return null;
      // The date is left to the backend (now, inferred); a later "yesterday" isn't read yet.
      const defrost: Operation = { ...common, type: "item.defrost", target: withBatch(target, which) };
      // "Took the chicken out to thaw" may also say (or imply) where it is now. Only when the move
      // surely lands on the same batch the defrost does (one batch, or a named one).
      const row = itemId ? req.state.items.find((i) => i.id === itemId) : undefined;
      const sameBatch = !!which || (row?.batches?.length ?? 1) <= 1;
      if (!location || !sameBatch || row?.location?.value === location.value) return defrost;
      const moved: Operation = { ...common, opId: `${opId}:where`, type: "item.update", target: withBatch(target, which), fields: { location } };
      return [defrost, moved];
    }
    case "remove":
      if (!target) return null;
      return { ...common, type: "item.remove", target };
    default:
      // meal_* actions are resolved by meal-ops.ts.
      return null;
  }
}

function lastAssistantTurn(req: InterpretRequest): string | undefined {
  return [...req.history].reverse().find((t) => t.role === "assistant")?.text;
}

/** Kitchen offered to remember something in its last turn (0012: never save without a yes). */
function offeredToRemember(req: InterpretRequest): boolean {
  const last = lastAssistantTurn(req);
  return !!last && /\bremember\b/i.test(last);
}

/** Kitchen's last turn offered to add things to the shopping list (staples answer or SL3 offer). */
function offeredToAddToList(req: InterpretRequest): string | undefined {
  const last = lastAssistantTurn(req);
  return last && /\badd\b[^.?!]*\b(to|on) (your|the|my) (shopping )?list\b/i.test(last) ? last : undefined;
}

/**
 * Shopping-list guards (0027, SL3). Returns the operations to keep:
 * - a repeat of the same item in one message is added once;
 * - an add whose name the user didn't say needs Kitchen's offer of that item in its last turn,
 *   and is tagged with the offer's source;
 * - an add for something the same message marks Out/Low is dropped unless the user asked for the
 *   list (the reply may offer it instead).
 */
function guardShopping(ops: Operation[], out: ModelOutput, req: InterpretRequest): Operation[] {
  const text = req.message.text;
  const offer = offeredToAddToList(req);
  // Names marked Out/Low in this message ("fish sauce" matches "nước mắm (fish sauce)").
  const stockNames = ops.flatMap((o) => {
    if (o.type !== "item.use" || !o.fields.stock) return [];
    if ("name" in o.target) return [nameTokens(o.target.name)];
    const id = o.target.itemId;
    const row = req.state.items.find((i) => i.id === id);
    return row ? [nameTokens(row.name.value)] : [];
  });
  const markedOutOrLow = (name: string) => {
    const tokens = nameTokens(name);
    return stockNames.some(
      (s) => tokens.length > 0 && (tokens.every((t) => s.includes(t)) || s.every((t) => tokens.includes(t))),
    );
  };
  const seen = new Set<string>();
  const kept: Operation[] = [];
  for (const o of ops) {
    if (o.type !== "shopping.add") {
      kept.push(o);
      continue;
    }
    const std = standardName(o.fields.name.value);
    if (!std || seen.has(std)) continue;
    let source: ShoppingSource | undefined;
    if (!mentions(text, o.fields.name.value)) {
      if (!offer || !mentions(offer, o.fields.name.value)) continue;
      source = out.listOfferAccepted ?? "staples";
    } else if (markedOutOrLow(o.fields.name.value) && !LIST_INTENT.test(text)) {
      continue;
    }
    seen.add(std);
    kept.push(source ? { ...o, source } : o);
  }
  return kept;
}

export type ProposalOutcome = { ok: true; result: InterpretResult } | { ok: false; reason: string };

export function toInterpretResult(out: ModelOutput, req: InterpretRequest, now: Date = new Date()): ProposalOutcome {
  const reply = out.reply.trim();
  if (!reply) return { ok: false, reason: "empty reply" };

  const base = {
    proposalId: `${req.message.id}:chat`,
    kitchenId: req.kitchenId,
    basedOnVersion: req.version,
    source: { via: "chat" as const, messageId: req.message.id },
  };
  // Meal actions and "what can I make?" / "no oven" (0005, 0013): resolved by code.
  const meals = mealOperations(out, req, now);
  const followUps = meals.followUps.length ? { followUps: meals.followUps } : {};

  if (out.kind === "answer" && !meals.clarification && meals.operations.length === 0) {
    return { ok: true, result: { kind: "answer", proposal: null, reply, ...followUps } };
  }

  const clarifyOnly = (c: { question: string; options: Array<{ label: string; reply: string }> }, text: string): ProposalOutcome => {
    const parsed = ProposedChange.safeParse({ ...base, operations: [], clarification: c });
    if (!parsed.success) return { ok: false, reason: `clarification failed the contract: ${parsed.error.message}` };
    return { ok: true, result: { kind: "clarify", proposal: parsed.data, reply: text } };
  };

  if (out.kind === "clarify") {
    const c = out.clarification;
    const question = c?.question.trim() || reply;
    const options = (c?.options ?? [])
      .filter((o) => o.label.trim() && o.reply.trim())
      .slice(0, 4)
      .map((o) => ({ label: o.label.trim(), reply: o.reply.trim() }));
    return clarifyOnly({ question, options }, reply);
  }

  const labels = { items: itemLabels(req.state), shopping: shoppingLabels(req.state) };
  const converted: Operation[] = [];
  out.operations.forEach((op, i) => {
    converted.push(...toOperation(op, `${req.message.id}:op${i + 1}`, req, labels));
  });
  // Kitchen adds first, so the named dish's recipe sees what the user just said they have (MI1).
  const operations = [...guardDishIngredients(guardShopping(converted, out, req), out, req), ...meals.operations];

  const pref = out.rememberPreference;
  if (pref && pref.statement.trim() && offeredToRemember(req) && inMessage(req.message.text, pref.evidence)) {
    operations.push({
      opId: `${req.message.id}:pref`,
      type: "profile.preference.save",
      evidence: pref.evidence.trim(),
      fields: { statement: { value: pref.statement.trim(), basis: "said", confidence: "high" } },
      confirmedByMessageId: req.message.id,
    });
  }

  // Code couldn't tell which meal: ask, and don't claim it happened (one question, 0005).
  if (meals.clarification && operations.length === 0) return clarifyOnly(meals.clarification, meals.clarification.question);

  if (operations.length === 0) {
    if (meals.followUps.length) return { ok: true, result: { kind: "answer", proposal: null, reply, ...followUps } };
    return { ok: true, result: { kind: "answer", proposal: null, reply: NOTHING_TO_CHANGE_REPLY } };
  }

  const parsed = ProposedChange.safeParse({
    ...base,
    operations: operations.slice(0, 50),
    ...(meals.clarification ? { clarification: meals.clarification } : {}),
  });
  if (!parsed.success) return { ok: false, reason: `proposal failed the contract: ${parsed.error.message}` };
  return { ok: true, result: { kind: "change", proposal: parsed.data, reply, ...followUps } };
}
