/**
 * `/recipe/[mealId]` (frontend.md §1): the Recipe, inside the main layout (so the chat dock stays).
 * The saved recipe is read on the server for a fresh load or a reload; a recipe streaming in right
 * now comes from the app's session state instead. A failed read never fails the page (0018): the
 * screen shows what it can and offers to write one.
 */
import { Suspense } from "react";
import type { RecipeView } from "@/contracts/kitchen-state";
import { getRecipe } from "@/domains/kitchen/queries";
import { getScope, getSession } from "@/server/session";
import { RecipeScreen } from "@/ui/widgets/meals/RecipeScreen";

export default function RecipePage({ params }: { params: Promise<{ mealId: string }> }) {
  return (
    <Suspense fallback={null}>
      <Recipe params={params} />
    </Suspense>
  );
}

async function Recipe({ params }: { params: Promise<{ mealId: string }> }) {
  const { mealId } = await params;
  let recipe: RecipeView | null = null;
  try {
    const session = await getSession();
    const ctx = session ? await getScope(session.kitchenId) : null;
    if (ctx) recipe = await getRecipe(ctx.db, ctx.scope, mealId);
  } catch (error) {
    console.error("recipe page: couldn't load the recipe", { error });
  }
  return <RecipeScreen key={mealId} mealId={mealId} initialRecipe={recipe} />;
}
