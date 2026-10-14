"use client";
/**
 * Meal plan (ux.md §3, decisions 0008, 0013): a short undated list, **Cooking** meals first, then
 * planned ones in the order added, with "Added by Levi" where relevant. Tap a meal for its Recipe.
 * Start cooking / Done cooking; Cancel (the kitchen is unchanged) leaves "cancelled · Undo" in its
 * place until your next message. Done cooking opens "Update your kitchen".
 */
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { MealRow } from "@/contracts/kitchen-state";
import { useAnnounce } from "@/ui/a11y/Announcer";
import { actorName } from "@/ui/fallbacks";
import { UndoIcon } from "@/ui/primitives/icons";
import { useKitchenActions } from "@/ui/sync/KitchenActionsContext";
import { useKitchenData } from "@/ui/sync/KitchenDataContext";
import { useMeals } from "./MealsContext";
import { useFinishCooking } from "./useFinishCooking";

export const MEAL_PLAN_WIDGET_ID = "meals.plan";

export function planMeals(state: { plan: string[]; meals: MealRow[] } | null): MealRow[] {
  if (!state) return [];
  const rows = state.plan.flatMap((id) => state.meals.filter((m) => m.id === id));
  // Cooking first, then planned in the order added (0013); the backend already orders `plan` that way.
  return [...rows.filter((m) => m.status === "cooking"), ...rows.filter((m) => m.status !== "cooking")];
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
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
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
    return <p className="text-body text-text-muted">{t("empty")}</p>;
  }

  // Ghost rows sit where the meal was, so nothing jumps.
  const items: ({ kind: "meal"; meal: MealRow } | { kind: "ghost"; ghost: Ghost })[] = rows.map((meal) => ({ kind: "meal", meal }));
  for (const g of [...liveGhosts].sort((a, b) => a.index - b.index)) items.splice(Math.min(g.index, items.length), 0, { kind: "ghost", ghost: g });

  return (
    <ul className="flex flex-col divide-y divide-border-default">
      {items.map((entry) =>
        entry.kind === "ghost" ? (
          <li key={`ghost-${entry.ghost.id}`} className="flex flex-wrap min-h-tap items-center gap-2 py-2 text-small text-text-muted">
            <span>{t("cancelled", { title: entry.ghost.title })}</span>
            <button
              type="button"
              aria-label={t("undoCancelLabel", { title: entry.ghost.title })}
              onClick={() => void undoCancel(entry.ghost)}
              className="flex min-h-tap items-center gap-1 rounded-button px-3 font-strong text-accent-text"
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
          <li key={entry.meal.id} data-entity-id={entry.meal.id} className="flex flex-col gap-2 py-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <button
                type="button"
                onClick={() => actions.openRecipe(entry.meal.id, { focus: true })}
                aria-label={t("openLabel", { title: entry.meal.title })}
                className="min-h-tap text-left text-title font-strong text-accent-text underline-offset-4 hover:underline"
              >
                {entry.meal.title}
              </button>
              {entry.meal.status === "cooking" && (
                <span className="rounded-button bg-highlight-bg px-2 text-caption font-strong text-highlight-text">{t("cooking")}</span>
              )}
              {!("missing" in entry.meal.createdBy) && entry.meal.createdBy.id !== me.id && (
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
                  className="min-h-tap rounded-button bg-accent-default px-4 text-small font-strong text-text-inverse disabled:opacity-60"
                >
                  {t("done")}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy !== null}
                  aria-label={t("startLabel", { title: entry.meal.title })}
                  onClick={() => void run(entry.meal, "start")}
                  className="min-h-tap rounded-button border border-border-strong bg-surface-raised px-4 text-small font-strong disabled:opacity-60"
                >
                  {t("start")}
                </button>
              )}
              <button
                type="button"
                disabled={busy !== null}
                aria-label={t("cancelLabel", { title: entry.meal.title })}
                onClick={() => void run(entry.meal, "cancel")}
                className="min-h-tap rounded-button px-3 text-small font-medium text-accent-text disabled:opacity-60"
              >
                {t("cancel")}
              </button>
            </div>
            {failed?.id === entry.meal.id && (
              <p role="alert" className="rounded-sm bg-error-bg px-3 py-2 text-small text-error-text">
                {failed.text}
              </p>
            )}
          </li>
        ),
      )}
    </ul>
  );
}
