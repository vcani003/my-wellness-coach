/**
 * What the model's answer means, after decoding (structured outputs, ai.md §1). Deliberately
 * flatter than the contract: every key is present (null = unknown), items are referenced by short
 * labels (`i3`), and code turns this into a `ProposedChange` (to-proposal.ts). The API is asked
 * for the `WireOutput` shape below (no union types) and `fromWire` maps it to this one. No length or number
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
 * Kitchen actions (add/update/use/remove, level for how much is left (KOS4), plus batch_gone and
 * defrost for batches, 0025) and
 * shopping-list actions (list_*, 0027). A list action never touches the kitchen; "I bought X" is a
 * kitchen add (the backend takes it off the list, SL5, and adds a batch when X is already there).
 * staple_add / staple_remove (0054): only when the user says it, or says yes to Kitchen's offer
 * to remember staples (SS2); code checks both (to-proposal.ts).
 */
export const ModelAction = z.enum([
  "add",
  "update",
  "use",
  "level",
  "remove",
  "batch_gone",
  "defrost",
  "list_add",
  "list_update",
  "list_tick",
  "list_untick",
  "list_remove",
  "staple_add",
  "staple_remove",
  "meal_choose",
  "meal_plan",
  "meal_start_cooking",
  "meal_done",
  // 0045 KOS1: set or move a planned meal's day ("move the pasta to Friday"); clear it.
  "meal_date",
  "meal_clear_date",
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
  /**
   * use: "low" (running low) or "out" (used up / out). level (0045 KOS4): how much is left, said
   * without a use: "plenty" / "some" (or "low" / "out").
   */
  stock: z.object({ value: StockLevel, ...meta }).nullable(),
  /** use: how much was used, when said. */
  amountUsed: QuantityFact.nullable(),
  /**
   * update/use/batch_gone/defrost: which of the item's batches the user named (0025): "oldest" for
   * "the old eggs", "newest" for "the new eggs" / "the ones I just bought". Null when they didn't
   * say; code then leaves the backend's default (the oldest first).
   */
  batch: BatchWhich.nullable(),
  /** list_add / list_update / staple_add: the store to buy it at, as said (SL1, 0054 SS5). */
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
  /**
   * meal_plan / meal_date (0045 KOS1): the day exactly as the user said it ("Tuesday", "tomorrow",
   * "the 24th"). Code resolves it from the message's own day, never the model. Optional here
   * (absent = none) so older call sites stay unchanged; always present on the wire ("" = none).
   */
  when: z.string().nullable().optional(),
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
  listOfferAccepted: z.enum(["staples", "stock-offer", "week-plan"]).nullable(),
  /**
   * "What can I make?" → "ideas". A change to the open recipe ("no oven", "make it spicier") →
   * "recipe_change" with `meal`. Code turns it into a follow-up after apply. "What staples do I
   * need?" / "restock" → "staples": code answers from the saved staples when there are any (0054
   * SS6). "What are we eating this week?" → "week_plan"; "add what we need for this week's meals"
   * → "week_needs" (0045 KOS1, KOS12): code answers or adds, from the plan. Otherwise null.
   */
  generate: z
    .object({ what: z.enum(["ideas", "recipe_change", "staples", "week_plan", "week_needs"]), meal: z.string().nullable() })
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
 * No unions at all: no `anyOf`, no type arrays, no nullable fields. The API compiles the schema
 * into a grammar, and each union multiplies its size (the docs call their cost exponential).
 * 2026-10-14 we passed the explicit limit (16 parameters with union types). 2026-10-19 the
 * Kitchen OS fields (stock levels, staples, the dated week) pushed the compiled grammar past the
 * API's internal size limit with 9 unions left ("The compiled grammar is too large"), and every
 * chat message failed. So every fact is always present, and "empty" is a sentinel, not null:
 *  - text facts (name, store): value ""
 *  - quantities (quantity, amountUsed): asSaid ""; in a used quantity, amount 0 = not obvious
 *    and unit "" = none
 *  - enum facts (location, frozen, stock, category): value "none"; frozen is "true" / "false"
 *  - text labels and notes (item, meal, when, generate.meal, dish.notes): ""
 *  - batch "unspecified", listOfferAccepted "none", generate.what "none"
 *  - clarification / rememberPreference / dish: always present; an empty question, statement or
 *    title means "none"
 * An empty fact's basis and confidence are placeholders and ignored. `fromWire` maps it back to
 * `ModelOutput`, so everything after it (to-proposal.ts, meal-ops.ts, the fake interpreter) is
 * unchanged. tests/unit/ai-schema-limits.test.ts keeps unions at 0 and caps the schema's size.
 * ---------------------------------------------------------------------------------------------
 */

const WireText = z.object({ value: z.string(), ...meta });
const WireQuantity = z.object({
  /** "" when there is no quantity. */
  asSaid: z.string(),
  /** 0 when it isn't obvious. */
  amount: z.number(),
  /** "" when there is no unit. */
  unit: z.string(),
  ...meta,
});
const wireEnumFact = <const T extends string>(values: readonly T[]) =>
  z.object({ value: z.enum(["none", ...values] as ["none", ...T[]]), ...meta });

export const WireOp = z.object({
  action: ModelAction,
  evidence: z.string(),
  /** "" when nothing matches. */
  item: z.string(),
  name: WireText,
  quantity: WireQuantity,
  location: wireEnumFact(Location.options),
  /** "true" / "false" as text: a boolean can't also carry "none" without a union. */
  frozen: wireEnumFact(["true", "false"]),
  stock: wireEnumFact(StockLevel.options),
  amountUsed: WireQuantity,
  /** "unspecified" when the user didn't name a batch. */
  batch: z.enum([...BatchWhich.options, "unspecified"]),
  store: WireText,
  /** "" for every non-meal action. */
  meal: z.string(),
  /** CAT1. */
  category: wireEnumFact(ItemCategory.options),
  /** KOS1: the day as said, "" when none. */
  when: z.string(),
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
  listOfferAccepted: z.enum(["staples", "stock-offer", "week-plan", "none"]),
  /** what "none" (meal "") unless routing to ideas, a recipe change, staples or the week. */
  generate: z.object({ what: z.enum(["ideas", "recipe_change", "staples", "week_plan", "week_needs", "none"]), meal: z.string() }),
  /** title "" unless the user named a dish themselves (MI1). notes "" when none. */
  dish: z.object({ title: z.string(), notes: z.string(), evidence: z.string() }),
});
export type WireOutput = z.infer<typeof WireOutput>;

/** Empty-fact placeholders: an empty fact's basis and confidence are ignored. */
const EMPTY_META = { basis: "inferred", confidence: "low" } as const;
/** The category sentinel: "none". */
export const NO_CATEGORY = { value: "none", ...EMPTY_META } as const;
const EMPTY_TEXT = { value: "", ...EMPTY_META } as const;
const EMPTY_QUANTITY = { asSaid: "", amount: 0, unit: "", ...EMPTY_META } as const;
const EMPTY_ENUM = { value: "none", ...EMPTY_META } as const;

type Meta = { basis: Basis; confidence: Confidence };
const orNull = (s: string): string | null => (s === "" ? null : s);
const orEmpty = (s: string | null): string => s ?? "";
const metaOf = (f: Meta): Meta => ({ basis: f.basis, confidence: f.confidence });

function textFromWire(f: z.infer<typeof WireText>): ModelOp["name"] {
  return f.value.trim() === "" ? null : { value: f.value, ...metaOf(f) };
}

function quantityFromWire(q: z.infer<typeof WireQuantity>): ModelOp["quantity"] {
  if (q.asSaid.trim() === "") return null;
  return { asSaid: q.asSaid, amount: q.amount === 0 ? null : q.amount, unit: orNull(q.unit), ...metaOf(q) };
}

function quantityToWire(q: ModelOp["quantity"]): z.infer<typeof WireQuantity> {
  return q ? { asSaid: q.asSaid, amount: q.amount ?? 0, unit: orEmpty(q.unit), ...metaOf(q) } : EMPTY_QUANTITY;
}

function enumFromWire<T extends string>(f: { value: T | "none" } & Meta): ({ value: Exclude<T, "none"> } & Meta) | null {
  return f.value === "none" ? null : { value: f.value as Exclude<T, "none">, ...metaOf(f) };
}

/** Wire → the internal shape (sentinels back to null). */
export function fromWire(w: WireOutput): ModelOutput {
  return {
    kind: w.kind,
    reply: w.reply,
    operations: w.operations.map((op) => {
      const category = enumFromWire(op.category);
      const frozen = enumFromWire(op.frozen);
      return {
        action: op.action,
        evidence: op.evidence,
        item: orNull(op.item),
        name: textFromWire(op.name),
        quantity: quantityFromWire(op.quantity),
        location: enumFromWire(op.location),
        frozen: frozen && { ...frozen, value: frozen.value === "true" },
        stock: enumFromWire(op.stock),
        amountUsed: quantityFromWire(op.amountUsed),
        batch: op.batch === "unspecified" ? null : op.batch,
        store: textFromWire(op.store),
        meal: orNull(op.meal),
        ...(category ? { category } : {}),
        ...(op.when.trim() ? { when: op.when } : {}),
      };
    }),
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
      name: op.name ?? EMPTY_TEXT,
      quantity: quantityToWire(op.quantity),
      location: op.location ?? EMPTY_ENUM,
      frozen: op.frozen ? { ...metaOf(op.frozen), value: op.frozen.value ? "true" : "false" } : EMPTY_ENUM,
      stock: op.stock ?? EMPTY_ENUM,
      amountUsed: quantityToWire(op.amountUsed),
      batch: op.batch ?? "unspecified",
      store: op.store ?? EMPTY_TEXT,
      meal: orEmpty(op.meal),
      category: op.category ?? NO_CATEGORY,
      when: op.when ?? "",
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
