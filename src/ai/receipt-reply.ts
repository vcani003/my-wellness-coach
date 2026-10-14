/**
 * A reply built from the ApplyResult receipt, used when some operations were rejected and the
 * interpreter has no `reword` (orchestrator spec). Plain and factual: it never claims more than
 * what saved (interpret → apply → reply, backend-data.md §6).
 */
import type { ApplyResult } from "@/contracts/apply-result";

export function replyFromReceipt(result: ApplyResult): string {
  const done = result.applied.filter((a) => a.refs.length > 0).map((a) => a.summary.text);
  const reasons = result.rejected.map((r) => r.reason.text);
  if (done.length === 0 && reasons.length === 0) return "Okay, nothing needed changing.";
  if (done.length === 0) return `I couldn't change anything: ${reasons.join("; ")}.`;
  const saved = `Done: ${done.join("; ")}.`;
  return reasons.length ? `${saved} I couldn't do everything, though: ${reasons.join("; ")}.` : saved;
}
