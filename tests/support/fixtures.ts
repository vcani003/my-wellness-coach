/**
 * Fixtures shared by unit and integration tests:
 * - the primary journey (decision 0005);
 * - the after-cooking flow (decision 0013).
 * Operations are what the AI would propose for each message.
 */
import type { OpInput } from "./memory-kitchen";
import { said } from "./memory-kitchen";

export const primaryJourney = {
  bought: {
    text: "I bought eggs, chicken thighs, spinach and yogurt.",
    ops: [
      { type: "item.add", evidence: "eggs", fields: { name: said("eggs") } },
      { type: "item.add", evidence: "chicken thighs", fields: { name: said("chicken thighs") } },
      { type: "item.add", evidence: "spinach", fields: { name: said("spinach") } },
      { type: "item.add", evidence: "yogurt", fields: { name: said("yogurt") } },
    ] satisfies OpInput[],
  },
  froze: {
    text: "I froze the chicken.",
    ops: [
      {
        type: "item.update",
        evidence: "I froze the chicken",
        target: { name: "chicken" },
        fields: { location: said("freezer"), frozen: said(true) },
      },
    ] satisfies OpInput[],
  },
  /** "What can I make tonight?" → the Meal ideas widget. Ideas are stored, not kitchen events. */
  ideas: [
    {
      ideaId: "idea-curry",
      name: "Chicken and spinach curry",
      why: "Uses your chicken and spinach",
      uses: [] as string[],
      missing: ["onion"],
    },
    { ideaId: "idea-omelette", name: "Spinach omelette", why: "Quick, uses eggs", uses: [] as string[], missing: [] },
  ],
  /** Step 4: the user clearly selects one meal (a tap). */
  choose: (ideaId: string): OpInput[] => [{ type: "meal.choose", target: { ideaId } }],
  addToPlan: {
    text: "Add that to my meal plan.",
    ops: (mealId: string): OpInput[] => [
      { type: "meal.plan", evidence: "Add that to my meal plan", target: { mealId } },
    ],
  },
};

export const afterCooking = {
  /** The suggested recipe saved on choosing (0013, R2). */
  recipe: (mealId: string, chickenItemId: string): OpInput[] => [
    {
      type: "recipe.save",
      target: { mealId },
      source: "ai",
      text: "Brown the chicken, add onion and spinach, simmer with spices.",
      ingredients: [
        { name: "chicken thighs", itemId: chickenItemId },
        { name: "spinach" },
        { name: "onion" },
        { name: "salt", basic: true },
      ],
      steps: ["Brown the chicken", "Add onion and spinach", "Simmer"],
      basicsAssumed: ["salt"],
    },
  ],
  startCooking: (mealId: string): OpInput[] => [{ type: "meal.transition", target: { mealId }, to: "cooking" }],
  /** "Update your kitchen" sheet → Done: spinach running low, chicken out, plus a note. */
  finish: (mealId: string, chickenItemId: string, spinachItemId: string): OpInput[] => [
    { type: "meal.transition", target: { mealId }, to: "done", note: "Used the whole pack of chicken" },
    { type: "item.use", target: { itemId: spinachItemId }, fields: { stock: said("low") } },
    { type: "item.use", target: { itemId: chickenItemId }, fields: { stock: said("out") } },
  ],
};
