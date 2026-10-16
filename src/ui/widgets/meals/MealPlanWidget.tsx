"use client";
/**
 * Meal plan (ux.md §3, decisions 0008, 0013; dated week 0045 KOS1, 0058).
 * - **The week:** a rolling 7 days from today (KOS1-c), Today highlighted. Each day lists its
 *   meals; an empty day is one quiet line. **Earlier** (e.g. yesterday) and **Later** show only
 *   when they have meals; **No day yet** holds undated ones and leads while nothing has a day
 *   (every kitchen planned before KOS1), so those meals aren't under seven empty days.
 * - **Each meal:** tap the name for its Recipe; Start cooking / Done cooking; Cancel (leaves
 *   "cancelled · Undo" in its place until your next message); and the **day pill** (`DayPicker`),
 *   which sets, moves or clears its day. The "What changed" receipt with Undo shows under the meal
 *   wherever it lands, with focus on it.
 * The grouping is the shared pure `buildWeekPlan`, so this works offline from the cached state;
 * the day pill needs a connection until KOS7 (0044). Done cooking opens "Update your kitchen".
 */
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { MealRow } from "@/contracts/kitchen-state";
import type { WeekPlan } from "@/contracts/week-plan";
import { buildWeekPlan } from "@/shared/week-plan";
import { useAnnounce } from "@/ui/a11y/Announcer";
import { toReceipt, type Receipt as ReceiptModel } from "@/ui/chat/chat-reducer";
import { useFormatMsg } from "@/ui/chat/format-msg";
import { Receipt } from "@/ui/chat/Receipt";
import { useReceiptUndo } from "@/ui/chat/useReceiptUndo";
import { actorName, byOther } from "@/ui/fallbacks";
import { LumiHalo } from "@/ui/lumi/Lumi";
import { usePlaceMemory } from "@/ui/places/PlaceMemory";
import { formatPlanDay } from "@/ui/plan-day-format";
import { UndoIcon } from "@/ui/primitives/icons";
import { useKitchenActions } from "@/ui/sync/KitchenActionsContext";
import { useKitchenData } from "@/ui/sync/KitchenDataContext";
import { usePlanToday } from "@/ui/sync/time-zone";
import { useOnline } from "@/ui/sync/useOnline";
import { MealNoticeLine } from "@/ui/widgets/kitchen/ToReview";
import { DayPicker } from "./DayPicker";
import { useMeals } from "./MealsContext";
import { useFinishCooking } from "./useFinishCooking";
import { WeekNeedsAdd } from "./WeekNeedsSheet";
import { relativeDay, undatedFirst } from "./week-model";

export const MEAL_PLAN_WIDGET_ID = "meals.plan";

export function planMeals(state: { plan: string[]; meals: MealRow[] } | null): MealRow[] {
  if (!state) return [];
  const rows = state.plan.flatMap((id) => state.meals.filter((m) => m.id === id));
  // Cooking first, then planned in the order added (0013); the backend already orders `plan` that way.
  return [...rows.filter((m) => m.status === "cooking"), ...rows.filter((m) => m.status !== "cooking")];
}

/** The Plan place: the latest "Update your kitchen" result (with Undo), the week's needs, then the week. */
export function PlanPlace() {
  return (
    <>
      <MealNoticeLine />
      <WeekNeedsAdd />
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

/** Which group a meal is drawn in: a day ("2026-10-20"), or earlier / later / undated. */
type GroupKey = string;

interface Ghost {
  id: string;
  title: string;
  group: GroupKey;
  index: number;
  changeSetId: string;
  turn: number;
}

/** The receipt under the meal whose day you just changed (until your next message). */
interface DayNote {
  mealId: string;
  receipt: ReceiptModel;
  turn: number;
}

function groupsOf(week: WeekPlan): Map<GroupKey, string[]> {
  const groups = new Map<GroupKey, string[]>();
  groups.set("earlier", week.earlier);
  for (const d of week.days) groups.set(d.date, d.mealIds);
  groups.set("later", week.later);
  groups.set("undated", week.undated);
  return groups;
}

export function MealPlanWidget() {
  const t = useTranslations("meals.plan");
  const announce = useAnnounce();
  const formatMsg = useFormatMsg();
  const undoReceipt = useReceiptUndo();
  const kitchenActions = useKitchenActions();
  const { actions } = useMeals();
  const finishCooking = useFinishCooking();
  const { snapshot, turn = 0, now } = useKitchenData();
  const online = useOnline();
  const today = usePlanToday(now);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; text: string } | null>(null);
  // "Pho cancelled · Undo" and the day receipt stay while you visit other places (PlaceMemory).
  const [ghosts, setGhosts] = usePlaceMemory<Ghost[]>("meals.plan.ghosts", []);
  const [storedNote, setDayNote] = usePlaceMemory<DayNote | null>("meals.plan.dayNote", null);
  const dayNote = storedNote && storedNote.turn === turn ? storedNote : null;
  // A new day receipt takes focus once drawn; one already there when you arrive doesn't.
  const focusedNote = useRef(storedNote?.receipt.changeSetId ?? null);
  const offlineId = useId();
  // Days need a connection until KOS7 (0044); a stale or failed kitchen means we're offline too.
  const offline = !online || snapshot.status === "stale" || snapshot.status === "error";

  const rows = planMeals(snapshot.state);
  const byId = new Map(rows.map((m) => [m.id, m]));
  const rank = new Map(rows.map((m, i) => [m.id, i]));
  const week = buildWeekPlan(snapshot.state ?? { meals: [], plan: [] }, today);
  const groups = groupsOf(week);
  const liveGhosts = ghosts.filter((g) => g.turn === turn && !byId.has(g.id));

  // After a day change, focus follows the meal to its new day: onto its receipt.
  useEffect(() => {
    const id = dayNote?.receipt.changeSetId;
    if (!id || focusedNote.current === id) return;
    focusedNote.current = id;
    const focus = () => document.querySelector<HTMLElement>(`[data-day-note="${CSS.escape(id)}"]`)?.focus();
    focus();
    // The menu hands focus back to its trigger as it closes; take it once more after that.
    const frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [dayNote]);

  const groupOfMeal = (id: string): { group: GroupKey; index: number } => {
    for (const [group, ids] of groups) {
      const index = ids.indexOf(id);
      if (index >= 0) return { group, index };
    }
    return { group: "undated", index: 0 };
  };

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
          { id: meal.id, title: meal.title, ...groupOfMeal(meal.id), changeSetId: res.result.changeSetId, turn },
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

  const pickDay = async (meal: MealRow, date: string | null) => {
    if (busy || offline) return;
    setBusy(meal.id);
    setFailed(null);
    kitchenActions.touched(MEAL_PLAN_WIDGET_ID);
    try {
      const res = await actions.setMealDate(meal.id, date);
      if (res.ok && (res.result.applied.length || res.result.rejected.length)) {
        if (res.result.applied.length) actions.showSaved(res.result);
        // A refusal (e.g. DATE_OUT_OF_WINDOW) shows in the same receipt, under the meal.
        setDayNote({ mealId: meal.id, receipt: toReceipt(res.result), turn });
        announce(
          [...res.result.applied.map((a) => formatMsg(a.summary, "plain")), ...res.result.rejected.map((r) => formatMsg(r.reason, "plain"))].join(" "),
        );
        return;
      }
    } catch {
      // fall through: say so in place (0018)
    } finally {
      setBusy(null);
    }
    setFailed({ id: meal.id, text: t("dayFailed") });
    announce(t("dayFailed"));
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

  const undoDay = () => {
    if (!dayNote) return;
    void undoReceipt(dayNote.receipt, (undo) => setDayNote({ ...dayNote, receipt: { ...dayNote.receipt, undo } }));
  };

  if (rows.length === 0 && liveGhosts.length === 0) {
    return (
      <div className="card flex flex-col items-center gap-3 px-5 py-6 text-center">
        <LumiHalo state="sleep" size="lumi" />
        <p className="text-body font-medium">{t("empty")}</p>
        <p className="text-small text-text-muted">{t("emptyHint")}</p>
      </div>
    );
  }

  /** One group's meals, with cancelled ghosts back where they were, so nothing jumps. */
  const mealList = (group: GroupKey, ids: string[]) => {
    // Cooking first within each group, then plan order (0013), as the undated list always was.
    const ordered = [...ids].filter((id) => byId.has(id)).sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
    const items: ({ kind: "meal"; meal: MealRow } | { kind: "ghost"; ghost: Ghost })[] = ordered.map((id) => ({ kind: "meal" as const, meal: byId.get(id)! }));
    for (const g of liveGhosts.filter((x) => x.group === group).sort((a, b) => a.index - b.index)) {
      items.splice(Math.min(g.index, items.length), 0, { kind: "ghost", ghost: g });
    }
    if (items.length === 0) return null;
    return (
      <ul className="flex flex-col gap-2">
        {items.map((entry) =>
          entry.kind === "ghost" ? (
            <GhostRow key={`ghost-${entry.ghost.id}`} ghost={entry.ghost} failed={failed?.id === entry.ghost.id ? failed.text : null} onUndo={() => void undoCancel(entry.ghost)} />
          ) : (
            <MealCard
              key={entry.meal.id}
              meal={entry.meal}
              week={week}
              busy={busy !== null}
              offline={offline}
              offlineId={offlineId}
              failed={failed?.id === entry.meal.id ? failed.text : null}
              note={dayNote?.mealId === entry.meal.id ? dayNote : null}
              onRun={(kind) => void run(entry.meal, kind)}
              onPickDay={(date) => void pickDay(entry.meal, date)}
              onUndoDay={undoDay}
            />
          ),
        )}
      </ul>
    );
  };

  const undatedList = mealList("undated", week.undated);
  const leadUndated = undatedFirst(week);
  const undated = undatedList && (
    <PlanGroup key="undated" name={t("undated")} hint={leadUndated ? t("undatedHint") : undefined} data-plan-group="undated">
      {undatedList}
    </PlanGroup>
  );
  const earlier = mealList("earlier", week.earlier);
  const later = mealList("later", week.later);

  return (
    <div data-week-plan="" className="flex flex-col gap-5">
      {offline && (
        <p id={offlineId} className="text-small text-text-muted">
          {t("offline")}
        </p>
      )}
      {leadUndated && undated}
      {earlier && (
        <PlanGroup name={t("earlier")} data-plan-group="earlier">
          {earlier}
        </PlanGroup>
      )}
      <PlanGroup name={t("weekLabel")} data-plan-group="week">
        <ol className="flex flex-col gap-2">
          {week.days.map((day) => (
            <DayRow key={day.date} date={day.date} today={today} count={day.mealIds.length}>
              {mealList(day.date, day.mealIds)}
            </DayRow>
          ))}
        </ol>
      </PlanGroup>
      {later && (
        <PlanGroup name={t("later")} data-plan-group="later">
          {later}
        </PlanGroup>
      )}
      {!leadUndated && undated}
    </div>
  );
}

function PlanGroup({ name, hint, children, ...data }: { name: string; hint?: string; children: ReactNode; [data: `data-${string}`]: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2" {...data}>
      <div>
        <h2 id={id} className="section-label">
          {name}
        </h2>
        {hint && <p className="text-small text-text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** One day: a date tile, then its meals, or a quiet "Nothing planned". */
function DayRow({ date, today, count, children }: { date: string; today: string; count: number; children: ReactNode }) {
  const t = useTranslations("meals.plan");
  const locale = useLocale();
  const id = useId();
  const rel = relativeDay(date, today);
  const isToday = rel === "today";
  const empty = count === 0 && !children;
  const full = formatPlanDay(date, locale, "long");
  const tile = isToday
    ? "day-tile-today"
    : empty
      ? "bg-surface-sunken text-text-muted"
      : "bg-surface-soft text-accent-text";
  return (
    <li aria-labelledby={id} data-day={date} data-today={isToday ? "" : undefined} data-empty={empty ? "" : undefined} className="flex flex-col gap-2">
      {/* The day's header: its tile, then "Today" / "Tomorrow" or the quiet "Nothing planned". Its
          meals go full width underneath, so a card's buttons fit on one line on a phone. */}
      <div className="flex items-center gap-3">
        <div aria-hidden="true" className={`flex w-tile shrink-0 flex-col items-center justify-center rounded-tile py-1 ${tile} ${empty ? "min-h-tap" : "min-h-tile"}`}>
          <span className="text-caption font-strong uppercase">{formatPlanDay(date, locale, "weekdayShort")}</span>
          <span className={`font-heading font-medium ${empty ? "text-body" : "text-title"}`}>{formatPlanDay(date, locale, "dayNumber")}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 id={id} className="sr-only">
            {rel ? t("dayName", { name: t(rel), date: full }) : full}
          </h3>
          {rel && rel !== "yesterday" && (
            <p aria-hidden="true" className={`text-caption font-strong uppercase ${isToday ? "text-accent-text" : "text-text-muted"}`}>
              {t(rel)}
            </p>
          )}
          {empty ? (
            <p className="text-small text-text-muted">{t("nothingPlanned")}</p>
          ) : (
            !rel && (
              <p aria-hidden="true" className="text-caption font-strong text-accent-text uppercase">
                {formatPlanDay(date, locale, "weekday")}
              </p>
            )
          )}
        </div>
      </div>
      {!empty && children}
    </li>
  );
}

function GhostRow({ ghost, failed, onUndo }: { ghost: Ghost; failed: string | null; onUndo: () => void }) {
  const t = useTranslations("meals.plan");
  return (
    <li className="flex min-h-tap flex-wrap items-center gap-2 rounded-md border-2 border-dashed border-border-default px-4 py-2 text-small text-text-muted">
      <span>{t("cancelled", { title: ghost.title })}</span>
      <button type="button" aria-label={t("undoCancelLabel", { title: ghost.title })} onClick={onUndo} className="btn-quiet">
        <UndoIcon aria-hidden="true" className="size-icon-sm" />
        {t("undo")}
      </button>
      {failed && (
        <span role="alert" className="text-error-text">
          {failed}
        </span>
      )}
    </li>
  );
}

function MealCard({
  meal,
  week,
  busy,
  offline,
  offlineId,
  failed,
  note,
  onRun,
  onPickDay,
  onUndoDay,
}: {
  meal: MealRow;
  week: WeekPlan;
  busy: boolean;
  offline: boolean;
  offlineId: string;
  failed: string | null;
  note: DayNote | null;
  onRun: (kind: "start" | "cancel" | "done") => void;
  onPickDay: (date: string | null) => void;
  onUndoDay: () => void;
}) {
  const t = useTranslations("meals.plan");
  const tAll = useTranslations();
  const { me } = useKitchenData();
  const { actions } = useMeals();
  const cooking = meal.status === "cooking";
  return (
    <li data-entity-id={meal.id} data-planned-for={meal.plannedFor ?? ""} className={`card flex flex-col gap-3 px-4 py-3 ${cooking ? "border-accent-text" : ""}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <button
          type="button"
          onClick={() => actions.openRecipe(meal.id, { focus: true })}
          aria-label={t("openLabel", { title: meal.title })}
          className="min-h-tap text-left font-heading text-title font-medium text-text-default underline decoration-accent-default decoration-2 underline-offset-4"
        >
          {meal.title}
        </button>
        {cooking && <span className="rounded-button bg-highlight-bg px-3 py-0.5 text-caption font-strong text-highlight-text">{t("cooking")}</span>}
        {byOther(meal.createdBy, me.id) && <span className="text-caption text-text-muted">{t("addedBy", { name: actorName(meal.createdBy, tAll) })}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <DayPicker
          title={meal.title}
          date={meal.plannedFor}
          today={week.today}
          window={week.window}
          mode="change"
          disabled={busy || offline}
          describedBy={offline ? offlineId : undefined}
          onPick={onPickDay}
        />
        {cooking ? (
          <button type="button" disabled={busy} aria-label={t("doneLabel", { title: meal.title })} onClick={() => onRun("done")} className="btn btn-primary btn-small">
            {t("done")}
          </button>
        ) : (
          <button type="button" disabled={busy} aria-label={t("startLabel", { title: meal.title })} onClick={() => onRun("start")} className="btn btn-small">
            {t("start")}
          </button>
        )}
        <button type="button" disabled={busy} aria-label={t("cancelLabel", { title: meal.title })} onClick={() => onRun("cancel")} className="btn-quiet text-small">
          {t("cancel")}
        </button>
      </div>
      {failed && (
        <p role="alert" className="rounded-md bg-error-bg px-3 py-2 text-small text-error-text">
          {failed}
        </p>
      )}
      {note && (
        <div tabIndex={-1} data-day-note={note.receipt.changeSetId} className="outline-none">
          <Receipt receipt={note.receipt} onUndo={onUndoDay} />
        </div>
      )}
    </li>
  );
}
