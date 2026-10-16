"use client";
/**
 * "Add this week's missing ingredients" on the Plan place (0045 KOS12, 0058 KOS1-a), the Restock
 * pattern (0054): a white pill under the Plan header opens one sheet (bottom sheet on a phone,
 * centred dialog on desktop) from `loadWeekNeeds`.
 * - **Missing** (each recipe's Need group across the week, merged): pre-selected, each with the
 *   meal(s) that need it. **On your list**: muted, no box. A meal with no recipe yet says so.
 * - **Dated only** (off by default, KOS1-a): leaves out meals with no day yet, and reloads.
 * - **Add N to my list** = one change set (source `week-plan`): the sheet closes and the "What
 *   changed" receipt with one Undo shows under the pill (PlaceMemory, until your next message),
 *   with focus on it.
 * - **States:** loading, error (Retry; nothing else touched), nothing to add, add failed (choices
 *   kept), WEEK_NEEDS_NONE (it all got on the list meanwhile: say so and refresh), offline (the
 *   pill is off with "Back online to add ingredients"; KOS7 brings offline buttons). Someone
 *   else's change while it's open refreshes it, keeping your choices. Never crashes the Plan (0018).
 */
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ApplyResult } from "@/contracts/apply-result";
import type { WeekNeeds, WeekNeedsItem } from "@/contracts/week-plan";
import { useAnnounce } from "@/ui/a11y/Announcer";
import { toReceipt, type Receipt as ReceiptModel } from "@/ui/chat/chat-reducer";
import { useFormatMsg } from "@/ui/chat/format-msg";
import { Receipt } from "@/ui/chat/Receipt";
import { useReceiptUndo } from "@/ui/chat/useReceiptUndo";
import { itemName } from "@/ui/fallbacks";
import { LumiHalo } from "@/ui/lumi/Lumi";
import { usePlaceMemory } from "@/ui/places/PlaceMemory";
import { Checkbox } from "@/ui/primitives/Checkbox";
import { Dialog } from "@/ui/primitives/Dialog";
import { CloseIcon, RestockIcon } from "@/ui/primitives/icons";
import { Switch } from "@/ui/primitives/Switch";
import { useKitchenActions } from "@/ui/sync/KitchenActionsContext";
import { useKitchenData } from "@/ui/sync/KitchenDataContext";
import { useOnline } from "@/ui/sync/useOnline";
import { useMeals } from "./MealsContext";
import { chosenNeedNames, needsGroups, noRecipeTitles, preselectedNeeds } from "./week-model";

const PLAN_WIDGET_ID = "meals.plan";

interface NeedsNote {
  receipt: ReceiptModel;
  turn: number;
}

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; needs: WeekNeeds };

/** The pill, its receipt and the sheet. Shown once the plan has a meal (or a receipt to keep). */
export function WeekNeedsAdd() {
  const t = useTranslations("meals.weekNeeds");
  const announce = useAnnounce();
  const formatMsg = useFormatMsg();
  const actions = useKitchenActions();
  const undoReceipt = useReceiptUndo();
  const { snapshot, turn = 0 } = useKitchenData();
  const online = useOnline();
  const offline = !online || snapshot.status === "stale";
  const [open, setOpen] = useState(false);
  const [opens, setOpens] = useState(0);
  const [stored, setNote] = usePlaceMemory<NeedsNote | null>("meals.weekNeeds.note", null);
  const note = stored && stored.turn === turn ? stored : null;
  const pillRef = useRef<HTMLButtonElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  const justAdded = useRef(false);
  const focusNote = useRef(false);
  const hasPlan = (snapshot.state?.plan.length ?? 0) > 0;

  const onAdded = (result: ApplyResult) => {
    actions.showOwn(result, { highlight: true });
    justAdded.current = true;
    focusNote.current = true;
    setNote({ receipt: toReceipt(result), turn });
    setOpen(false);
    announce(result.applied.map((a) => formatMsg(a.summary, "plain")).join(", "));
  };

  const finalFocus = useCallback(() => (justAdded.current && noteRef.current) || pillRef.current || true, []);
  useEffect(() => {
    if (open || !focusNote.current) return;
    focusNote.current = false;
    noteRef.current?.focus();
    const frame = requestAnimationFrame(() => noteRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, note]);

  if (!hasPlan && !note) return null;

  return (
    <div className="flex flex-col items-start gap-2">
      {hasPlan && (
        <button
          ref={pillRef}
          type="button"
          onClick={() => {
            justAdded.current = false;
            setOpens((n) => n + 1);
            setOpen(true);
            actions.touched(PLAN_WIDGET_ID);
          }}
          disabled={offline}
          aria-haspopup="dialog"
          aria-describedby={offline ? "week-needs-offline" : undefined}
          className="btn"
        >
          <RestockIcon aria-hidden="true" className="size-icon text-accent-text" />
          {t("open")}
        </button>
      )}
      {hasPlan && offline && (
        <p id="week-needs-offline" className="text-small text-text-muted">
          {t("offline")}
        </p>
      )}
      {note && (
        <div ref={noteRef} tabIndex={-1} data-week-needs-note={note.receipt.changeSetId} className="w-full outline-none">
          <Receipt
            receipt={note.receipt}
            onUndo={() => void undoReceipt(note.receipt, (undo) => setNote({ ...note, receipt: { ...note.receipt, undo } }))}
          />
        </div>
      )}
      <Dialog.Root open={open} onOpenChange={(next) => !next && setOpen(false)}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-scrim" />
          {/* Always drawn while the dialog closes (Base UI finishes its exit on the popup; unmounting it
              early leaves the backdrop over the page). A new key per open starts it fresh. */}
          <SheetBody key={opens} offline={offline || snapshot.status === "error"} onAdded={onAdded} onClose={() => setOpen(false)} finalFocus={finalFocus} />
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

export function SheetBody({
  offline,
  onAdded,
  onClose,
  finalFocus,
}: {
  offline: boolean;
  onAdded: (result: ApplyResult) => void;
  onClose: () => void;
  finalFocus?: () => HTMLElement | true;
}) {
  const t = useTranslations("meals.weekNeeds");
  const format = useFormatter();
  const announce = useAnnounce();
  const { actions } = useMeals();
  const { snapshot } = useKitchenData();
  const version = snapshot.state?.version;
  const [includeUndated, setIncludeUndated] = useState(true);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  // Null until you change it: the pre-selection follows what loads.
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [noneLeft, setNoneLeft] = useState(false);
  const request = useRef(0);
  const errorId = useId();
  const switchId = useId();
  const hintId = useId();

  const reload = useCallback(
    async (quiet: boolean) => {
      const id = ++request.current;
      if (!quiet) setLoad({ status: "loading" });
      let needs: WeekNeeds | null = null;
      try {
        needs = await actions.loadWeekNeeds({ includeUndated });
      } catch {
        needs = null;
      }
      if (id !== request.current) return; // a newer load (the toggle) wins
      setLoad(needs ? { status: "ready", needs } : { status: "error" });
    },
    [actions, includeUndated],
  );

  // Load on open and whenever Dated only changes; someone else's change refreshes quietly.
  const loadedFor = useRef<{ includeUndated: boolean; version: number | undefined } | null>(null);
  useEffect(() => {
    const last = loadedFor.current;
    loadedFor.current = { includeUndated, version };
    if (last && last.includeUndated === includeUndated && last.version === version) return;
    const quiet = last !== null && last.includeUndated === includeUndated;
    void reload(quiet);
  }, [includeUndated, version, reload]);

  const needs = load.status === "ready" ? load.needs : null;
  const selected = picked ?? (needs ? preselectedNeeds(needs) : new Set<string>());
  const chosen = needs ? chosenNeedNames(needs, selected) : [];

  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  };

  const setDatedOnly = (datedOnly: boolean) => {
    setPicked(null);
    setNoneLeft(false);
    setFailed(false);
    setIncludeUndated(!datedOnly);
  };

  const add = async () => {
    if (busy || offline || chosen.length === 0) return;
    setBusy(true);
    setFailed(false);
    setNoneLeft(false);
    try {
      const res = await actions.addWeekNeedsToList({ includeUndated, names: chosen });
      if (res.ok && res.result.applied.length) {
        onAdded(res.result);
        return;
      }
      if (!res.ok && res.reason.code === "WEEK_NEEDS_NONE") {
        // It all went on the list (or into the kitchen) meanwhile: say so and show the latest.
        setBusy(false);
        setPicked(null);
        setNoneLeft(true);
        announce(t("noneLeft"));
        void reload(true);
        return;
      }
    } catch {
      // fall through: say so, keep the choices
    }
    setBusy(false);
    setFailed(true);
    announce(t("addFailed"));
  };

  let body;
  if (load.status === "loading") {
    body = (
      <div aria-busy="true" data-week-needs-loading="" className="flex flex-col gap-2">
        <p className="sr-only">{t("loading")}</p>
        {[0, 1, 2].map((i) => (
          <div key={i} data-placeholder="" className="h-tap rounded-md bg-surface-sunken" />
        ))}
      </div>
    );
  } else if (load.status === "error") {
    body = (
      <p data-week-needs-error="" className="flex flex-wrap items-center gap-2 rounded-md bg-error-bg px-4 py-3 text-small text-error-text">
        {t("error")}
        <button type="button" onClick={() => void reload(false)} className="btn-quiet underline">
          {t("retry")}
        </button>
      </p>
    );
  } else {
    body = <NeedsGroups needs={load.needs} includeUndated={includeUndated} selected={selected} onToggle={toggle} />;
  }

  const noRecipe = needs ? noRecipeTitles(needs) : [];
  const canAdd = needs !== null && needsGroups(needs).need.length > 0;

  return (
    <Dialog.Popup
      finalFocus={finalFocus}
      aria-describedby={failed ? errorId : undefined}
      data-week-needs-sheet=""
      className="sheet fixed inset-x-0 bottom-(--keyboard-inset) z-50 flex max-h-[calc(85dvh-var(--keyboard-inset))] flex-col gap-3 rounded-t-sheet bg-surface-raised px-5 pt-5 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-pop outline-none desk:inset-x-auto desk:top-1/2 desk:bottom-auto desk:left-1/2 desk:max-h-[85dvh] desk:w-[30rem] desk:-translate-x-1/2 desk:-translate-y-1/2 desk:rounded-sheet"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <Dialog.Title className="font-heading text-title font-medium">{t("title")}</Dialog.Title>
          <Dialog.Description className="text-small text-text-muted">{includeUndated ? t("descriptionAll") : t("descriptionDated")}</Dialog.Description>
        </div>
        <button type="button" onClick={onClose} aria-label={t("close")} className="btn-icon -mt-2 -mr-2">
          <CloseIcon aria-hidden="true" className="size-icon" />
        </button>
      </div>

      <div className="flex items-center gap-3 rounded-md bg-surface-sunken px-3 py-1">
        <div className="flex flex-1 flex-col">
          <span id={switchId} className="text-body font-medium">
            {t("datedOnly")}
          </span>
          <span id={hintId} className="text-small text-text-muted">
            {t("datedOnlyHint")}
          </span>
        </div>
        <Switch checked={!includeUndated} onChange={setDatedOnly} labelledBy={switchId} describedBy={hintId} data-dated-only="" />
      </div>

      {offline && <p className="rounded-md bg-surface-sunken px-3 py-2 text-small text-text-muted">{t("offline")}</p>}

      <div className="-mx-2 flex min-h-0 flex-col gap-4 overflow-y-auto px-2 py-1">
        {noneLeft && (
          <p role="status" className="rounded-md bg-info-bg px-3 py-2 text-small text-info-text">
            {t("noneLeft")}
          </p>
        )}
        {body}
        {noRecipe.length > 0 && (
          <p data-no-recipe="" className="text-small text-text-muted">
            {t("noRecipe", { titles: format.list(noRecipe, { type: "conjunction" }), count: noRecipe.length })}
          </p>
        )}
      </div>

      {failed && (
        <p id={errorId} role="alert" className="flex flex-wrap items-center gap-2 rounded-md bg-error-bg px-3 py-2 text-small text-error-text">
          {t("addFailed")}
          <button type="button" onClick={() => void add()} className="btn-quiet">
            {t("tryAgain")}
          </button>
        </p>
      )}

      {canAdd && (
        <button type="button" onClick={() => void add()} disabled={offline || chosen.length === 0} aria-disabled={busy || undefined} className="btn btn-primary w-full">
          {busy ? t("adding") : t("add", { count: chosen.length })}
        </button>
      )}
    </Dialog.Popup>
  );
}

/** Missing (pre-selected, with the meals that need each) · On your list (muted) · or why there's nothing. */
function NeedsGroups({
  needs,
  includeUndated,
  selected,
  onToggle,
}: {
  needs: WeekNeeds;
  includeUndated: boolean;
  selected: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  const t = useTranslations("meals.weekNeeds");
  const tAll = useTranslations();
  const locale = useLocale();
  const format = useFormatter();
  const onListId = useId();
  const { need, onList } = needsGroups(needs);
  const name = (i: WeekNeedsItem) => itemName(i.name, tAll, locale);
  const mealsOf = (i: WeekNeedsItem) => format.list(i.meals.map((m) => m.title), { type: "conjunction" });

  if (needs.meals.length === 0) {
    return (
      <div data-week-needs-empty="no-meals" className="card flex flex-col items-center gap-3 px-5 py-6 text-center">
        <LumiHalo state="sleep" size="lumi" />
        <p className="text-body font-medium">{includeUndated ? t("noMeals") : t("noDatedMeals")}</p>
      </div>
    );
  }

  return (
    <>
      {need.length === 0 ? (
        <p data-week-needs-empty={onList.length ? "all-on-list" : "all-have"} className="card px-4 py-3 text-body font-medium">
          {onList.length ? t("allOnList") : t("allHave")}
        </p>
      ) : (
        <fieldset className="flex flex-col">
          <legend className="section-label mb-1 text-text-default">{t("need")}</legend>
          {need.map((i) => (
            <NeedRow
              key={i.standardName}
              item={i}
              name={name(i)}
              meals={mealsOf(i)}
              checked={selected.has(i.standardName)}
              onToggle={() => onToggle(i.standardName)}
            />
          ))}
        </fieldset>
      )}
      {onList.length > 0 && (
        <section aria-labelledby={onListId}>
          <h3 id={onListId} className="section-label mb-1">
            {t("onList")}
          </h3>
          <ul className="flex flex-col">
            {onList.map((i) => (
              <li key={i.standardName} data-week-need={i.standardName} data-on-list="" className="flex min-h-tap items-center gap-3 px-1 text-text-muted">
                <span className="w-[30px]" aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body">{name(i)}</span>
                  <span className="text-small">{t("forMeals", { meals: mealsOf(i) })}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** One missing ingredient: the whole row is the checkbox's label (a big tap target). */
function NeedRow({ item, name, meals, checked, onToggle }: { item: WeekNeedsItem; name: string; meals: string; checked: boolean; onToggle: () => void }) {
  const t = useTranslations("meals.weekNeeds");
  const id = useId();
  return (
    <div data-week-need={item.standardName} className="flex min-h-tap items-center gap-3 rounded-md px-1 py-1">
      <Checkbox id={id} checked={checked} onChange={onToggle} aria-label={t("checkLabel", { name, meals })} />
      <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer flex-col">
        <span className="text-body font-strong">{name}</span>
        <span className="text-small text-text-muted">{t("forMeals", { meals })}</span>
      </label>
    </div>
  );
}
