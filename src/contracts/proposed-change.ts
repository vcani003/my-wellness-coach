/**
 * ProposedChange: the only write path (backend-data.md §6). Chat and buttons both produce one;
 * the backend validates and applies it, then returns an ApplyResult.
 */
import { z } from "zod";
import { Id, Msg } from "./common";
import { Operation } from "./operations";

/** A pasted part of the message, as UTF-16 offsets [start, end). */
export const PastedRange = z
  .object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })
  .refine((r) => r.end >= r.start, { message: "end must be >= start" });
export type PastedRange = z.infer<typeof PastedRange>;

export const ProposalSource = z.discriminatedUnion("via", [
  z.object({
    via: z.literal("chat"),
    messageId: Id,
    pastedRanges: z.array(PastedRange).max(50).optional(),
  }),
  z.object({ via: z.literal("button"), action: z.string().min(1).max(100) }),
]);
export type ProposalSource = z.infer<typeof ProposalSource>;

export const ClarificationOption = z.object({
  label: z.string().min(1).max(200),
  reply: z.string().min(1).max(500),
});

/** Max 4 options; the UI adds "Something else". */
export const Clarification = z.object({
  question: z.string().min(1).max(500),
  options: z.array(ClarificationOption).max(4),
});
export type Clarification = z.infer<typeof Clarification>;

export const ProposedChange = z.object({
  /** Idempotency key: the client message or tap ID (+ a suffix per step). */
  proposalId: Id,
  kitchenId: Id,
  basedOnVersion: z.number().int().nonnegative(),
  source: ProposalSource,
  operations: z.array(Operation).max(50),
  clarification: Clarification.optional(),
  /** "Want me to remember that?" (0012) */
  offer: z.object({ kind: z.literal("preference"), statement: z.string().min(1).max(500) }).optional(),
  /** e.g. assumed basics (0010, 0019) */
  notes: z.array(Msg).max(20).optional(),
});
export type ProposedChange = z.infer<typeof ProposedChange>;
/** What callers may pass in before defaults/normalisation (identical today). */
export type ProposedChangeInput = z.input<typeof ProposedChange>;
