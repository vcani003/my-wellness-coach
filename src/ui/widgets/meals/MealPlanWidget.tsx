"use client";
/**
 * Meal plan (ux.md §3, decisions 0008, 0013): a short undated list, **Cooking** meals first, then
 * planned ones in the order added, with "Added by Levi" where relevant. Tap a meal for its Recipe.
 * Start cooking / Done cooking; Cancel (the kitchen is unchanged) leaves "cancelled · Undo" in its
 * place until your next message. Done cooking opens "Update your kitchen".
 */
import { usePlaceMemory } from "@/ui/places/PlaceMemory";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { MealRow } from "@/contracts/kitchen-state";
import { useAnnounce } from "@/ui/a11y/Announcer";
import { actorName, byOther } from "@/ui/fallbacks";
import { UndoIcon } from "@/ui/primitives/icons";
import { useKitchenActions } from "@/ui/sync/KitchenActionsContext";
import { useKitchenData } from "@/ui/sync/KitchenDataContext";
import { MealNoticeLine } from "@/ui/widgets/kitchen/ToReview";
import { LUMI_ART } from "@/ui/lumi/Lumi";
import { useMeals } from "./MealsContext";
import { useFinishCooking } from "./useFinishCooking";

export const MEAL_PLAN_WIDGET_ID = "meals.plan";

export function planMeals(state: { plan: string[]; meals: MealRow[] } | null): MealRow[] {
  if (!state) return [];
  const rows = state.plan.flatMap((id) => state.meals.filter((m) => m.id === id));
  // Cooking first, then planned in the order added (0013); the backend already orders `plan` that way.
  return [...rows.filter((m) => m.status === "cooking"), ...rows.filter((m) => m.status !== "cooking")];
}

/** The Plan place: the latest "Update your kitchen" result (with Undo), then the ordered plan. */
export function PlanPlace() {
  return (
    <>
      <MealNoticeLine />
      <MealPlanWidget />
    </>
  );
}

export function MealPlanSummary() {
  const t = useTranslations("meals.plan");
  const { snapshot } = useKitchenData();
  const rows = planMeals(snapshot.state);
  const cooking = rows.filter((m) => m.status === "cooking").length;
  return <>{t("summary", { count: rows.length, cooking })}</>;
}

interface Ghost {
  id: string;
  title: string;
  index: number;
  changeSetId: string;
  turn: number;
}

export function MealPlanWidget() {
  const t = useTranslations("meals.plan");
  const tAll = useTranslations();
  const announce = useAnnounce();
  const kitchenActions = useKitchenActions();
  const { actions } = useMeals();
  const finishCooking = useFinishCooking();
  const { snapshot, me, turn = 0 } = useKitchenData();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; text: string } | null>(null);
  // "Pho cancelled · Undo" stays while you visit other places (PlaceMemory).
  const [ghosts, setGhosts] = usePlaceMemory<Ghost[]>("meals.plan.ghosts", []);
  const rows = planMeals(snapshot.state);
  const liveGhosts = ghosts.filter((g) => g.turn === turn && !rows.some((m) => m.id === g.id));

  const run = async (meal: MealRow, kind: "start" | "cancel" | "done") => {
    if (busy) return;
    setBusy(meal.id);
    setFailed(null);
    kitchenActions.touched(MEAL_PLAN_WIDGET_ID);
    try {
      if (kind === "done") {
        const ok = await finishCooking(meal.id, meal.title);
        if (!ok) setFailed({ id: meal.id, text: t("failed") });
        return;
      }
      const res = kind === "start" ? await actions.startCooking(meal.id) : await actions.cancel(meal.id);
      if (!res.ok || !res.result.applied.length) {
        setFailed({ id: meal.id, text: t("failed") });
        return;
      }
      actions.showSaved(res.result);
      if (kind === "cancel") {
        setGhosts((g) => [
          ...g.filter((x) => x.turn === turn),
          { id: meal.id, title: meal.title, index: rows.findIndex((m) => m.id === meal.id), changeSetId: res.result.changeSetId, turn },
        ]);
        announce(t("cancelled", { title: meal.title }));
      } else {
        announce(t("started", { title: meal.title }));
      }
    } catch {
      setFailed({ id: meal.id, text: t("failed") });
    } finally {
      setBusy(null);
    }
  };

  const undoCancel = async (g: Ghost) => {
    try {
      const res = await kitchenActions.undo(g.changeSetId);
      if (res.ok && res.result.applied.length && !res.result.rejected.length) {
        actions.showSaved(res.result);
        setGhosts((all) => all.filter((x) => x.id !== g.id));
        announce(t("undone", { title: g.title }));
        return;
      }
    } catch {
      // fall through
    }
    setFailed({ id: g.id, text: t("cantUndo") });
    announce(t("cantUndo"));
  };

  if (rows.length === 0 && liveGhosts.length === 0) {
    return (
      <div className="card flex flex-col items-center gap-3 px-5 py-6 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- a small static SVG */}
        <img src={LUMI_ART.sleeping} alt="" width={96} height={96} className="size-sticker-lg" />
        <p className="text-body font-medium">{t("empty")}</p>
        <p className="text-small text-text-muted">{t("emptyHint")}</p>
      </div>
    );
  }

  // Ghost rows sit where the meal was, so nothing jumps.
  const items: ({ kind: "meal"; meal: MealRow } | { kind: "ghost"; ghost: Ghost })[] = rows.map((meal) => ({ kind: "meal", meal }));
  for (const g of [...liveGhosts].sort((a, b) => a.index - b.index)) items.splice(Math.min(g.index, items.length), 0, { kind: "ghost", ghost: g });

  return (
    <ul className="flex flex-col gap-3">
      {items.map((entry) =>
        entry.kind === "ghost" ? (
          <li key={`ghost-${entry.ghost.id}`} className="flex min-h-tap flex-wrap items-center gap-2 rounded-md border-2 border-dashed border-border-default px-4 py-2 text-small text-text-muted">
            <span>{t("cancelled", { title: entry.ghost.title })}</span>
            <button
              type="button"
              aria-label={t("undoCancelLabel", { title: entry.ghost.title })}
              onClick={() => void undoCancel(entry.ghost)}
              className="btn-quiet"
            >
              <UndoIcon aria-hidden="true" className="size-icon-sm" />
              {t("undo")}
            </button>
            {failed?.id === entry.ghost.id && (
              <span role="alert" className="text-error-text">
                {failed.text}
              </span>
            )}
          </li>
        ) : (
          <li
            key={entry.meal.id}
            data-entity-id={entry.meal.id}
            className={`card flex flex-col gap-3 px-5 py-4 ${entry.meal.status === "cooking" ? "border-accent-text" : ""}`}
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <button
                type="button"
                onClick={() => actions.openRecipe(entry.meal.id, { focus: true })}
                aria-label={t("openLabel", { title: entry.meal.title })}
                className="min-h-tap text-left font-heading text-title font-medium text-text-default underline decoration-border-stitch decoration-2 underline-offset-4"
              >
                {entry.meal.title}
              </button>
              {entry.meal.status === "cooking" && (
                <span className="rounded-button bg-highlight-bg px-3 py-0.5 text-caption font-strong text-highlight-text">{t("cooking")}</span>
              )}
              {byOther(entry.meal.createdBy, me.id) && (
                <span className="text-caption text-text-muted">{t("addedBy", { name: actorName(entry.meal.createdBy, tAll) })}</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {entry.meal.status === "cooking" ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  aria-label={t("doneLabel", { title: entry.meal.title })}
                  onClick={() => void run(entry.meal, "done")}
                  className="btn btn-primary btn-small"
                >
                  {t("done")}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy !== null}
                  aria-label={t("startLabel", { title: entry.meal.title })}
                  onClick={() => void run(entry.meal, "start")}
                  className="btn btn-small"
                >
                  {t("start")}
                </button>
              )}
              <button
                type="button"
                disabled={busy !== null}
                aria-label={t("cancelLabel", { title: entry.meal.title })}
                onClick={() => void run(entry.meal, "cancel")}
                className="btn-quiet text-small"
              >
                {t("cancel")}
              </button>
            </div>
            {failed?.id === entry.meal.id && (
              <p role="alert" className="rounded-md bg-error-bg px-3 py-2 text-small text-error-text">
                {failed.text}
              </p>
            )}
          </li>
        ),
      )}
    </ul>
  );
}
