/**
 * What the model's answer means, after decoding (structured outputs, ai.md §1). Deliberately
 * flatter than the contract: every key is present (null = unknown), items are referenced by short
 * labels (`i3`), and code turns this into a `ProposedChange` (to-proposal.ts). The API is asked
 * for the `WireOutput` shape below (fewer union types) and `fromWire` maps it to this one. No length or number
 * limits here: structured outputs don't support them, and the contract checks them afterwards.
 */
import { z } from "zod";
import { Basis, BatchWhich, Confidence, ItemCategory, Location, StockLevel } from "@/contracts/common";

const meta = { basis: Basis, confidence: Confidence };

const TextFact = z.object({ value: z.string(), ...meta });
const QuantityFact = z.object({
  asSaid: z.string(),
  amount: z.number().nullable(),
  unit: z.string().nullable(),
  ...meta,
});

/**
 * Kitchen actions (add/update/use/remove, plus batch_gone and defrost for batches, 0025) and
 * shopping-list actions (list_*, 0027). A list action never touches the kitchen; "I bought X" is a
 * kitchen add (the backend takes it off the list, SL5, and adds a batch when X is already there).
 */
export const ModelAction = z.enum([
  "add",
  "update",
  "use",
  "remove",
  "batch_gone",
  "defrost",
  "list_add",
  "list_update",
  "list_tick",
  "list_untick",
  "list_remove",
  "meal_choose",
  "meal_plan",
  "meal_start_cooking",
  "meal_done",
]);
export type ModelAction = z.infer<typeof ModelAction>;

export const ModelOp = z.object({
  action: ModelAction,
  /** The user's exact words this operation comes from, copied character for character. */
  evidence: z.string(),
  /** Label of an item already in the kitchen (e.g. "i3") or on the shopping list (e.g. "s2"), or null. */
  item: z.string().nullable(),
  /** add: the new item's name. update/use/remove with no label: the name as said. */
  name: TextFact.nullable(),
  quantity: QuantityFact.nullable(),
  location: z.object({ value: Location, ...meta }).nullable(),
  frozen: z.object({ value: z.boolean(), ...meta }).nullable(),
  /** use: "low" (running low) or "out" (used up / out). */
  stock: z.object({ value: StockLevel, ...meta }).nullable(),
  /** use: how much was used, when said. */
  amountUsed: QuantityFact.nullable(),
  /**
   * update/use/batch_gone/defrost: which of the item's batches the user named (0025): "oldest" for
   * "the old eggs", "newest" for "the new eggs" / "the ones I just bought". Null when they didn't
   * say; code then leaves the backend's default (the oldest first).
   */
  batch: BatchWhich.nullable(),
  /** list_add / list_update: the store to buy it at, as said (SL1). */
  store: TextFact.nullable(),
  /**
   * meal_*: which meal. An idea label ("d2"), a meal label ("m1"), or "last_chosen" for "that" /
   * "it" (code resolves it, never the model, 0005). Null for every other action.
   */
  meal: z.string().nullable(),
  /**
   * add / update: what kind of thing it is (CAT1). On add, the model's guess (`inferred`); on
   * update, only a correction the user gives ("fish sauce goes under sauces", `said`). Optional
   * here (absent = none) so older call sites stay unchanged; always present on the wire.
   */
  category: z.object({ value: ItemCategory, ...meta }).nullable().optional(),
});
export type ModelOp = z.infer<typeof ModelOp>;

export const ModelOutput = z.object({
  kind: z.enum(["change", "answer", "clarify"]),
  /** What Kitchen says back. For a change, written as if every operation saved. */
  reply: z.string(),
  operations: z.array(ModelOp),
  clarification: z
    .object({
      question: z.string(),
      options: z.array(z.object({ label: z.string(), reply: z.string() })),
    })
    .nullable(),
  /** Only when the user just said yes to "Want me to remember …?" in the previous turn. */
  rememberPreference: z.object({ statement: z.string(), evidence: z.string() }).nullable(),
  /**
   * Only when the previous Kitchen turn offered to add things to the shopping list and the user
   * now says yes: which offer it was. Code checks the offer really happened (0027, SL3).
   */
  listOfferAccepted: z.enum(["staples", "stock-offer"]).nullable(),
  /**
   * "What can I make?" → "ideas". A change to the open recipe ("no oven", "make it spicier") →
   * "recipe_change" with `meal`. Code turns it into a follow-up after apply. Otherwise null.
   */
  generate: z
    .object({ what: z.enum(["ideas", "recipe_change"]), meal: z.string().nullable() })
    .nullable(),
  /**
   * A dish the user names themselves ("I was thinking a chicken curry…") that isn't an idea card
   * or a meal in progress (MI1). Code chooses it and writes its recipe after apply. Null otherwise.
   * `notes`: what they said about how they want it, typos fixed. `evidence`: their exact words.
   */
  dish: z.object({ title: z.string(), notes: z.string().nullable(), evidence: z.string() }).nullable(),
});
export type ModelOutput = z.infer<typeof ModelOutput>;

/*
 * ---------------------------------------------------------------------------------------------
 * The wire shape: what the API is actually asked for (structured outputs, ai.md §1).
 *
 * The API allows at most 16 parameters with union types (`anyOf` or a type array, which is what
 * `.nullable()` produces) per request, because each one makes the schema's compilation cost grow
 * exponentially. `ModelOutput` above had 21, so every interpret call was rejected (2026-10-14).
 * The wire shape keeps `null` only for the kitchen facts (a fact object, or a number nobody said)
 * and uses plain sentinels everywhere else:
 *  - text labels and notes (item, meal, unit, generate.meal, dish.notes): "" = none
 *  - batch "unspecified", listOfferAccepted "none", generate.what "none", category.value "none"
 *  - clarification / rememberPreference / dish: always present; an empty question, statement or
 *    title means "none"
 * `fromWire` maps it back to `ModelOutput`, so everything after it (to-proposal.ts, meal-ops.ts,
 * the fake interpreter) is unchanged. tests/unit/ai-schema-limits.test.ts counts the unions.
 * ---------------------------------------------------------------------------------------------
 */

const WireQuantity = z.object({
  asSaid: z.string(),
  amount: z.number().nullable(),
  /** "" when there is no unit. */
  unit: z.string(),
  ...meta,
});

export const WireOp = z.object({
  action: ModelAction,
  evidence: z.string(),
  /** "" when nothing matches. */
  item: z.string(),
  name: TextFact.nullable(),
  quantity: WireQuantity.nullable(),
  location: z.object({ value: Location, ...meta }).nullable(),
  frozen: z.object({ value: z.boolean(), ...meta }).nullable(),
  stock: z.object({ value: StockLevel, ...meta }).nullable(),
  amountUsed: WireQuantity.nullable(),
  /** "unspecified" when the user didn't name a batch. */
  batch: z.enum([...BatchWhich.options, "unspecified"]),
  store: TextFact.nullable(),
  /** "" for every non-meal action. */
  meal: z.string(),
  /**
   * CAT1. Always an object, never null (a nullable here would be one more union type): value
   * "none" means no category. The basis and confidence are then ignored.
   */
  category: z.object({ value: z.enum([...ItemCategory.options, "none"]), ...meta }),
});
export type WireOp = z.infer<typeof WireOp>;

export const WireOutput = z.object({
  kind: z.enum(["change", "answer", "clarify"]),
  reply: z.string(),
  operations: z.array(WireOp),
  /** question "" (and no options) unless kind is "clarify". */
  clarification: z.object({
    question: z.string(),
    options: z.array(z.object({ label: z.string(), reply: z.string() })),
  }),
  /** statement "" unless the user just accepted an offer to remember something. */
  rememberPreference: z.object({ statement: z.string(), evidence: z.string() }),
  listOfferAccepted: z.enum(["staples", "stock-offer", "none"]),
  /** what "none" (meal "") unless routing to ideas or a recipe change. */
  generate: z.object({ what: z.enum(["ideas", "recipe_change", "none"]), meal: z.string() }),
  /** title "" unless the user named a dish themselves (MI1). notes "" when none. */
  dish: z.object({ title: z.string(), notes: z.string(), evidence: z.string() }),
});
export type WireOutput = z.infer<typeof WireOutput>;

/** The category sentinel: "none" (basis and confidence are placeholders). */
export const NO_CATEGORY = { value: "none", basis: "inferred", confidence: "low" } as const;

const orNull = (s: string): string | null => (s === "" ? null : s);
const orEmpty = (s: string | null): string => s ?? "";

function quantityFromWire(q: z.infer<typeof WireQuantity> | null): ModelOp["quantity"] {
  return q && { ...q, unit: orNull(q.unit) };
}

function quantityToWire(q: ModelOp["quantity"]): z.infer<typeof WireQuantity> | null {
  return q && { ...q, unit: orEmpty(q.unit) };
}

/** Wire → the internal shape (sentinels back to null). */
export function fromWire(w: WireOutput): ModelOutput {
  return {
    kind: w.kind,
    reply: w.reply,
    operations: w.operations.map((op) => ({
      action: op.action,
      evidence: op.evidence,
      item: orNull(op.item),
      name: op.name,
      quantity: quantityFromWire(op.quantity),
      location: op.location,
      frozen: op.frozen,
      stock: op.stock,
      amountUsed: quantityFromWire(op.amountUsed),
      batch: op.batch === "unspecified" ? null : op.batch,
      store: op.store,
      meal: orNull(op.meal),
      ...(op.category.value === "none" ? {} : { category: { ...op.category, value: op.category.value } }),
    })),
    clarification: w.clarification.question === "" ? null : w.clarification,
    rememberPreference: w.rememberPreference.statement === "" ? null : w.rememberPreference,
    listOfferAccepted: w.listOfferAccepted === "none" ? null : w.listOfferAccepted,
    generate: w.generate.what === "none" ? null : { what: w.generate.what, meal: orNull(w.generate.meal) },
    dish: w.dish.title === "" ? null : { title: w.dish.title, notes: orNull(w.dish.notes), evidence: w.dish.evidence },
  };
}

/** The internal shape → wire. Used by tests to build realistic mocked API answers. */
export function toWire(o: ModelOutput): WireOutput {
  return {
    kind: o.kind,
    reply: o.reply,
    operations: o.operations.map((op) => ({
      action: op.action,
      evidence: op.evidence,
      item: orEmpty(op.item),
      name: op.name,
      quantity: quantityToWire(op.quantity),
      location: op.location,
      frozen: op.frozen,
      stock: op.stock,
      amountUsed: quantityToWire(op.amountUsed),
      batch: op.batch ?? "unspecified",
      store: op.store,
      meal: orEmpty(op.meal),
      category: op.category ?? NO_CATEGORY,
    })),
    clarification: o.clarification ?? { question: "", options: [] },
    rememberPreference: o.rememberPreference ?? { statement: "", evidence: "" },
    listOfferAccepted: o.listOfferAccepted ?? "none",
    generate: o.generate ? { what: o.generate.what, meal: orEmpty(o.generate.meal) } : { what: "none", meal: "" },
    dish: o.dish ? { title: o.dish.title, notes: orEmpty(o.dish.notes), evidence: o.dish.evidence } : { title: "", notes: "", evidence: "" },
  };
}

/** Parses the API's answer: wire schema first, then mapped to `ModelOutput`. */
export function parseModelOutput(json: unknown): { success: true; data: ModelOutput } | { success: false; error: z.ZodError } {
  const parsed = WireOutput.safeParse(json);
  return parsed.success ? { success: true, data: fromWire(parsed.data) } : { success: false, error: parsed.error };
}

/**
 * The JSON schema sent as `output_config.format`: the wire shape. Built with Zod's own converter
 * rather than the SDK's `betaZodOutputFormat`, which (SDK 0.133.0) moves `enum` into the
 * description, so enum values would not be enforced. We still validate the answer afterwards.
 */
export function modelOutputFormat(): { type: "json_schema"; schema: Record<string, unknown> } {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(WireOutput, { io: "output" }) as Record<string, unknown>;
  void _ignored;
  return { type: "json_schema", schema };
}
