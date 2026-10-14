/**
 * Assumed basics (0019, AI3): salt, pepper, cooking oil, water, and dried herbs and spices.
 * Everything else is "Need" unless it's in the kitchen. Code decides what counts, so the model
 * can't quietly assume sugar, butter or soy sauce. One list, easy to extend.
 */
import { standardName } from "@/shared/text";

const EXACT = new Set(
  [
    "salt",
    "kosher salt",
    "sea salt",
    "pepper",
    "black pepper",
    "white pepper",
    "ground pepper",
    "ground black pepper",
    "salt and pepper",
    "oil",
    "cooking oil",
    "vegetable oil",
    "neutral oil",
    "canola oil",
    "sunflower oil",
    "olive oil",
    "water",
    "warm water",
    "cold water",
    "boiling water",
    // dried spices and herbs commonly named without "dried" / "ground"
    "cumin",
    "paprika",
    "smoked paprika",
    "cinnamon",
    "turmeric",
    "chili powder",
    "chili flakes",
    "red pepper flakes",
    "curry powder",
    "garlic powder",
    "onion powder",
    "oregano",
    "thyme",
    "bay leaf",
    "star anise",
    "clove",
    "nutmeg",
    "coriander seed",
    "fennel seed",
    "five spice",
    "five spice powder",
    "chinese five spice",
    "italian seasoning",
    "cardamom",
    "allspice",
    "cayenne",
    "cayenne pepper",
  ].map(standardName),
);

/** "dried basil", "ground ginger": dried herbs and spices are basics. Fresh ones are not. */
const DRIED = /^(dried|ground) /;

export function isBasic(name: string): boolean {
  const std = standardName(name.replace(/\(.*?\)/g, " "));
  if (!std) return false;
  return EXACT.has(std) || DRIED.test(std);
}

/** The basics a set of ingredient names relies on, deduplicated, in order. */
export function basicsIn(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const key = standardName(n);
    if (isBasic(n) && !seen.has(key)) {
      seen.add(key);
      out.push(n.trim());
    }
  }
  return out;
}

/** The reminder shown whenever a meal relies on a basic (0010, 0019). Code BASICS_ASSUMED. */
export function basicsNote(basics: string[]) {
  if (basics.length === 0) return null;
  const list = new Intl.ListFormat("en", { type: "conjunction" }).format(basics.map((b) => b.toLowerCase()));
  return {
    code: "BASICS_ASSUMED",
    params: { basics: list },
    text: `Assumes ${list}. Tell me if you don't have them.`,
  };
}
