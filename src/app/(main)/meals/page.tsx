/** `/meals`: this session's meal ideas and Cooked before (0013, 0040). Recipes are `/recipe/[mealId]`. */
import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n";
import { Place } from "@/ui/places/Place";

export const metadata: Metadata = { title: getMessages().places.pageTitle.meals };

export default function MealsPage() {
  return <Place id="meals" />;
}
