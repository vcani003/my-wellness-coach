/**
 * Receipt lines (ux.md §10): a pasted list gives one "added" line per item, so runs of 2+ adds to
 * the same store are shown as one line: "On your list, MD Oriental Market: garlic, ginger, …".
 * Everything else is one line per saved change, as before.
 */
import type { AppliedOp } from "@/contracts/apply-result";
import type { Msg } from "@/contracts/common";

export interface ReceiptLine {
  key: string;
  summary: Msg;
}

/** A UI-only code for a grouped line (not a backend message). */
export const SHOPPING_GROUP = "UI_SHOPPING_LIST_GROUP";

const ADD_CODES = new Set(["SHOPPING_ADDED", "SHOPPING_ADDED_STORE"]);
const storeOf = (m: Msg) => (m.code === "SHOPPING_ADDED_STORE" ? String(m.params.store ?? "") : "");

export function receiptLines(applied: readonly AppliedOp[], anywhere: string): ReceiptLine[] {
  const lines: ReceiptLine[] = [];
  let run: AppliedOp[] = [];
  const flush = () => {
    if (run.length >= 2) {
      const store = storeOf(run[0].summary) || anywhere;
      const names = run.map((a) => String(a.summary.params.name ?? "")).join(", ");
      lines.push({
        key: run.map((a) => a.opId).join("+"),
        summary: { code: SHOPPING_GROUP, params: { store, names }, text: `On your list, ${store}: ${names}` },
      });
    } else {
      for (const a of run) lines.push({ key: a.opId, summary: a.summary });
    }
    run = [];
  };
  for (const a of applied) {
    const groupable = ADD_CODES.has(a.summary.code) && a.refs.length > 0;
    if (groupable && run.length && storeOf(run[0].summary).toLowerCase() === storeOf(a.summary).toLowerCase()) {
      run.push(a);
      continue;
    }
    flush();
    if (groupable) run.push(a);
    else lines.push({ key: a.opId, summary: a.summary });
  }
  flush();
  return lines;
}
