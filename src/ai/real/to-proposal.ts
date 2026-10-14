/**
 * Code guards (ai.md §6): the model's output becomes a `ProposedChange` only through here.
 * - Labels become real item IDs; unknown labels fall back to the name or are dropped.
 * - Low-confidence and "assumed" facts are dropped (unknown stays unknown, 0010/0011).
 * - Evidence that isn't in the user's words downgrades "said" to "inferred".
 * - A preference is saved only on a "yes" right after Kitchen offered to remember (0012).
 * - The result must pass the contract's Zod schema, or nothing is proposed.
 */
import type { Fact } from "@/contracts/common";
import type { Operation } from "@/contracts/operations";
import { ProposedChange } from "@/contracts/proposed-change";
import type { InterpretRequest, InterpretResult } from "../interpreter";
import type { ModelOp, ModelOutput } from "./model-output";
import { itemLabels } from "./prompt";

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

function toOperation(op: ModelOp, opId: string, req: InterpretRequest, labels: Map<string, string>): Operation | null {
  const evidenceOk = inMessage(req.message.text, op.evidence);
  const evidence = op.evidence.trim() || undefined;
  const itemId = op.item ? labels.get(op.item.trim()) : undefined;
  const name = op.name?.value.trim() ? keep(op.name, (f) => f.value.trim(), evidenceOk) : undefined;
  const target = itemId ? { itemId } : name ? { name: name.value } : null;

  const quantity = keep(op.quantity, quantityOf, evidenceOk);
  const location = keep(op.location, (f) => f.value, evidenceOk);
  const frozen = keep(op.frozen, (f) => f.value, evidenceOk);
  const common = { opId, ...(evidence ? { evidence } : {}) };

  switch (op.action) {
    case "add": {
      // Restocking a listed item: reuse its exact name so the backend matches it (0025).
      const listed = itemId ? req.state.items.find((i) => i.id === itemId) : undefined;
      const addName = listed ? { ...(name ?? { basis: "said", confidence: "high" }), value: listed.name.value } : name;
      if (!addName) return null;
      return {
        ...common,
        type: "item.add",
        fields: { name: addName as Fact<string>, quantity, location, frozen },
      };
    }
    case "update": {
      if (!target) return null;
      const fields = { ...(quantity && { quantity }), ...(location && { location }), ...(frozen && { frozen }) };
      if (Object.keys(fields).length === 0) return null;
      return { ...common, type: "item.update", target, fields };
    }
    case "use": {
      if (!target) return null;
      const stock = keep(op.stock, (f) => f.value, evidenceOk);
      const amountUsed = keep(op.amountUsed, quantityOf, evidenceOk);
      return { ...common, type: "item.use", target, fields: { stock, amountUsed } };
    }
    case "remove":
      if (!target) return null;
      return { ...common, type: "item.remove", target };
  }
}

/** Kitchen offered to remember something in its last turn (0012: never save without a yes). */
function offeredToRemember(req: InterpretRequest): boolean {
  const last = [...req.history].reverse().find((t) => t.role === "assistant");
  return !!last && /\bremember\b/i.test(last.text);
}

export type ProposalOutcome = { ok: true; result: InterpretResult } | { ok: false; reason: string };

export function toInterpretResult(out: ModelOutput, req: InterpretRequest): ProposalOutcome {
  const reply = out.reply.trim();
  if (!reply) return { ok: false, reason: "empty reply" };

  const base = {
    proposalId: `${req.message.id}:chat`,
    kitchenId: req.kitchenId,
    basedOnVersion: req.version,
    source: { via: "chat" as const, messageId: req.message.id },
  };

  if (out.kind === "answer") return { ok: true, result: { kind: "answer", proposal: null, reply } };

  if (out.kind === "clarify") {
    const c = out.clarification;
    const question = c?.question.trim() || reply;
    const options = (c?.options ?? [])
      .filter((o) => o.label.trim() && o.reply.trim())
      .slice(0, 4)
      .map((o) => ({ label: o.label.trim(), reply: o.reply.trim() }));
    const parsed = ProposedChange.safeParse({ ...base, operations: [], clarification: { question, options } });
    if (!parsed.success) return { ok: false, reason: `clarification failed the contract: ${parsed.error.message}` };
    return { ok: true, result: { kind: "clarify", proposal: parsed.data, reply } };
  }

  const labels = itemLabels(req.state);
  const operations: Operation[] = [];
  out.operations.forEach((op, i) => {
    const converted = toOperation(op, `${req.message.id}:op${i + 1}`, req, labels);
    if (converted) operations.push(converted);
  });

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

  if (operations.length === 0) return { ok: true, result: { kind: "answer", proposal: null, reply: NOTHING_TO_CHANGE_REPLY } };

  const parsed = ProposedChange.safeParse({ ...base, operations: operations.slice(0, 50) });
  if (!parsed.success) return { ok: false, reason: `proposal failed the contract: ${parsed.error.message}` };
  return { ok: true, result: { kind: "change", proposal: parsed.data, reply } };
}
