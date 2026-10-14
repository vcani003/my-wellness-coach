/**
 * Meal ideas and recipes (ai.md §5): the inputs and results Backend and Frontend wire to.
 * The AI only suggests. Ideas are stored by `recordMealIdeas`, and a recipe is saved only through
 * the `recipe.save` operation these functions return, applied by the backend (0003).
 */
import type { AllergenFlag, Msg } from "@/contracts/common";
import type { KitchenState } from "@/contracts/kitchen-state";
import type { OperationOf } from "@/contracts/operations";
import type { Restriction } from "@/shared/profile/state";

/** A kitchen member, so allergy lines can say whose they are ("Levi's seafood allergy"). */
export interface KitchenMember {
  userId: string;
  name: string;
}

/** What every meal call sees. Built fresh from the database each time (spec §4). */
export interface MealContext {
  kitchenId: string;
  /** Who is asking. Diets and preferences apply only to them; allergies apply to everyone (0019). */
  userId: string;
  state: KitchenState;
  members: KitchenMember[];
  /** Every member's allergies and diets, with their own notes (0019). */
  restrictions: Restriction[];
  /** The asker's lasting preferences (0012), as plain statements. */
  preferences?: string[];
  /** This user's recent turns, oldest first. */
  history?: Array<{ role: "user" | "assistant"; text: string }>;
}

export interface MealIdeasInput extends MealContext {
  /**
   * The user's own words, when they asked ("something quick", "Vietnamese", "shrimp tacos?").
   * Applies to this request only (0012). Null when ideas were asked for without words (a button).
   */
  request: { messageId: string; text: string } | null;
  /** How many ideas to aim for. Default 3 (0009). */
  count?: number;
}

/** One idea card (0009), ready for `recordMealIdeas` (backend). */
export interface GeneratedIdea {
  name: string;
  /** One line, use-it-up first (0025): "Uses the chicken you defrosted yesterday". */
  why: string;
  /** Kitchen item IDs it uses. Recomputed by code: never food the kitchen doesn't have. */
  uses: string[];
  /** Ingredients the kitchen doesn't have (no assumed basics). */
  missing: string[];
  /** Assumed basics it relies on (0019), for the reminder. */
  basics: string[];
  /** Used items that need using up (0025). */
  useItUp: string[];
  /** Computed by code over the name, used items and missing items (0019); never by the model. */
  allergenFlags: AllergenFlag[];
}

export type MealFailure = "budget" | "refusal" | "failed" | "not-configured";

export type IdeasResult =
  | {
      ok: true;
      ideas: GeneratedIdea[];
      /** Short chat reply ("Here are three ideas…"). Says so when ideas were left out for allergies. */
      reply: string;
      /** e.g. the assumed-basics reminder. */
      notes: Msg[];
      /** Ideas left out because they contained an allergen nobody asked for (AI6). */
      droppedForAllergens: number;
    }
  | { ok: false; reason: MealFailure; reply: string };

/** Streamed while ideas are generated; the last event is always `done`. */
export type IdeasEvent = { type: "idea"; idea: GeneratedIdea } | { type: "done"; result: IdeasResult };

/** The meal a recipe is for (it exists: `meal.choose` created it, status `chosen`). */
export interface RecipeMeal {
  mealId: string;
  title: string;
  /** The idea it came from, when chosen from a card. */
  idea?: { name: string; why: string; uses: string[]; missing: string[] };
  /**
   * A dish the user named in chat (MI1): their own words about it ("with coconut milk,
   * lemongrass, kaffir lime leaves; use the curry base seasoning packet"). Data, never instructions.
   */
  notes?: string;
}

export interface RecipeIngredientOut {
  name: string;
  /** As written in the recipe ("2", "1 cup"). Null when not given. */
  amount: string | null;
  /** The kitchen item it matched, if any. */
  itemId: string | null;
  /** Checklist group (0013): in the kitchen, needed, or an assumed basic (0019). */
  group: "kitchen" | "need" | "basic";
  allergenFlags: AllergenFlag[];
}

export interface GeneratedRecipe {
  mealId: string;
  title: string;
  summary: string;
  servings: string | null;
  source: "ai" | "user";
  ingredients: RecipeIngredientOut[];
  steps: string[];
  basicsAssumed: string[];
  /** Over the title and every ingredient, by code. */
  allergenFlags: AllergenFlag[];
}

export interface RecipeInput extends MealContext {
  meal: RecipeMeal;
  /**
   * Refinement in chat ("no oven", "make it spicier", 0013): the user's message and the
   * current recipe. The result is a new version for the same meal.
   */
  refine?: { messageId: string; text: string; current: Pick<GeneratedRecipe, "title" | "ingredients" | "steps"> & { servings?: string | null } };
}

/** A recipe the user pasted or typed (R1, "Your recipe"). Stored exactly as given. */
export interface PastedRecipeInput extends MealContext {
  meal: RecipeMeal;
  messageId: string;
  /** The pasted text. Data only, never instructions (ai.md §6). */
  text: string;
}

export type RecipeSaveOperation = OperationOf<"recipe.save">;

export type RecipeResult =
  | {
      ok: true;
      recipe: GeneratedRecipe;
      /** The only write this can produce. Contract-valid; the backend applies it. */
      operation: RecipeSaveOperation;
      reply: string;
      notes: Msg[];
    }
  | { ok: false; reason: MealFailure; reply: string };

/** `recipe` stream parts (backend §6: the `data` shape is owned by the AI specialist). */
export type RecipePart =
  | { part: "meta"; data: { title: string; summary: string; servings: string | null; source: "ai" | "user"; allergenFlags: AllergenFlag[] } }
  | { part: "ingredient"; data: RecipeIngredientOut & { index: number } }
  | { part: "step"; data: { index: number; text: string } }
  | { part: "basics"; data: { basics: string[]; note: Msg | null } };

/** Streamed while a recipe is generated; the last event is always `done`. */
export type RecipeEvent = ({ type: "part" } & RecipePart) | { type: "done"; result: RecipeResult };

/** The meal AI: real (Claude) or fake (deterministic, for tests and local dev). */
export interface MealAI {
  streamMealIdeas(input: MealIdeasInput): AsyncGenerator<IdeasEvent>;
  generateMealIdeas(input: MealIdeasInput): Promise<IdeasResult>;
  streamRecipe(input: RecipeInput): AsyncGenerator<RecipeEvent>;
  generateRecipe(input: RecipeInput): Promise<RecipeResult>;
  readPastedRecipe(input: PastedRecipeInput): Promise<RecipeResult>;
}
