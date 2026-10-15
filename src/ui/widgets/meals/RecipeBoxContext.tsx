"use client";
/**
 * "Cooked before" (0040): reading the kitchen's Done meals and "Make again". The app provides the
 * real route and server action; component tests provide fakes.
 */
import { createContext, useContext } from "react";
import type { MakeAgainResult } from "@/app/actions";
import { PastMeal } from "@/contracts/past-meals";

export interface RecipeBoxActions {
  /** Newest first; null when it couldn't be read. `q` matches the name or an ingredient (0040). */
  listPastMeals(q: string): Promise<PastMeal[] | null>;
  makeAgain(fromMealId: string): Promise<MakeAgainResult>;
}

const Ctx = createContext<RecipeBoxActions | null>(null);
export const RecipeBoxProvider = Ctx.Provider;
export const useRecipeBox = () => useContext(Ctx);

/** Reads `GET /api/kitchens/:id/past-meals`; rows that fail the contract are dropped and logged (0018). */
export async function fetchPastMeals(kitchenId: string, q: string, signal?: AbortSignal): Promise<PastMeal[] | null> {
  const params = new URLSearchParams({ limit: "20" });
  if (q.trim()) params.set("q", q.trim().slice(0, 200));
  try {
    const res = await fetch(`/api/kitchens/${encodeURIComponent(kitchenId)}/past-meals?${params}`, { signal, cache: "no-store" });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const rows = body && typeof body === "object" && Array.isArray((body as { meals?: unknown }).meals) ? (body as { meals: unknown[] }).meals : null;
    if (!rows) return null;
    return rows.flatMap((row) => {
      const parsed = PastMeal.safeParse(row);
      if (parsed.success) return [parsed.data];
      console.error("cooked before: dropped a row that failed the contract", { issues: parsed.error.issues });
      return [];
    });
  } catch (error) {
    if ((error as { name?: string }).name !== "AbortError") console.error("cooked before: couldn't load", { error });
    return null;
  }
}
