"use client";
/**
 * The Meals place (Kitchen OS "Meals"; 0009, 0013, 0040):
 * - **Meal ideas**: this session's ideas streaming in (not saved, 0013), or one button that asks
 *   Lumi for ideas from what's in the kitchen.
 * - **Cooked before** (0040): the kitchen's finished meals, one row per dish, newest first, with
 *   search by name or ingredient, today's allergy flags, the after-cooking note, **Open recipe**
 *   and **Make again** (or **Open in your plan** when a copy is already chosen or planned, RBX1).
 */
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import type { PastMeal } from "@/contracts/past-meals";
import { useAskLumi } from "@/ui/chat/AskLumi";
import { useFormatMsg } from "@/ui/chat/format-msg";
import { actorName, byOther, sentenceCase } from "@/ui/fallbacks";
import { LumiHalo } from "@/ui/lumi/Lumi";
import { CloseIcon, MakeAgainIcon, SearchIcon, SparkleIcon } from "@/ui/primitives/icons";
import { useKitchenData } from "@/ui/sync/KitchenDataContext";
import { AllergenBadge } from "./AllergenBadge";
import { MealIdeasWidget } from "./MealIdeasWidget";
import { useMeals } from "./MealsContext";
import { useRecipeBox } from "./RecipeBoxContext";

/** How long typing must pause before Cooked before is searched again. */
const SEARCH_DELAY_MS = 300;

export function MealsPlace() {
  return (
    <>
      <IdeasSection />
      <CookedBefore />
    </>
  );
}

function IdeasSection() {
  const t = useTranslations("meals.ideas");
  const { session } = useMeals();
  const { ask, canAsk } = useAskLumi();
  return (
    <section aria-labelledby="meals-ideas-heading" className="flex flex-col gap-3" data-meals="ideas">
      <h2 id="meals-ideas-heading" className="text-title font-medium">
        {t("title")}
      </h2>
      {session.ideas ? (
        <MealIdeasWidget />
      ) : (
        <div className="card flex items-center gap-4 px-6 py-6">
          <LumiHalo state="idle" size="lumi-lg" />
          <div className="flex flex-col items-start gap-3">
            <p className="text-body font-medium">{t("emptyBody")}</p>
            <button type="button" disabled={!canAsk} onClick={() => ask(t("ask"))} className="btn btn-primary">
              <SparkleIcon aria-hidden="true" className="size-icon" />
              {t("getIdeas")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function CookedBefore() {
  const t = useTranslations("meals.cookedBefore");
  const box = useRecipeBox();
  const { snapshot } = useKitchenData();
  const version = snapshot.state?.version ?? 0;
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<PastMeal[] | null | "loading">("loading");
  const [attempt, setAttempt] = useState(0);
  const searchId = useId();

  useEffect(() => {
    if (!box) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void box.listPastMeals(query).then((meals) => {
        if (!controller.signal.aborted) setRows(meals);
      });
    }, query ? SEARCH_DELAY_MS : 0);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // The version: a meal you just finished shows up without a reload.
  }, [box, query, version, attempt]);

  if (!box) return null;
  const searching = query.trim().length > 0;

  return (
    <section aria-labelledby="cooked-before-heading" className="flex flex-col gap-3" data-meals="cooked-before">
      <h2 id="cooked-before-heading" className="text-title font-medium">
        {t("title")}
      </h2>
      {(searching || (Array.isArray(rows) && rows.length > 0)) && (
        <div role="search" className="relative">
          <label htmlFor={searchId} className="sr-only">
            {t("searchLabel")}
          </label>
          <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 size-icon -translate-y-1/2 text-text-muted" />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.preventDefault();
                setQuery("");
              }
            }}
            placeholder={t("searchPlaceholder")}
            autoComplete="off"
            enterKeyHint="search"
            className="min-h-tap w-full rounded-button border-[1.5px] border-border-strong bg-surface-raised py-2 pr-7 pl-7 text-body placeholder:text-text-muted"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label={t("clear")} className="btn-icon absolute top-1/2 right-0 -translate-y-1/2">
              <CloseIcon aria-hidden="true" className="size-icon" />
            </button>
          )}
        </div>
      )}
      {rows === "loading" ? (
        <p aria-busy="true" className="text-small text-text-muted">
          {t("loading")}
        </p>
      ) : rows === null ? (
        <p className="flex flex-wrap items-center gap-2 rounded-md bg-error-bg px-4 py-3 text-small text-error-text">
          {t("error")}
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="btn-quiet underline">
            {t("retry")}
          </button>
        </p>
      ) : rows.length === 0 ? (
        <p className="text-small text-text-muted">{searching ? t("noMatches", { query: query.trim() }) : t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((meal) => (
            <PastMealRow key={meal.mealId} meal={meal} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PastMealRow({ meal }: { meal: PastMeal }) {
  const t = useTranslations("meals.cookedBefore");
  const tAll = useTranslations();
  const format = useFormatter();
  const locale = useLocale();
  const formatMsg = useFormatMsg();
  const box = useRecipeBox();
  const { me } = useKitchenData();
  const { actions } = useMeals();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const when = format.dateTime(new Date(meal.lastCookedAt), { month: "short", day: "numeric" });
  const by = byOther(meal.lastCookedBy, me.id) ? sentenceCase(actorName(meal.lastCookedBy, tAll), locale) : null;

  const makeAgain = async () => {
    if (!box || busy) return;
    setBusy(true);
    setFailed(null);
    try {
      const res = await box.makeAgain(meal.mealId);
      if (res.ok) {
        actions.showSaved(res.result);
        actions.openRecipe(res.mealId, { focus: true });
        return;
      }
      if (res.activeMealId) {
        actions.openRecipe(res.activeMealId, { focus: true });
        return;
      }
      setFailed(formatMsg(res.reason));
    } catch {
      setFailed(t("failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li data-entity-id={meal.mealId} className="card flex flex-col gap-2 px-5 py-4">
      <h3 className="text-title font-medium">{meal.title}</h3>
      <p className="text-small text-text-muted">
        {by ? t("madeBy", { count: meal.timesCooked, date: when, name: by }) : t("made", { count: meal.timesCooked, date: when })}
      </p>
      <AllergenBadge flags={meal.allergenFlags} />
      {meal.note?.text.trim() && <p className="text-small">{t("note", { note: meal.note.text.trim() })}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {meal.activeCopyMealId ? (
          <button type="button" onClick={() => actions.openRecipe(meal.activeCopyMealId!, { focus: true })} className="btn btn-small">
            {t("openInPlan")}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void makeAgain()}
            aria-label={t("makeAgainLabel", { title: meal.title })}
            className="btn btn-primary btn-small"
          >
            <MakeAgainIcon aria-hidden="true" className="size-icon-sm" />
            {busy ? t("making") : t("makeAgain")}
          </button>
        )}
        {meal.recipe && (
          <button
            type="button"
            onClick={() => actions.openRecipe(meal.mealId, { focus: true })}
            aria-label={t("openRecipeLabel", { title: meal.title })}
            className="btn-quiet text-small underline"
          >
            {t("openRecipe")}
          </button>
        )}
      </div>
      {failed && (
        <p role="alert" className="rounded-md bg-error-bg px-3 py-2 text-small text-error-text">
          {failed}
        </p>
      )}
    </li>
  );
}
