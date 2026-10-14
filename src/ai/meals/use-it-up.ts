/**
 * "Use it up" ranking (0025, AI8), computed by code from data we already have. The facts come
 * from the backend's use-it-up signals (`computeUseItUpSignals`, the pure half of
 * `getUseItUpSignals`): the oldest batch's age, the "defrosted on" date, and Low. No shelf-life
 * prediction (spec §10), and never "safe to eat". The thresholds are engineering defaults, easy to
 * change here:
 * - Defrosted: a "defrosted on" date, and the item isn't wholly back in the freezer. Older items
 *   with no date (saved before batches) still count when `frozen: false` in the fridge.
 * - Leftovers: 1+ day old.
 * - Anything else in the fridge: its oldest batch is 4+ days old.
 * - Low (running low): nudges ideas, but doesn't let an allergen dish back in (AI9 Rec).
 * Pantry and freezer items never need using up by age alone.
 */
import type { ItemRow, KitchenState } from "@/contracts/kitchen-state";
import { computeUseItUpSignals, type UseItUpSignal } from "@/domains/kitchen/queries";
import { standardName } from "@/shared/text";

const DAY_MS = 86_400_000;
export const FRIDGE_DAYS = 4;
export const LEFTOVER_DAYS = 1;

/**
 * Whether "Low" alone makes an allergen item count as needing using up, so its dishes come back
 * into unprompted ideas, flagged. OPEN-QUESTIONS AI9, Rec "no": Low means running out, not going
 * off, so "fish sauce is low" must not bring seafood dishes back for Levi. One switch.
 */
export const LOW_EXCUSES_ALLERGEN = false;

export interface UseItUp {
  itemId: string;
  name: string;
  score: number;
  /** True when a reason other than Low applies (defrosted, leftovers, old in the fridge). */
  perishable: boolean;
  /** Why it needs using up, for the model's "why" line: "defrosted yesterday". */
  reasons: string[];
}

export function daysSince(iso: string, now: Date): number {
  const d = Math.floor((now.getTime() - Date.parse(iso)) / DAY_MS);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

const ago = (days: number) => (days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`);
const when = (days: number) => (days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`);

function isLeftover(item: ItemRow): boolean {
  return /\bleftover\b/.test(standardName(item.name.value));
}

/**
 * Frozen again as a whole (one batch, frozen), so a past thaw no longer counts. Location alone
 * says nothing: a defrost doesn't move the item out of the freezer unless the user says so.
 */
function whollyFrozen(item: ItemRow, signal: UseItUpSignal): boolean {
  return signal.batchCount <= 1 && item.frozen?.value === true;
}

export function useItUpReasons(
  item: ItemRow,
  now: Date,
  signal: UseItUpSignal = computeUseItUpSignals({ items: [item] }, now)[0],
): { score: number; reasons: string[]; perishable: boolean } {
  const days = signal.oldestDays;
  const inFridge = item.location?.value === "fridge";
  const batches = signal.batchCount > 1 ? `the oldest of ${signal.batchCount} batches, ` : "";
  const reasons: string[] = [];
  let score = 0;
  if (signal.defrostedDays !== undefined && !whollyFrozen(item, signal)) {
    score += 4 + Math.min(signal.defrostedDays, 4);
    reasons.push(`defrosted ${when(signal.defrostedDays)}`);
  } else if (signal.defrostedDays === undefined && item.frozen?.value === false && inFridge) {
    // Saved before "defrosted on" existed: the age is days since added.
    score += 3;
    reasons.push(`defrosted, added ${ago(days)}`);
  }
  if (isLeftover(item) && days >= LEFTOVER_DAYS) {
    score += 2 + Math.min(days, 5);
    reasons.push(`leftovers from ${ago(days)}`);
  } else if (inFridge && days >= FRIDGE_DAYS && !reasons.length) {
    score += 1 + Math.min(Math.floor((days - FRIDGE_DAYS) / 2), 4);
    reasons.push(`${batches}in the fridge for ${days} days`);
  }
  const perishable = reasons.length > 0;
  if (signal.low) {
    score += 2;
    reasons.push("running low");
  }
  return { score, reasons, perishable };
}

/** Items that need using up, most urgent first (ties: oldest batch first). */
export function rankUseItUp(state: Pick<KitchenState, "items">, now: Date): UseItUp[] {
  const rows = new Map(state.items.map((i) => [i.id, i]));
  return computeUseItUpSignals(state, now)
    .flatMap((signal) => {
      const item = rows.get(signal.itemId);
      return item ? [{ item, signal, ...useItUpReasons(item, now, signal) }] : [];
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.signal.oldestAddedAt.localeCompare(b.signal.oldestAddedAt))
    .map(({ item, score, reasons, perishable }) => ({ itemId: item.id, name: item.name.value, score, reasons, perishable }));
}

/**
 * Items whose allergen may still appear in an unprompted idea, flagged (0025): the ones that need
 * using up before they spoil. Low alone doesn't count unless the AI9 switch says so.
 */
export function allergenExcusedIds(ranked: UseItUp[], lowExcuses: boolean = LOW_EXCUSES_ALLERGEN): Set<string> {
  return new Set(ranked.filter((u) => u.perishable || lowExcuses).map((u) => u.itemId));
}
