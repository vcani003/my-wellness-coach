/**
 * Smart staples on the List place (0054), the pure parts of the Restock sheet:
 * - the three groups (SS3): **Need** (Out, Running low, not in yet; pre-selected), **You have
 *   some** (Some, Plenty, or in with no level; unselected) and **On your list** (muted, no box);
 * - the status word each row shows.
 * `need` is computed by the backend on every read (`KitchenState.staples`); nothing here guesses.
 */
import { stapleNeedsBuying, type StapleRow } from "@/contracts/kitchen-state";

export interface StapleGroups {
  need: StapleRow[];
  have: StapleRow[];
  onList: StapleRow[];
}

export function groupStaples(staples: readonly StapleRow[]): StapleGroups {
  return {
    need: staples.filter((s) => stapleNeedsBuying(s.need)),
    have: staples.filter((s) => s.need === "have"),
    onList: staples.filter((s) => s.need === "on-list"),
  };
}

/** Restock's pre-selection (SS3): what needs buying. */
export function preselected(staples: readonly StapleRow[]): Set<string> {
  return new Set(staples.filter((s) => stapleNeedsBuying(s.need)).map((s) => s.id));
}

/** The chosen staples that can still be added: a staple that went on the list meanwhile is left out. */
export function chosenIds(staples: readonly StapleRow[], selected: ReadonlySet<string>): string[] {
  return staples.filter((s) => selected.has(s.id) && s.need !== "on-list").map((s) => s.id);
}

/** Message key (under `staples.status`) for a row's status word. */
export type StatusKey = "out" | "low" | "missing" | "some" | "plenty" | "have" | "onList";

export function statusKey(s: Pick<StapleRow, "need" | "level">): StatusKey {
  switch (s.need) {
    case "out":
    case "low":
    case "missing":
      return s.need;
    case "on-list":
      return "onList";
    case "have":
      return s.level === "plenty" || s.level === "some" ? s.level : "have";
  }
}
