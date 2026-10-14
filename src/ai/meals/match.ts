/**
 * Matching a recipe or idea ingredient to a kitchen item by name, the same way the backend
 * matches name targets (exact standard name, then all the words): one match or none.
 * "fish sauce" matches "nước mắm (fish sauce)"; "chicken" with two chicken items matches neither.
 */
import type { ItemRow, KitchenState } from "@/contracts/kitchen-state";
import { nameTokens, standardName } from "@/shared/text";

export function matchKitchenItem(state: KitchenState, name: string): ItemRow | undefined {
  const std = standardName(name);
  if (!std) return undefined;
  const exact = state.items.filter((i) => i.standardName === std || standardName(i.name.value) === std);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;
  const tokens = nameTokens(name);
  if (tokens.length === 0) return undefined;
  const hits = state.items.filter((i) => {
    const words = new Set(nameTokens(i.name.value));
    return tokens.every((t) => words.has(t));
  });
  return hits.length === 1 ? hits[0] : undefined;
}
