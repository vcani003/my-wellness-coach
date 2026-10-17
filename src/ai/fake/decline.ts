/**
 * The stand-in AI's one line for anything only the real model can do (0059 PF10): questions,
 * recipes, meal ideas and recipe changes. Vero: "stand in ai shouldnt be able to answer. only the
 * real model can." Shared by the stand-in interpreter and the stand-in meal AI.
 */
export const STAND_IN_DECLINE_REPLY = "That needs the real AI (Claude). I'm only the stand-in.";

/** A sample recipe's title (PF10): "Sample recipe (stand-in)" or "Sample recipe (stand-in): Chicken curry". */
export const SAMPLE_RECIPE_TITLE = "Sample recipe (stand-in)";

export function sampleRecipeTitle(dish?: string): string {
  const d = dish?.trim().replace(/\s+/g, " ");
  return d ? `${SAMPLE_RECIPE_TITLE}: ${d.replace(/^\p{Ll}/u, (c) => c.toUpperCase())}` : SAMPLE_RECIPE_TITLE;
}

/** The dish a sample title names ("Sample recipe (stand-in): Chicken curry" → "Chicken curry"), "" for none, or null if it isn't a sample. */
export function sampleDish(title: string): string | null {
  if (!title.startsWith(SAMPLE_RECIPE_TITLE)) return null;
  return title.slice(SAMPLE_RECIPE_TITLE.length).replace(/^:\s*/, "").trim();
}
