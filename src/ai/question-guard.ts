/**
 * A question never removes anything (0059 PF2, ai.md "Build notes: recipe amounts and questions").
 *
 * The model is told that "how much eggs do I need?" or "no measurements for the eggs?" is a
 * question about the recipe, not a kitchen change. This is the code backstop, for the real and the
 * stand-in interpreter alike: a removal whose own words were asked, not told, is dropped before
 * anything is applied.
 *
 * Kept narrow on purpose:
 * - Only removals: `item.remove`, `item.use`, `item.batch.close`, `item.stock.set` to Out,
 *   `shopping.remove` and `staple.remove`. Adds, moves, meal steps and recipe changes are untouched.
 * - Judged per operation, from its evidence (the user's own words for it, always part of the
 *   message). Its clause is the text from the last , ; . ! ? or line break before the evidence:
 *   - a clause that opens with a question word ("how much…", "what are…", "should I…", "is the…")
 *     is a question;
 *   - otherwise it's a question only when the evidence's clause ends at a "?" ("no measurements
 *     for the eggs?", "should I throw out the milk?"). "I used the rest of the spinach, what can I
 *     make?" keeps its use: the "?" belongs to the next clause.
 * - A polite request is not a question: a clause opening "can/could/would/will you" or "please"
 *   ("Can you throw out the milk?") is still done.
 * - No evidence, or evidence not found in the message: judged on the whole message.
 */
import type { Operation } from "@/contracts/operations";
import type { InterpretResult } from "./interpreter";

const QUESTION_START =
  /^(?:how|what|what's|whats|which|when|where|why|who|whose|is|are|was|were|does|do|did|should|shall|may|can\s+i|could\s+i|can\s+we|could\s+we|is\s+there|are\s+there)\b/i;
const POLITE = /^(?:please\b|(?:can|could|would|will)\s+(?:you|u)\b)/i;
const CLAUSE_END = /[,;.!?\n]/;

export function isRemoval(op: Operation): boolean {
  switch (op.type) {
    case "item.remove":
    case "item.use":
    case "item.batch.close":
    case "shopping.remove":
    case "staple.remove":
      return true;
    case "item.stock.set":
      return op.fields.stock.value === "out";
    default:
      return false;
  }
}

/** Is the span [start, end) of `text` asked rather than told? */
function spanIsQuestion(text: string, start: number, end: number): boolean {
  let clauseStart = 0;
  for (let i = start - 1; i >= 0; i--) {
    if (CLAUSE_END.test(text[i])) {
      clauseStart = i + 1;
      break;
    }
  }
  const head = text.slice(clauseStart).trimStart();
  if (POLITE.test(head)) return false;
  if (QUESTION_START.test(head)) return true;
  const after = /[,;.!?\n]/.exec(text.slice(end));
  return after?.[0] === "?";
}

/** The words of one operation, asked rather than told (see the file comment). */
export function askedNotTold(text: string, evidence: string | undefined): boolean {
  const words = (evidence ?? "").trim().replace(/[\s.!?]+$/, "");
  const at = words ? text.toLowerCase().indexOf(words.toLowerCase()) : -1;
  if (at < 0) {
    const whole = text.trim().replace(/[\s.!]+$/, "");
    return spanIsQuestion(whole, 0, whole.replace(/\?+$/, "").length);
  }
  return spanIsQuestion(text, at, at + words.length);
}

/** Whether the message as a whole reads as a question (used where there's no evidence to go on). */
export function isQuestion(text: string): boolean {
  return askedNotTold(text, undefined);
}

export const QUESTION_KEPT_REPLY = "I didn't change anything, since that sounded like a question. Tell me if you meant it as a change.";

/**
 * Drop removals that were asked, not told. Returns the result unchanged when nothing is dropped.
 * When something is: `dropped` lists it, and the draft reply (written with the removal in mind) is
 * replaced: by nothing when other steps still answer (a recipe follow-up), else by a plain line.
 * When other operations still apply, the turn builds the reply from the receipt instead.
 */
export function guardQuestionRemovals(result: InterpretResult, text: string): { result: InterpretResult; dropped: Operation[] } {
  const ops = result.proposal?.operations ?? [];
  const dropped = ops.filter((op) => isRemoval(op) && askedNotTold(text, op.evidence));
  if (dropped.length === 0 || !result.proposal) return { result, dropped: [] };
  const kept = ops.filter((op) => !dropped.includes(op));
  const followUps = result.followUps ?? [];
  const reply = kept.length > 0 || followUps.length > 0 ? "" : QUESTION_KEPT_REPLY;
  const proposal = kept.length > 0 || result.proposal.clarification ? { ...result.proposal, operations: kept } : null;
  return {
    result: { ...result, kind: proposal ? result.kind : "answer", proposal, reply },
    dropped,
  };
}
