/**
 * Shared-kitchen cues (ux.md §6), the pure part: which of the other members' change sets to
 * mention in "Since your last visit" and in the live removal cue, and where this device keeps
 * the last version it showed. Framework-free so it can be unit-tested; `useSharedCues` wires it.
 *
 * - Only other members' change sets (a former or unknown member counts as another member).
 * - Undone change sets are left out, and so is the Undo itself (its summary is `UNDONE`).
 * - Quiet summaries that change nothing you'd notice (a kept batch, an unticked list item, a
 *   To review card) are left out; a change set with nothing left is left out.
 */
import { ChangeSetSummary } from "@/contracts/apply-result";
import type { ActorRef, Msg } from "@/contracts/common";
import { z } from "zod";

/** One thing someone else did: "Levi" + "used up the eggs". */
export interface CueEntry {
  changeSetId: string;
  version: number;
  actor: ActorRef;
  summary: Msg;
}

/** Summary codes that aren't worth a line of their own. */
const QUIET_CODES = new Set([
  "UNDONE",
  "ITEM_BATCH_KEPT",
  "SHOPPING_UNTICKED",
  "SHOPPING_ALREADY",
  "REVIEW_QUEUED",
  "REVIEW_RESOLVED",
  "SHOPPING_REVIEW_QUEUED",
  "MEAL_NOTE_SAVED",
  "NO_CHANGE",
]);

/** An item that left the Kitchen list (0011): the live cue says who did it. */
export const REMOVAL_CODES = new Set(["ITEM_OUT", "ITEM_REMOVED"]);

function isOther(actor: ActorRef, meId: string): boolean {
  return "missing" in actor || actor.id !== meId;
}

/** The other members' changes after `since` (and up to `through`, if given), oldest first. */
export function othersChanges(
  changes: readonly ChangeSetSummary[],
  meId: string,
  opts: { since?: number; through?: number; only?: ReadonlySet<string> } = {},
): CueEntry[] {
  const out: CueEntry[] = [];
  for (const cs of changes) {
    if (cs.undone || cs.via === "system" || !isOther(cs.actor, meId)) continue;
    if (opts.since !== undefined && cs.version <= opts.since) continue;
    if (opts.through !== undefined && cs.version > opts.through) continue;
    if (cs.summaries.some((s) => s.code === "UNDONE")) continue; // an Undo: what it undid is already left out
    for (const summary of cs.summaries) {
      if (QUIET_CODES.has(summary.code)) continue;
      if (opts.only && !opts.only.has(summary.code)) continue;
      out.push({ changeSetId: cs.changeSetId, version: cs.version, actor: cs.actor, summary });
    }
  }
  return out;
}

const ChangesBody = z.object({ changes: z.array(z.unknown()) });

/**
 * Parses `/changes`'s body defensively (0018): a malformed change set is dropped, not fatal.
 * Returns null if the body itself is unusable.
 */
export function parseChanges(raw: unknown): ChangeSetSummary[] | null {
  const body = ChangesBody.safeParse(raw);
  if (!body.success) return null;
  const out: ChangeSetSummary[] = [];
  for (const row of body.data.changes) {
    const parsed = ChangeSetSummary.safeParse(row);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

// ─── This device's last-seen version (localStorage, best effort: 0018) ────────────────────

const KEY_PREFIX = "kitchen.lastSeen";
const keyFor = (kitchenId: string, meId: string) => `${KEY_PREFIX}.${kitchenId}.${meId}`;

/** The last version this device showed you, or null (first visit, or storage blocked). */
export function readLastSeen(kitchenId: string, meId: string, storage?: Storage): number | null {
  try {
    const raw = (storage ?? window.localStorage).getItem(keyFor(kitchenId, meId));
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeLastSeen(kitchenId: string, meId: string, version: number, storage?: Storage): void {
  try {
    (storage ?? window.localStorage).setItem(keyFor(kitchenId, meId), String(version));
  } catch {
    // Private mode or blocked storage: "Since your last visit" just doesn't appear next time.
  }
}

/**
 * Which version to ask `/changes` about, or null for "nothing to say": no stored version (first
 * visit on this device, or no storage), or one at or past the current version (nothing new, or
 * the kitchen was reset).
 */
export function sinceBaseline(lastSeen: number | null, current: number): number | null {
  if (lastSeen === null || lastSeen >= current) return null;
  return lastSeen;
}
