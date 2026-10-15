/**
 * "New" / "Updated" marks (ux.md §1): after YOUR message, the rows your change added say "New" and
 * the rows it changed say "Updated", until your next message. Removed rows are gone, so they get
 * no mark. The other person's changes never use these marks (they get the soft "Levi · just now"
 * highlight instead, from `useKitchenSync`). Pure, so it's unit-tested (tests/ui/places-model.test.ts).
 */
import type { ApplyResult } from "@/contracts/apply-result";
import type { ChangeMark } from "@/ui/sync/KitchenDataContext";

const MARKED_KINDS = new Set(["item", "shopping", "meal"]);

export function marksFrom(result: Pick<ApplyResult, "applied">): Record<string, ChangeMark> {
  const marks: Record<string, ChangeMark> = {};
  for (const op of result.applied) {
    for (const ref of op.refs) {
      if (!MARKED_KINDS.has(ref.kind) || ref.change === "removed") continue;
      if (marks[ref.id] !== "new") marks[ref.id] = ref.change === "added" ? "new" : "updated";
    }
  }
  return marks;
}
