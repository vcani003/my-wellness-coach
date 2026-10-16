"use client";
/**
 * The Recipe (ux.md §3, decisions 0010, 0013, 0019) at `/recipe/[mealId]`: a full page on a phone,
 * the workspace column on desktop; the chat dock stays, so you can say "no oven" while reading.
 * - Header: the meal, "Suggested by Kitchen" (or "Your recipe"), its status, and **Use my own
 *   recipe** (R2), which opens the chat ready for a paste.
 * - The allergen badge under the header and on each flagged ingredient (0019).
 * - ONE checklist in two groups, **In your kitchen** and **Need**, with shared ticks that say who
 *   ticked (M6), then **Add Need items to shopping list** (0027), then the numbered steps.
 * - Parts stream in; parts never confirmed by `recipe.saved` are dropped (backend §6).
 * - **Add to plan** / **Start cooking** / **Done cooking**, by status.
 */
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import type { RecipeView } from "@/contracts/kitchen-state";
import { Checkbox } from "@/ui/primitives/Checkbox";
import { useAnnounce } from "@/ui/a11y/Announcer";
import { useFormatMsg } from "@/ui/chat/format-msg";
import { actorName, sentenceCase } from "@/ui/fallbacks";
import { BackIcon, UndoIcon } from "@/ui/primitives/icons";
import { useKitchenActions } from "@/ui/sync/KitchenActionsContext";
import { useKitchenData } from "@/ui/sync/KitchenDataContext";
import { AllergenBadge } from "./AllergenBadge";
import { useMeals } from "./MealsContext";
import { checklistGroups, pickRecipe, tickKey, ticksFor, type RecipeRow } from "./recipe-model";
import { useFinishCooking } from "./useFinishCooking";

export const RECIPE_HEADING_ID = "recipe-heading";

export function RecipeScreen({ mealId, initialRecipe }: { mealId: string; initialRecipe: RecipeView | null }) {
  const t = useTranslations("meals.recipe");
  const tAll = useTranslations();
  const locale = useLocale();
  const formatMsg = useFormatMsg();
  const announce = useAnnounce();
  const kitchenActions = useKitchenActions();
  const { session, actions } = useMeals();
  const finishCooking = useFinishCooking();
  const { snapshot, me, turn = 0 } = useKitchenData();
  const state = snapshot.state;
  const meal = state?.meals.find((m) => m.id === mealId);
  const recipe = pickRecipe(session.recipes[mealId], initialRecipe, meal?.recipe);
  const title = meal?.title ?? recipe?.title ?? (initialRecipe && !("missing" in initialRecipe.meal) ? initialRecipe.meal.title : undefined);
  const ticks = ticksFor(state, mealId);
  const [pendingTicks, setPendingTicks] = useState<Record<string, boolean>>({});
  const [tickFailed, setTickFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [listNotice, setListNotice] = useState<{ text: string; changeSetId?: string; turn: number } | null>(null);
  const tickChain = useRef<Promise<unknown>>(Promise.resolve());
  const saved = recipe?.status === "saved";
  const writing = recipe?.status === "writing";

  const isTicked = (row: RecipeRow) => pendingTicks[tickKey(row.name)] ?? ticks.has(tickKey(row.name));

  /** Ticks show at once and are saved one at a time, so each carries the latest version (M6). */
  const toggleTick = (row: RecipeRow) => {
    const key = tickKey(row.name);
    const next = !isTicked(row);
    setTickFailed(null);
    setPendingTicks((p) => ({ ...p, [key]: next }));
    tickChain.current = tickChain.current.then(async () => {
      try {
        const res = await actions.tick(mealId, row.name, next);
        if (res.ok) actions.showSaved(res.result);
        if (!res.ok || res.result.rejected.length) throw new Error("tick refused");
      } catch {
        setTickFailed(row.name);
      } finally {
        setPendingTicks((p) => {
          const rest = { ...p };
          delete rest[key];
          return rest;
        });
      }
    });
  };

  const step = async (kind: "plan" | "start" | "done") => {
    if (busy || !meal) return;
    setBusy(kind);
    setFailed(null);
    try {
      if (kind === "done") {
        // Done cooking: back to the workspace, where the Kitchen will show what changed.
        const ok = await finishCooking(meal.id, meal.title);
        if (ok) actions.closeRecipe();
        else setFailed(t("failed"));
        return;
      }
      const res = kind === "plan" ? await actions.addToPlan(meal.id) : await actions.startCooking(meal.id);
      if (!res.ok || !res.result.applied.length) {
        setFailed(t("failed"));
        return;
      }
      actions.showSaved(res.result, { focus: true });
      announce(kind === "plan" ? t("planned", { title: meal.title }) : t("started", { title: meal.title }));
    } catch {
      setFailed(t("failed"));
    } finally {
      setBusy(null);
    }
  };

  const addNeeds = async () => {
    if (busy) return;
    setBusy("needs");
    setFailed(null);
    try {
      const res = await actions.addNeedsToList(mealId);
      if (!res.ok || !res.result.applied.length) {
        setFailed(t("needsFailed"));
        return;
      }
      actions.showSaved(res.result);
      const text = t("needsAdded");
      setListNotice({ text, changeSetId: res.result.changeSetId, turn });
      announce(text);
    } catch {
      setFailed(t("needsFailed"));
    } finally {
      setBusy(null);
    }
  };

  const undoNeeds = async (changeSetId: string) => {
    try {
      const res = await kitchenActions.undo(changeSetId);
      if (res.ok && res.result.applied.length && !res.result.rejected.length) {
        actions.showSaved(res.result);
        setListNotice({ text: t("needsUndone"), turn });
        announce(t("needsUndone"));
        return;
      }
    } catch {
      // fall through
    }
    setListNotice({ text: t("cantUndo"), turn });
    announce(t("cantUndo"));
  };

  const groups = recipe ? checklistGroups(recipe.ingredients) : [];
  const needCount = recipe?.ingredients.filter((r) => r.group === "need").length ?? 0;
  const status = meal?.status;
  const notice = listNotice && listNotice.turn === turn ? listNotice : null;
  const basicsText = recipe?.basicsNote
    ? formatMsg(recipe.basicsNote)
    : recipe?.basics.length
      ? tAll("msg.BASICS_ASSUMED", { basics: new Intl.ListFormat(locale, { type: "conjunction" }).format(recipe.basics) })
      : null;

  return (
    <article aria-labelledby={RECIPE_HEADING_ID} className="place-enter mx-auto flex w-full max-w-prose flex-col gap-5 pb-6" data-recipe={mealId}>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={actions.closeRecipe}
          className="btn btn-small self-start"
        >
          <BackIcon aria-hidden="true" className="size-icon" />
          {t("back")}
        </button>
        <h2 id={RECIPE_HEADING_ID} tabIndex={-1} className="text-display font-medium outline-none">
          {title ?? tAll("fallback.unknownMeal")}
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-small">
          <span className="rounded-button bg-surface-soft px-3 py-0.5 font-strong text-text-default">
            {recipe?.source === "user" ? t("yourRecipe") : t("suggested")}
          </span>
          {status === "planned" && <span className="rounded-button bg-success-bg px-3 py-0.5 font-strong text-success-text">{t("inPlan")}</span>}
          {status === "cooking" && <span className="rounded-button bg-highlight-bg px-3 py-0.5 font-strong text-highlight-text">{t("cooking")}</span>}
          {!meal && state && <span className="text-text-muted">{t("notLive")}</span>}
        </div>
        {meal && (
          <button
            type="button"
            onClick={() => actions.useOwnRecipe(meal.title)}
            className="btn-quiet self-start px-0 text-small underline"
          >
            {t("useOwn")}
          </button>
        )}
        {recipe && recipe.allergenFlags.length > 0 && <AllergenBadge flags={recipe.allergenFlags} startOpen />}
        {basicsText && <p className="text-small text-text-muted">{basicsText}</p>}
      </div>

      {writing && (
        <p role="status" className="text-small text-text-muted">
          {t("writing")}
        </p>
      )}
      {recipe?.status === "failed" && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-error-bg px-4 py-3 text-small text-error-text">
          <span>{t("writeFailed")}</span>
          <button
            type="button"
            onClick={() => void actions.retryRecipe(mealId)}
            className="btn-quiet underline"
          >
            {t("tryAgain")}
          </button>
        </div>
      )}
      {!recipe && (
        <div className="flex flex-wrap items-center gap-2 text-body text-text-muted">
          <span>{meal ? t("noRecipe") : t("notFound")}</span>
          {meal && (
            <button
              type="button"
              onClick={() => void actions.retryRecipe(mealId)}
              className="btn-quiet underline"
            >
              {t("suggestOne")}
            </button>
          )}
        </div>
      )}

      {groups.length > 0 && (
        <section aria-labelledby="recipe-ingredients" className="card flex flex-col gap-3 px-5 py-5">
          <h3 id="recipe-ingredients" className="text-title font-medium">
            {t("ingredients")}
          </h3>
          {groups.map((g) => (
            <fieldset key={g.key} className="flex flex-col" disabled={!saved || !meal}>
              <legend className="section-label mb-1">{t(`group.${g.key}`)}</legend>
              {g.rows.map((row) => {
                const tick = ticks.get(tickKey(row.name));
                const by = tick && !("missing" in tick.updatedBy) && tick.updatedBy.id === me.id ? null : tick ? actorName(tick.updatedBy, tAll) : null;
                const showBy = by && isTicked(row) && pendingTicks[tickKey(row.name)] === undefined;
                const name = sentenceCase(row.name, locale);
                return (
                  <div
                    key={`${g.key}-${row.name}${row.changed ? `-${recipe?.changeKey}` : ""}`}
                    className="flex flex-col py-1"
                    data-recipe-changed={row.changed ? "" : undefined}
                  >
                    <label className="flex min-h-tap cursor-pointer items-center gap-3 rounded-md px-1">
                      <Checkbox
                        checked={isTicked(row)}
                        onChange={() => toggleTick(row)}
                        aria-label={showBy ? t("tickLabelBy", { name, person: by }) : name}
                      />
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className={`text-body ${isTicked(row) ? "text-text-muted line-through" : ""}`}>{name}</span>
                        {row.amount && <span className="text-small text-text-muted">{row.amount}</span>}
                        {row.group === "basic" && <span className="text-caption text-text-muted">{t("basic")}</span>}
                        {showBy && <span className="text-caption text-text-muted">{t("tickedBy", { person: by })}</span>}
                      </span>
                    </label>
                    {row.allergenFlags.length > 0 && (
                      <div className="pl-10">
                        <AllergenBadge flags={row.allergenFlags} />
                      </div>
                    )}
                    {tickFailed === row.name && (
                      <p role="alert" className="flex items-center gap-2 pl-10 text-small text-error-text">
                        {t("tickFailed")}
                        <button type="button" onClick={() => toggleTick(row)} className="btn-quiet underline">
                          {t("retry")}
                        </button>
                      </p>
                    )}
                  </div>
                );
              })}
            </fieldset>
          ))}
          {needCount > 0 && saved && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void addNeeds()}
              className="btn btn-small self-start"
            >
              {busy === "needs" ? t("adding") : t("addNeeds")}
            </button>
          )}
          {notice && (
            <p className="flex flex-wrap items-center gap-2 rounded-md bg-success-bg px-4 py-2 text-small text-success-text">
              <span>{notice.text}</span>
              {notice.changeSetId && (
                <button
                  type="button"
                  aria-label={t("needsUndoLabel")}
                  onClick={() => void undoNeeds(notice.changeSetId!)}
                  className="btn-quiet"
                >
                  <UndoIcon aria-hidden="true" className="size-icon-sm" />
                  {t("undo")}
                </button>
              )}
            </p>
          )}
        </section>
      )}

      {recipe && recipe.steps.length > 0 && (
        <section aria-labelledby="recipe-steps" className="flex flex-col gap-3">
          <h3 id="recipe-steps" className="text-title font-medium">
            {t("steps")}
          </h3>
          <ol className="flex flex-col gap-3 text-body">
            {recipe.steps.map((s, i) => {
              const changed = recipe.changedSteps?.includes(i);
              return (
                <li
                  key={changed ? `${i}-${recipe.changeKey}` : i}
                  className="flex items-start gap-3"
                  data-recipe-changed={changed ? "" : undefined}
                >
                  {/* The number is the list's own; this circle is how it looks (Kitchen OS steps). */}
                  <span aria-hidden="true" className="grid size-avatar shrink-0 place-items-center rounded-full bg-surface-soft text-small font-strong text-accent-text">
                    {i + 1}
                  </span>
                  <span className="pt-1">{s}</span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {meal && (
        <div className="flex flex-col gap-2">
          {failed && (
            <p role="alert" className="rounded-md bg-error-bg px-3 py-2 text-small text-error-text">
              {failed}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {status === "chosen" && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void step("plan")}
                className="btn"
              >
                {t("addToPlan")}
              </button>
            )}
            {(status === "chosen" || status === "planned") && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void step("start")}
                className="btn btn-primary"
              >
                {t("startCooking")}
              </button>
            )}
            {status === "cooking" && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void step("done")}
                className="btn btn-primary"
              >
                {t("doneCooking")}
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
