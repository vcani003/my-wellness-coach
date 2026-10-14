"use client";
/**
 * Done cooking (0013): the meal is done and its in-kitchen ingredients are recorded as used; then
 * "Update your kitchen" opens for them. With nothing from the kitchen in it, there's nothing to
 * ask, so it just says it's done.
 */
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { useAnnounce } from "@/ui/a11y/Announcer";
import { useMeals } from "./MealsContext";

export function useFinishCooking() {
  const t = useTranslations("meals.plan");
  const announce = useAnnounce();
  const { actions, openUpdateKitchen } = useMeals();
  return useCallback(
    async (mealId: string, title: string): Promise<boolean> => {
      try {
        const res = await actions.finishCooking(mealId);
        if (!res.ok || !res.result.applied.length) return false;
        actions.showSaved(res.result);
        const prompt = res.updateKitchen;
        if (prompt && prompt.items.length) openUpdateKitchen({ ...prompt, title: prompt.title || title });
        else announce(t("doneNothingToUpdate", { title }));
        return true;
      } catch {
        return false;
      }
    },
    [actions, openUpdateKitchen, announce, t],
  );
}
