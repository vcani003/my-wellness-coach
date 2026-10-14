/**
 * "Use it up" ranking (0025, AI8), computed by code from data we already have: Low, defrosted,
 * leftovers, and days since added in the fridge. No shelf-life prediction (spec §10), and never
 * "safe to eat". The thresholds are engineering defaults, easy to change here:
 * - Low (running low): counts, as 0025 says.
 * - Defrosted: `frozen: false` and in the fridge. (A "defrosted on" date isn't in the contract
 *   yet, so the age is days since added.)
 * - Leftovers: 1+ day old.
 * - Anything else in the fridge: 4+ days since added.
 * Pantry and freezer items never need using up by age alone.
 * Batches (K3) aren't in KitchenState yet; when they are, the oldest batch's age replaces addedAt.
 */
import type { ItemRow, KitchenState } from "@/contracts/kitchen-state";
import { standardName } from "@/shared/text";

const DAY_MS = 86_400_000;
export const FRIDGE_DAYS = 4;
export const LEFTOVER_DAYS = 1;

/**
 * Whether "Low" alone makes an allergen item count as needing using up (0025 lists Low as a
 * use-it-up signal, so: yes). One switch, pending Vero's answer on the follow-up question.
 */
export const LOW_EXCUSES_ALLERGEN = true;

export interface UseItUp {
  itemId: string;
  name: string;
  score: number;
  /** True when a reason other than Low applies (defrosted, leftovers, old in the fridge). */
  perishable: boolean;
  /** Why it needs using up, for the model's "why" line: "defrosted 2 days ago". */
  reasons: string[];
}

export function daysSince(iso: string, now: Date): number {
  const d = Math.floor((now.getTime() - Date.parse(iso)) / DAY_MS);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

const ago = (days: number) => (days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`);

function isLeftover(item: ItemRow): boolean {
  return /\bleftover\b/.test(standardName(item.name.value));
}

export function useItUpReasons(item: ItemRow, now: Date): { score: number; reasons: string[]; perishable: boolean } {
  const days = daysSince(item.addedAt, now);
  const inFridge = item.location?.value === "fridge";
  const reasons: string[] = [];
  let score = 0;
  if (item.frozen?.value === false && inFridge) {
    score += 3;
    reasons.push(`defrosted, added ${ago(days)}`);
  }
  if (isLeftover(item) && days >= LEFTOVER_DAYS) {
    score += 2 + Math.min(days, 5);
    reasons.push(`leftovers from ${ago(days)}`);
  } else if (inFridge && days >= FRIDGE_DAYS && !reasons.length) {
    score += 1 + Math.min(Math.floor((days - FRIDGE_DAYS) / 2), 4);
    reasons.push(`in the fridge for ${days} days`);
  }
  const perishable = reasons.length > 0;
  if (item.stock?.value === "low") {
    score += 2;
    reasons.push("running low");
  }
  return { score, reasons, perishable };
}

/** Items that need using up, most urgent first (ties: oldest first). */
export function rankUseItUp(state: KitchenState, now: Date): UseItUp[] {
  return state.items
    .map((item) => ({ item, ...useItUpReasons(item, now) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || Date.parse(a.item.addedAt) - Date.parse(b.item.addedAt))
    .map(({ item, score, reasons, perishable }) => ({ itemId: item.id, name: item.name.value, score, reasons, perishable }));
}

/** Items whose allergen may still appear in an unprompted idea, flagged (0025). */
export function allergenExcusedIds(ranked: UseItUp[]): Set<string> {
  return new Set(ranked.filter((u) => u.perishable || LOW_EXCUSES_ALLERGEN).map((u) => u.itemId));
}
