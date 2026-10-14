/**
 * The shape the model must answer in (structured outputs, ai.md §1). Deliberately flatter than
 * the contract: every key is present (null = unknown), items are referenced by short labels
 * (`i3`), and code turns this into a `ProposedChange` (to-proposal.ts). No length or number
 * limits here: structured outputs don't support them, and the contract checks them afterwards.
 */
import { z } from "zod";
import { Basis, Confidence, Location, StockLevel } from "@/contracts/common";

const meta = { basis: Basis, confidence: Confidence };

const TextFact = z.object({ value: z.string(), ...meta });
const QuantityFact = z.object({
  asSaid: z.string(),
  amount: z.number().nullable(),
  unit: z.string().nullable(),
  ...meta,
});

/**
 * Kitchen actions (add/update/use/remove) and shopping-list actions (list_*, 0027). A list action
 * never touches the kitchen; "I bought X" is a kitchen add (the backend takes it off the list, SL5).
 */
export const ModelAction = z.enum([
  "add",
  "update",
  "use",
  "remove",
  "list_add",
  "list_update",
  "list_tick",
  "list_untick",
  "list_remove",
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
  /** list_add / list_update: the store to buy it at, as said (SL1). */
  store: TextFact.nullable(),
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
});
export type ModelOutput = z.infer<typeof ModelOutput>;

/**
 * The JSON schema sent as `output_config.format`. Built with Zod's own converter rather than the
 * SDK's `betaZodOutputFormat`, which (SDK 0.133.0) moves `enum` into the description, so enum
 * values would not be enforced. We still validate the answer with `ModelOutput` afterwards.
 */
export function modelOutputFormat(): { type: "json_schema"; schema: Record<string, unknown> } {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(ModelOutput, { io: "output" }) as Record<string, unknown>;
  void _ignored;
  return { type: "json_schema", schema };
}
