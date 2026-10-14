/**
 * Code guards for meal ideas (ai.md §5, §6): the model's ideas become cards only through here.
 * - Uses: only labels that exist; anything "missing" that the kitchen has moves to Uses.
 * - Basics: only the 0019 list counts; a basic is never "missing".
 * - Allergens: flagged by code; unprompted allergen ideas are left out (allergen-guard.ts).
 */
import { standardName } from "@/shared/text";
import { checkIdea } from "./allergen-guard";
import { isBasic } from "./basics";
import { matchKitchenItem } from "./match";
import type { IdeaOut } from "./model-output";
import type { GeneratedIdea, MealContext } from "./types";

export interface IdeaGuardContext {
  ctx: MealContext;
  labels: Map<string, string>;
  /** Item IDs that need using up (0025). */
  useItUp: Set<string>;
  /** The subset whose allergen may still appear, flagged (0025). Defaults to `useItUp`. */
  allergenExcused?: Set<string>;
  /** Allergies the user's typed request asked for. */
  asked: Set<string>;
}

export type IdeaVerdict = { idea: GeneratedIdea; keep: boolean } | null;

export function toIdea(out: IdeaOut, g: IdeaGuardContext): IdeaVerdict {
  const name = out.name.trim();
  if (!name) return null;
  const items = new Map(g.ctx.state.items.map((i) => [i.id, i]));

  const uses: string[] = [];
  const addUse = (id: string | undefined) => {
    if (id && items.has(id) && !uses.includes(id)) uses.push(id);
  };
  out.uses.forEach((label) => addUse(g.labels.get(label.trim())));

  const basics: string[] = [];
  const addBasic = (n: string) => {
    if (!basics.some((b) => standardName(b) === standardName(n))) basics.push(n.trim());
  };
  out.basics.filter((b) => b.trim() && isBasic(b)).forEach(addBasic);

  const missing: string[] = [];
  for (const raw of out.missing) {
    const n = raw.trim();
    if (!n) continue;
    if (isBasic(n)) {
      addBasic(n);
      continue;
    }
    const hit = matchKitchenItem(g.ctx.state, n);
    if (hit) addUse(hit.id);
    else if (!missing.some((m) => standardName(m) === standardName(n))) missing.push(n);
  }
  // A "basic" the model listed that isn't on the 0019 list is something to buy.
  for (const b of out.basics) {
    const n = b.trim();
    if (n && !isBasic(n) && !matchKitchenItem(g.ctx.state, n) && !missing.some((m) => standardName(m) === standardName(n))) {
      missing.push(n);
    }
  }

  const useItUp = uses.filter((id) => g.useItUp.has(id));
  const excused = uses.filter((id) => (g.allergenExcused ?? g.useItUp).has(id));
  const nameOf = (id: string) => items.get(id)!.name.value;
  const check = checkIdea(
    { name, usedNames: uses.map(nameOf), useItUpNames: excused.map(nameOf), missing },
    g.ctx.restrictions,
    g.asked,
  );
  const why = out.why.trim().replace(/\s+/g, " ");
  return {
    idea: { name, why, uses, missing, basics, useItUp, allergenFlags: check.flags },
    keep: check.keep,
  };
}
