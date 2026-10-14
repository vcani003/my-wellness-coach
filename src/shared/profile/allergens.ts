/**
 * AllergenFlag computation (backend-data.md §6, 0019): computed by code from current profiles on
 * every read, never stored. Every member's allergies count, whoever is asking.
 *
 * The word list is a small starting point. The AI specialist owns the full list (ai.md guards);
 * keep one list for both by replacing CATEGORY_TERMS, not by adding a second matcher.
 */
import type { AllergenFlag } from "@/contracts/common";
import { nameTokens, standardName } from "@/shared/text";
import type { Restriction } from "./state";

/** Category → ingredient words that belong to it. Keys and words are standard names. */
export const CATEGORY_TERMS: Record<string, string[]> = {
  seafood: ["fish", "shellfish", "shrimp", "prawn", "crab", "lobster", "crayfish", "scallop", "mussel", "clam", "oyster", "squid", "calamari", "octopus", "salmon", "tuna", "cod", "anchovy", "sardine"],
  shellfish: ["shrimp", "prawn", "crab", "lobster", "crayfish", "scallop", "mussel", "clam", "oyster"],
  fish: ["salmon", "tuna", "cod", "anchovy", "sardine", "trout", "halibut", "tilapia", "mackerel"],
  nut: ["almond", "walnut", "cashew", "pecan", "pistachio", "hazelnut", "macadamia", "brazil nut"],
  "tree nut": ["almond", "walnut", "cashew", "pecan", "pistachio", "hazelnut", "macadamia"],
  peanut: ["peanut", "peanut butter", "groundnut"],
  dairy: ["milk", "cheese", "butter", "cream", "yogurt", "yoghurt", "ghee", "parmesan", "mozzarella"],
  milk: ["milk", "cheese", "butter", "cream", "yogurt", "yoghurt"],
  egg: ["egg", "mayonnaise", "mayo"],
  gluten: ["wheat", "flour", "bread", "pasta", "barley", "rye", "couscous", "noodle"],
  wheat: ["wheat", "flour", "bread", "pasta", "couscous"],
  soy: ["soy", "soya", "tofu", "edamame", "miso", "tempeh"],
  sesame: ["sesame", "tahini"],
};

function containsPhrase(haystack: string[], phrase: string[]): boolean {
  if (phrase.length === 0) return false;
  for (let i = 0; i + phrase.length <= haystack.length; i++) {
    if (phrase.every((w, j) => haystack[i + j] === w)) return true;
  }
  return false;
}

/** The standard-name terms an allergy subject covers, e.g. "seafood" → seafood + shrimp, crab… */
export function allergyTerms(subject: string): string[] {
  const key = standardName(subject).replace(/ allergy$/, "");
  return [key, ...(CATEGORY_TERMS[key] ?? [])];
}

/**
 * Flags for each (ingredient, allergy) match. `ingredients` are names as written (recipe
 * ingredients, and the meal title so "Shrimp tacos" is flagged even before a recipe exists).
 */
export function computeAllergenFlags(ingredients: string[], restrictions: Restriction[]): AllergenFlag[] {
  const flags: AllergenFlag[] = [];
  const seen = new Set<string>();
  const allergies = restrictions.filter((r) => r.kind === "allergy");
  for (const ingredient of ingredients) {
    const tokens = nameTokens(ingredient);
    for (const r of allergies) {
      const hit = allergyTerms(r.subject.value).some((term) => containsPhrase(tokens, term.split(" ")));
      const key = `${ingredient}|${r.id}`;
      if (hit && !seen.has(key)) {
        seen.add(key);
        flags.push({
          ingredient,
          userId: r.userId,
          subject: r.subject.value,
          ...(r.note ? { note: r.note.value } : {}),
        });
      }
    }
  }
  return flags;
}
