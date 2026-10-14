"use client";
/**
 * What the meal screens (Meal ideas, Recipe, Meal plan, "Update your kitchen") read and do. The app
 * provides the real server actions and streams; component tests provide fakes. Every action
 * already carries the kitchen, a fresh tap ID and the version on screen (backend §6).
 */
import { createContext, useContext, type Dispatch } from "react";
import type { ActionResult, FinishCookingResult } from "@/app/actions";
import type { ApplyResult } from "@/contracts/apply-result";
import type { MealsEvent, MealsSession, UpdateKitchenRequest } from "./session";

export type AfterCookingStock = "have" | "low" | "out";

export interface MealActions {
  /** Choose on an idea card: streams the recipe and opens it. Resolves when the choose saved (or failed). */
  choose(ideaId: string): Promise<boolean>;
  /** Write the recipe again for a meal whose recipe didn't save ("Try again"). */
  retryRecipe(mealId: string): Promise<boolean>;
  addToPlan(mealId: string): Promise<ActionResult>;
  startCooking(mealId: string): Promise<ActionResult>;
  cancel(mealId: string): Promise<ActionResult>;
  finishCooking(mealId: string): Promise<FinishCookingResult>;
  submitUpdateKitchen(args: { mealId: string; items: { itemId: string; stock: AfterCookingStock }[]; note?: string; reviewId?: string }): Promise<ActionResult>;
  updateKitchenLater(args: { mealId: string; items: { itemId: string; name: string }[] }): Promise<ActionResult>;
  skipUpdateKitchen(reviewId: string): Promise<ActionResult>;
  tick(mealId: string, ingredient: string, ticked: boolean): Promise<ActionResult>;
  addNeedsToList(mealId: string): Promise<ActionResult>;
  /** Open the Recipe (its own URL, so Back works). `focus` moves focus to it (a tap, not chat). */
  openRecipe(mealId: string, opts?: { focus?: boolean }): void;
  closeRecipe(): void;
  /** "Use my own recipe" (R2): opens the chat with the composer ready for a paste. */
  useOwnRecipe(title: string): void;
  /**
   * A saved change from a meal button: show it now. `focus` brings its widget forward (true = the
   * widget its changes concern, or name one, e.g. the Kitchen after "Update your kitchen").
   */
  showSaved(result: ApplyResult, opts?: { focus?: boolean | string }): void;
}

export interface MealsContextValue {
  session: MealsSession;
  dispatch: Dispatch<MealsEvent>;
  actions: MealActions;
  /** Kitchen members, so an allergy says whose it is (0019). */
  members: { userId: string; displayName: string }[];
  /** The latest "Update your kitchen" result, shown in the Kitchen widget with Undo. */
  notice: MealNotice | null;
  setNotice(notice: MealNotice | null): void;
  /** Open "Update your kitchen" (after Done cooking, or from its To review card). */
  openUpdateKitchen(request: UpdateKitchenRequest): void;
}

export interface MealNotice {
  text: string;
  undo?: { changeSetId: string; label: string };
  turn: number;
}

const Ctx = createContext<MealsContextValue | null>(null);
export const MealsProvider = Ctx.Provider;

export function useMeals(): MealsContextValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useMeals must be used inside MealsProvider");
  return value;
}

/** For shared screens (Kitchen's To review) that also render without the meal screens. */
export function useMealsOptional(): MealsContextValue | null {
  return useContext(Ctx);
}
