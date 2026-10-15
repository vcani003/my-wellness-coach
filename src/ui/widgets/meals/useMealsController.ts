"use client";
/**
 * Wires the meal screens to the app: the turn stream (chat and Choose), the server actions, the
 * Recipe route and the workspace. The app shell calls this once; widgets read `MealsContext`.
 * - Ideas streaming in bring Meal ideas to the top (ux.md §2). Choosing (a tap, or naming it in
 *   chat) opens the Recipe at its own URL, so Back works.
 * - `recipe.saved` moves the kitchen's version, so the state is re-checked (actions must always
 *   send the latest version).
 * - `update-kitchen` (or Done cooking) opens "Update your kitchen".
 */
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  addMealToPlan,
  addRecipeNeedsToList,
  cancelMeal,
  finishCooking,
  skipUpdateKitchen,
  startCooking,
  submitUpdateKitchen,
  tickRecipeIngredient,
  updateKitchenLater,
} from "@/app/actions";
import type { ApplyResult } from "@/contracts/apply-result";
import type { StreamEvent } from "@/contracts/stream";
import type { KitchenSync } from "@/ui/sync/kitchen-sync";
import { streamChoose } from "./choose-stream";
import { MEAL_IDEAS_WIDGET_ID } from "./MealIdeasWidget";
import type { MealActions, MealNotice, MealsContextValue } from "./MealsContext";
import { RECIPE_HEADING_ID } from "./RecipeScreen";
import { initialMealsSession, mealsReducer, type UpdateKitchenRequest } from "./session";

const RECIPE_PATH = /^\/recipe\/([^/]+)\/?$/;

/** The meal whose Recipe is open, from the URL (null on `/`). */
export function recipeMealId(pathname: string | null): string | null {
  const m = pathname ? RECIPE_PATH.exec(pathname) : null;
  return m ? decodeURIComponent(m[1]) : null;
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `t-${Date.now()}-${Math.random()}`);

/**
 * Focus an element once it's on screen (the Recipe arrives from the server a moment after the URL
 * changes). Gives up if you've moved on: focus is only taken from the page itself, the control
 * that started this, or something that has just been hidden.
 */
function focusWhenReady(find: () => HTMLElement | null, from: HTMLElement | null, timeoutMs = 10_000) {
  const start = performance.now();
  const tick = () => {
    const active = document.activeElement;
    const free = !active || active === document.body || active === from || active.closest("[hidden]") !== null;
    if (!free) return;
    const el = find();
    if (el) return el.focus();
    if (performance.now() - start < timeoutMs) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function useMealsController(deps: {
  kitchenId: string;
  sync: KitchenSync;
  members: { userId: string; displayName: string }[];
  /** Saved change from a button: show it (and its New / Updated marks); `focus` brings its widget forward. */
  showSaved: (result: ApplyResult, opts?: { focus?: boolean | string }) => void;
  /** Bring a widget to the top (as after your own message) and scroll it into view. */
  focusWidget: (id: string) => void;
  /** Open the chat with text in the composer. */
  fillComposer: (text: string) => void;
  ownRecipeText: (title: string) => string;
  /** Where the Recipe's Back goes when it wasn't opened in the app (a fresh load or a reload). */
  recipeHome?: string;
}) {
  const { kitchenId, sync } = deps;
  const router = useRouter();
  const pathname = usePathname();
  const openMealId = recipeMealId(pathname);
  const [session, dispatch] = useReducer(mealsReducer, initialMealsSession);
  const [notice, setNotice] = useState<MealNotice | null>(null);
  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  });
  const openRef = useRef(openMealId);
  useEffect(() => {
    openRef.current = openMealId;
  }, [openMealId]);

  // Recipe navigation: remember what opened it, so Back returns focus there.
  const cameFromApp = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const focusOnReturn = useRef(false);

  const openRecipe = useCallback(
    (mealId: string, opts?: { focus?: boolean }) => {
      if (openRef.current === mealId) return;
      if (opts?.focus) {
        opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        focusWhenReady(() => document.getElementById(RECIPE_HEADING_ID), opener.current);
      }
      focusOnReturn.current = Boolean(opts?.focus);
      cameFromApp.current = true;
      openRef.current = mealId;
      router.push(`/recipe/${encodeURIComponent(mealId)}`);
    },
    [router],
  );

  const closeRecipe = useCallback(() => {
    const back = cameFromApp.current;
    cameFromApp.current = false;
    openRef.current = null;
    if (back) router.back();
    else router.push(depsRef.current.recipeHome ?? "/");
    // Focus goes back to what opened the Recipe (or the workspace), never lost on <body>.
    const target = focusOnReturn.current ? opener.current : null;
    const from = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusWhenReady(() => {
      if (recipeMealId(window.location.pathname)) return null;
      return target?.isConnected ? target : document.getElementById("workspace");
    }, from);
  }, [router]);

  /**
   * The newest kitchen version we know exists. `recipe.saved` moves it without sending the state;
   * actions wait for that state first, so they never carry an old version (STALE_TARGET).
   */
  const knownVersion = useRef(0);
  const fresh = useCallback(async () => {
    if (knownVersion.current > (sync.getSnapshot().state?.version ?? 0)) await sync.refresh();
  }, [sync]);

  /** Choose streams: meal IDs each stream added, so its recipe can open the Recipe. */
  const addedMeals = useRef(new Map<string, Set<string>>());
  const focusedIdeas = useRef(new Set<string>());

  const onEvent = useCallback(
    (event: StreamEvent, key: string, via: "chat" | "choose") => {
      dispatch({ type: "stream", key, event });
      switch (event.type) {
        case "status":
        case "idea":
          if ((event.type === "idea" || event.phase === "ideas") && !focusedIdeas.current.has(key)) {
            focusedIdeas.current.add(key);
            depsRef.current.focusWidget(MEAL_IDEAS_WIDGET_ID);
          }
          break;
        case "applied": {
          const meals = event.result.applied.flatMap((a) => a.refs).filter((r) => r.kind === "meal" && r.change === "added");
          if (meals.length) addedMeals.current.set(key, new Set(meals.map((r) => r.id)));
          break;
        }
        case "recipe":
          // Chose it in chat ("the first one"): the Recipe opens. A refinement doesn't move you.
          if (via === "chat" && event.part === "meta" && addedMeals.current.get(key)?.has(event.mealId)) {
            addedMeals.current.get(key)!.delete(event.mealId);
            openRecipe(event.mealId);
          }
          break;
        case "recipe.saved":
          knownVersion.current = Math.max(knownVersion.current, event.newVersion);
          void sync.check();
          break;
        default:
          break;
      }
    },
    [openRecipe, sync],
  );

  const onStreamEnd = useCallback((key: string) => {
    dispatch({ type: "streamEnded", key });
    addedMeals.current.delete(key);
    focusedIdeas.current.delete(key);
  }, []);

  const tap = useCallback(
    () => ({ kitchenId, tapId: newId(), basedOnVersion: sync.getSnapshot().state?.version ?? 0 }),
    [kitchenId, sync],
  );

  const runChoose = useCallback(
    async (target: { ideaId: string } | { mealId: string }, open: boolean): Promise<boolean> => {
      const key = newId();
      const ideaId = "ideaId" in target ? target.ideaId : null;
      if (ideaId) dispatch({ type: "chooseStart", ideaId });
      if ("mealId" in target) dispatch({ type: "recipeExpected", mealId: target.mealId, key });
      let mealId: string | undefined;
      await streamChoose({
        kitchenId,
        key,
        target,
        onEvent(e) {
          onEvent(e, key, "choose");
          if (e.type === "applied") {
            sync.applyOwn(e.result.state);
            mealId = e.result.applied.flatMap((a) => a.refs).find((r) => r.kind === "meal")?.id;
            if (mealId) {
              dispatch({ type: "recipeExpected", mealId, key });
              if (open) openRecipe(mealId, { focus: true });
            }
          }
        },
      });
      onStreamEnd(key);
      if (ideaId) dispatch(mealId ? { type: "chooseDone", ideaId } : { type: "chooseFailed", ideaId });
      return Boolean(mealId);
    },
    [kitchenId, onEvent, onStreamEnd, openRecipe, sync],
  );

  /**
   * Run a button's server action with the latest version. If it's refused, re-check the kitchen,
   * so Retry (or the next tap) goes with what's current (someone else may have changed it).
   */
  const withFresh = useCallback(
    <R extends { ok: boolean; result?: ApplyResult }>(call: (t: ReturnType<typeof tap>) => Promise<R>) =>
      async (): Promise<R> => {
        await fresh();
        const res = await call(tap());
        if (!res.ok || res.result?.rejected.length) void sync.check();
        return res;
      },
    [fresh, tap, sync],
  );

  const actions = useMemo<MealActions>(
    () => ({
      choose: (ideaId) => runChoose({ ideaId }, true),
      retryRecipe: (mealId) => runChoose({ mealId }, false),
      addToPlan: (mealId) => withFresh((t) => addMealToPlan({ ...t, mealId }))(),
      startCooking: (mealId) => withFresh((t) => startCooking({ ...t, mealId }))(),
      cancel: (mealId) => withFresh((t) => cancelMeal({ ...t, mealId }))(),
      finishCooking: (mealId) => withFresh((t) => finishCooking({ ...t, mealId }))(),
      submitUpdateKitchen: (args) => withFresh((t) => submitUpdateKitchen({ ...t, ...args }))(),
      updateKitchenLater: (args) => withFresh((t) => updateKitchenLater({ ...t, ...args }))(),
      skipUpdateKitchen: (reviewId) => withFresh((t) => skipUpdateKitchen({ ...t, reviewId }))(),
      tick: (mealId, ingredient, ticked) => withFresh((t) => tickRecipeIngredient({ ...t, mealId, ingredient, ticked }))(),
      addNeedsToList: (mealId) => withFresh((t) => addRecipeNeedsToList({ ...t, mealId }))(),
      openRecipe,
      closeRecipe,
      useOwnRecipe: (title) => depsRef.current.fillComposer(depsRef.current.ownRecipeText(title)),
      showSaved: (result, opts) => depsRef.current.showSaved(result, opts),
    }),
    [runChoose, withFresh, openRecipe, closeRecipe],
  );

  const openUpdateKitchen = useCallback((request: UpdateKitchenRequest) => dispatch({ type: "openUpdateKitchen", request }), []);

  const value = useMemo<MealsContextValue>(
    () => ({ session, dispatch, actions, members: deps.members, notice, setNotice, openUpdateKitchen }),
    [session, actions, deps.members, notice, openUpdateKitchen],
  );

  return { value, session, openMealId, onEvent, onStreamEnd };
}
