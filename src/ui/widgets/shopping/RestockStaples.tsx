"use client";
/**
 * Smart staples on the List place (0054, plans/smart-staples.md §2).
 * - **Restock staples:** a white pill under the list header. It opens a bottom sheet on a phone
 *   and a centred dialog on desktop (the "Add to your kitchen?" pattern, 0002). **Need** (Out,
 *   Running low, not in yet) is pre-selected, **You have some** isn't, and **On your list** is
 *   muted with no box (SS3). **Add N to my list** is one change set: the sheet closes and the
 *   "What changed" receipt with one Undo shows under the pill, with focus on it.
 * - **Edit staples**, in the same sheet: each staple with its usual store (SS5) and ⋯ (Store… ·
 *   Remove, no confirmation: it has Undo), plus **Add a staple**. Someone else's staple shows
 *   their name. Each change gets its receipt with Undo in the sheet.
 * - **"You told me these before… Add them · Not now"** (SS2, SS8): the old "Staples: …" line,
 *   offered until answered either way, then never again.
 * - **States:** empty, all stocked, loading, error loading (Retry), add failed (choices kept),
 *   offline (the pill is off with "Back online to restock"; KOS7 brings offline Restock), and
 *   someone else's change meanwhile (the groups follow the live state; a staple that went on the
 *   list moves to On your list and leaves the selection).
 * The status words use the stock colours (amber for Running low, muted otherwise; never the
 * allergy berry). The Add pill is the focal point. Nothing here crashes the List (0018).
 */
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { ApplyResult } from "@/contracts/apply-result";
import type { KitchenState, StapleRow } from "@/contracts/kitchen-state";
import { useAnnounce } from "@/ui/a11y/Announcer";
import { toReceipt, type Receipt as ReceiptModel } from "@/ui/chat/chat-reducer";
import { useFormatMsg } from "@/ui/chat/format-msg";
import { Receipt } from "@/ui/chat/Receipt";
import { useReceiptUndo } from "@/ui/chat/useReceiptUndo";
import { actorName, itemName, sentenceCase } from "@/ui/fallbacks";
import { LumiHalo } from "@/ui/lumi/Lumi";
import { usePlaceMemory } from "@/ui/places/PlaceMemory";
import { Checkbox } from "@/ui/primitives/Checkbox";
import { Dialog, SheetBackdrop, SheetPopup, useOpenKey } from "@/ui/primitives/Dialog";
import { FoodTile, type TilePlace } from "@/ui/primitives/FoodTile";
import { AddIcon, CloseIcon, MoreIcon, RestockIcon } from "@/ui/primitives/icons";
import { Menu } from "@/ui/primitives/Menu";
import { useKitchenActions } from "@/ui/sync/KitchenActionsContext";
import { useKitchenData } from "@/ui/sync/KitchenDataContext";
import { useOnline } from "@/ui/sync/useOnline";
import { chosenIds, groupStaples, preselected, statusKey, type StatusKey } from "./staples-model";

const LIST_WIDGET_ID = "shopping.list";

/** The Restock receipt under the pill, until your next message (it survives moving between places). */
interface RestockNote {
  receipt: ReceiptModel;
  turn: number;
}

/** The one-time "You told me these before" offer, loaded on the first open. */
type OfferState = { status: "idle" | "loading" } | { status: "ready"; names: string[] | null };

const TONE: Record<StatusKey, string> = {
  out: "font-strong text-text-muted",
  low: "font-strong text-warning-text",
  missing: "font-medium text-text-muted",
  some: "font-medium text-text-muted",
  plenty: "font-medium text-text-muted",
  have: "font-medium text-text-muted",
  onList: "font-medium text-text-muted",
};

/** The pill, its receipt and the sheet. */
export function RestockStaples({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("staples");
  const announce = useAnnounce();
  const formatMsg = useFormatMsg();
  const actions = useKitchenActions();
  const undoReceipt = useReceiptUndo();
  const { snapshot, turn = 0 } = useKitchenData();
  const online = useOnline();
  // Restock needs a connection until KOS7 (0044); a stale kitchen means we're offline too.
  const offline = !online || snapshot.status === "stale";
  const [open, setOpen] = useState(false);
  const sheetKey = useOpenKey(open);
  const [stored, setNote] = usePlaceMemory<RestockNote | null>("staples.restock.note", null);
  const note = stored && stored.turn === turn ? stored : null;
  const [offer, setOffer] = usePlaceMemory<OfferState>("staples.offer", { status: "idle" });
  const pillRef = useRef<HTMLButtonElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  const justAdded = useRef(false);

  const openSheet = () => {
    justAdded.current = false;
    setOpen(true);
    actions.touched(LIST_WIDGET_ID);
    if (offer.status !== "idle") return;
    setOffer({ status: "loading" });
    actions
      .loadStaplesOffer()
      .then((found) => setOffer({ status: "ready", names: found?.names.length ? found.names : null }))
      // Couldn't ask: try again on the next open. Nothing else depends on it (0018).
      .catch(() => setOffer({ status: "idle" }));
  };

  const onAdded = (result: ApplyResult) => {
    actions.showOwn(result, { highlight: true });
    justAdded.current = true;
    focusNote.current = true;
    setNote({ receipt: toReceipt(result), turn });
    setOpen(false);
    announce(result.applied.map((a) => formatMsg(a.summary, "plain")).join(", "));
  };

  const undoNote = () => {
    if (!note) return;
    void undoReceipt(note.receipt, (undo) => setNote({ ...note, receipt: { ...note.receipt, undo } }));
  };

  // After Add, the effect below has already put focus on the receipt: the dialog leaves it there
  // (false), as handing it the receipt moved focus on to its Undo button once the sheet's exit
  // finished (0059 PF13). Otherwise focus goes back to the pill.
  const finalFocus = useCallback(() => (justAdded.current && noteRef.current ? false : pillRef.current || true), []);
  // After Add, focus goes to the receipt that replaced your choices (also after the sheet's own
  // focus return, which a closing dialog may do a frame later).
  const focusNote = useRef(false);
  useEffect(() => {
    if (open || !focusNote.current) return;
    focusNote.current = false;
    noteRef.current?.focus();
    const frame = requestAnimationFrame(() => noteRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, note]);

  return (
    <div className="flex flex-col items-start gap-2">
      <button ref={pillRef} type="button" onClick={openSheet} disabled={offline} aria-describedby={offline ? "restock-offline" : undefined} className="btn">
        <RestockIcon aria-hidden="true" className="size-icon text-accent-text" />
        {t("restock")}
      </button>
      {offline && (
        <p id="restock-offline" className="text-small text-text-muted">
          {t("offline")}
        </p>
      )}
      {note && (
        <div ref={noteRef} tabIndex={-1} data-restock-note={note.receipt.changeSetId} className="w-full outline-none">
          <Receipt receipt={note.receipt} onUndo={undoNote} />
        </div>
      )}
      <Dialog.Root open={open} onOpenChange={(next) => !next && setOpen(false)}>
        <Dialog.Portal>
          <SheetBackdrop />
          <SheetBody
            key={sheetKey}
            offline={offline || snapshot.status === "error"}
            offer={offer}
            onOfferAnswered={() => setOffer({ status: "ready", names: null })}
            onAdded={onAdded}
            onClose={() => setOpen(false)}
            onRetry={onRetry}
            finalFocus={finalFocus}
          />
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

/** The kitchen place of a staple's matched item, for its tile tint. */
function tilePlace(staple: StapleRow, state: KitchenState): TilePlace {
  const item = staple.itemId ? state.items.find((i) => i.id === staple.itemId) : undefined;
  return item?.location?.value ?? "unknown";
}

type View = "restock" | "edit";

function SheetBody({
  offline,
  offer,
  onOfferAnswered,
  onAdded,
  onClose,
  onRetry,
  finalFocus,
}: {
  offline: boolean;
  offer: OfferState;
  onOfferAnswered: () => void;
  onAdded: (result: ApplyResult) => void;
  onClose: () => void;
  onRetry: () => void;
  finalFocus: () => HTMLElement | boolean;
}) {
  const t = useTranslations("staples");
  const locale = useLocale();
  const tAll = useTranslations();
  const { snapshot } = useKitchenData();
  const actions = useKitchenActions();
  const announce = useAnnounce();
  const formatMsg = useFormatMsg();
  const undoReceipt = useReceiptUndo();
  const state = snapshot.state;
  const staples = state?.staples ?? [];
  const [view, setView] = useState<View>("restock");
  // No staples yet: the sheet is the Add field (empty state), and stays there as you add the first ones.
  if (state !== null && staples.length === 0 && view !== "edit") setView("edit");
  // Null until you change it: the pre-selection follows the live state until then (e.g. it loads).
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [change, setChange] = useState<ReceiptModel | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const changeRef = useRef<HTMLDivElement>(null);
  const focusNext = useRef<"title" | "change" | null>(null);
  const errorId = useId();

  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === "title") titleRef.current?.focus();
    if (target === "change") changeRef.current?.focus();
  });

  const selected = picked ?? preselected(staples);
  const chosen = chosenIds(staples, selected);
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const switchTo = (next: View) => {
    focusNext.current = "title";
    setView(next);
  };

  const add = async () => {
    if (busy || offline || chosen.length === 0) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await actions.restockStaples(chosen);
      if (res.ok && res.result.applied.length) {
        onAdded(res.result);
        return;
      }
    } catch {
      // fall through: say so, keep the choices
    }
    setBusy(false);
    setFailed(true);
    announce(t("addFailed"));
  };

  /** A staple edit (or the offer's Add them) saved: its receipt with Undo, announced. */
  const showChange = (result: ApplyResult, focus: boolean) => {
    actions.showOwn(result);
    setChange(toReceipt(result));
    if (focus) focusNext.current = "change";
    announce(result.applied.map((a) => formatMsg(a.summary, "plain")).join(", "));
  };

  const name = (s: StapleRow) => itemName(s.name.value, tAll, locale);
  const empty = state !== null && staples.length === 0;
  const showEdit = view === "edit";

  let body;
  if (!state) {
    body =
      snapshot.status === "error" ? (
        <p className="flex flex-wrap items-center gap-2 rounded-md bg-error-bg px-4 py-3 text-small text-error-text">
          {t("error")}
          <button type="button" onClick={onRetry} className="btn-quiet underline">
            {t("retry")}
          </button>
        </p>
      ) : (
        <div aria-busy="true" className="flex flex-col gap-2">
          <p className="sr-only">{t("loading")}</p>
          {[0, 1, 2].map((i) => (
            <div key={i} data-placeholder="" className="h-tap rounded-md bg-surface-sunken" />
          ))}
        </div>
      );
  } else if (showEdit) {
    body = <EditStaples staples={staples} state={state} offline={offline} onChange={showChange} name={name} />;
  } else {
    body = <RestockGroups staples={staples} state={state} selected={selected} onToggle={toggle} name={name} />;
  }

  return (
    <SheetPopup
      finalFocus={finalFocus}
      aria-describedby={failed ? errorId : undefined}
      data-staples-sheet={showEdit ? "edit" : "restock"}
      className="fixed inset-x-0 bottom-(--keyboard-inset) z-50 flex max-h-[calc(85dvh-var(--keyboard-inset))] flex-col gap-3 rounded-t-sheet bg-surface-raised px-5 pt-5 pb-[max(1rem,env(safe-area-inset-bottom))] outline-none desk:inset-x-auto desk:top-1/2 desk:bottom-auto desk:left-1/2 desk:max-h-[85dvh] desk:w-[30rem] desk:-translate-x-1/2 desk:-translate-y-1/2 desk:rounded-sheet"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <Dialog.Title ref={titleRef} tabIndex={-1} className="font-heading text-title font-medium outline-none">
            {view === "edit" ? t("editTitle") : t("title")}
          </Dialog.Title>
          <Dialog.Description className="text-small text-text-muted">{showEdit ? t("editDescription") : t("description")}</Dialog.Description>
        </div>
        <button type="button" onClick={onClose} aria-label={t("close")} className="btn-icon -mt-2 -mr-2">
          <CloseIcon aria-hidden="true" className="size-icon" />
        </button>
      </div>

      {offline && <p className="rounded-md bg-surface-sunken px-3 py-2 text-small text-text-muted">{t("offline")}</p>}

      <div className="-mx-2 flex min-h-0 flex-col gap-4 overflow-y-auto px-2 py-1">
        {offer.status === "ready" && offer.names && (
          <StaplesOffer names={offer.names} offline={offline} onAnswered={onOfferAnswered} onChange={(r) => showChange(r, true)} onDismissed={() => {
              focusNext.current = "title";
            }} />
        )}
        {body}
      </div>

      {change && (
        <div ref={changeRef} tabIndex={-1} data-staples-change={change.changeSetId} className="outline-none">
          <Receipt receipt={change} onUndo={() => void undoReceipt(change, (undo) => setChange({ ...change, undo }))} />
        </div>
      )}

      {failed && !showEdit && (
        <p id={errorId} role="alert" className="flex flex-wrap items-center gap-2 rounded-md bg-error-bg px-3 py-2 text-small text-error-text">
          {t("addFailed")}
          <button type="button" onClick={() => void add()} className="btn-quiet">
            {t("tryAgain")}
          </button>
        </p>
      )}

      {state && !empty && (
        <div className="flex flex-col items-stretch gap-1">
          {!showEdit && (
            <button
              type="button"
              onClick={() => void add()}
              disabled={offline || chosen.length === 0}
              aria-disabled={busy || undefined}
              className="btn btn-primary w-full"
            >
              {busy ? t("adding") : t("add", { count: chosen.length })}
            </button>
          )}
          <button type="button" onClick={() => switchTo(showEdit ? "restock" : "edit")} className="btn-quiet self-center">
            {showEdit ? t("backToRestock") : t("edit")}
          </button>
        </div>
      )}
    </SheetPopup>
  );
}

/** Need · You have some · On your list. */
function RestockGroups({
  staples,
  state,
  selected,
  onToggle,
  name,
}: {
  staples: StapleRow[];
  state: KitchenState;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  name: (s: StapleRow) => string;
}) {
  const t = useTranslations("staples");
  const { need, have, onList } = groupStaples(staples);
  const onListId = useId();

  const row = (s: StapleRow, strong: boolean) => {
    const key = statusKey(s);
    const status = t(`status.${key}`);
    return (
      <label key={s.id} data-staple={s.id} data-need={s.need} className="flex min-h-tap cursor-pointer items-center gap-3 rounded-md px-1 py-1">
        <Checkbox checked={selected.has(s.id)} onChange={() => onToggle(s.id)} aria-label={t("checkLabel", { name: name(s), status: status.toLocaleLowerCase() })} />
        <FoodTile place={tilePlace(s, state)} />
        <span className={`flex-1 text-body ${strong ? "font-strong" : "font-medium"}`}>{name(s)}</span>
        <span aria-hidden="true" className={`text-small ${TONE[key]}`}>
          {status}
        </span>
      </label>
    );
  };

  return (
    <>
      {need.length === 0 ? (
        <p data-all-stocked="" className="card px-4 py-3 text-body font-medium">
          {t("allStocked")}
        </p>
      ) : (
        <fieldset className="flex flex-col">
          <legend className="section-label mb-1 text-text-default">{t("need")}</legend>
          {need.map((s) => row(s, true))}
        </fieldset>
      )}
      {have.length > 0 && (
        <fieldset className="flex flex-col">
          <legend className="section-label mb-1">{t("have")}</legend>
          {have.map((s) => row(s, false))}
        </fieldset>
      )}
      {onList.length > 0 && (
        <section aria-labelledby={onListId}>
          <h3 id={onListId} className="section-label mb-1">
            {t("onList")}
          </h3>
          <ul className="flex flex-col">
            {onList.map((s) => (
              <li key={s.id} data-staple={s.id} data-need="on-list" className="flex min-h-tap items-center gap-3 px-1 text-text-muted">
                <span className="w-[30px]" aria-hidden="true" />
                <FoodTile place={tilePlace(s, state)} />
                <span className="flex-1 text-body">{name(s)}</span>
                <span className="sr-only">{t("status.onList")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** Edit staples: each staple with its usual store and ⋯ (Store… · Remove), then Add a staple. */
function EditStaples({
  staples,
  state,
  offline,
  onChange,
  name,
}: {
  staples: StapleRow[];
  state: KitchenState;
  offline: boolean;
  onChange: (result: ApplyResult, focus: boolean) => void;
  name: (s: StapleRow) => string;
}) {
  const t = useTranslations("staples");
  const tAll = useTranslations();
  const locale = useLocale();
  const actions = useKitchenActions();
  const announce = useAnnounce();
  const { me } = useKitchenData();
  const [editing, setEditing] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const fieldId = useId();
  const failId = useId();
  const addRef = useRef<HTMLInputElement>(null);

  /** Run a staple edit; on failure say so in place and change nothing (0018). */
  const run = async (key: string, step: () => Promise<Awaited<ReturnType<typeof actions.addStaples>>>, focus: boolean): Promise<boolean> => {
    setFailed(null);
    try {
      const res = await step();
      if (res.ok && res.result.applied.length) {
        onChange(res.result, focus);
        return true;
      }
    } catch {
      // fall through
    }
    setFailed(key);
    announce(t("editFailed"));
    return false;
  };

  const remove = async (s: StapleRow) => {
    if (offline || busyId) return;
    setBusyId(s.id);
    await run(s.id, () => actions.removeStaple(s.id), true);
    setBusyId(null);
  };

  const saveStore = async (s: StapleRow, store: string | null) => {
    if (offline || busyId) return;
    setBusyId(s.id);
    const ok = await run(s.id, () => actions.updateStaple(s.id, store), true);
    setBusyId(null);
    if (ok) setEditing(null);
  };

  const addStaple = async (e: FormEvent) => {
    e.preventDefault();
    const value = draft.trim();
    if (!value || offline || adding) return;
    setAdding(true);
    // Focus stays in the field, so you can add the next one straight away.
    const ok = await run("add", () => actions.addStaples([{ name: value }]), false);
    setAdding(false);
    if (ok) setDraft("");
    addRef.current?.focus();
  };

  return (
    <>
      {staples.length === 0 ? (
        <div data-staples-empty="" className="card flex flex-col items-center gap-3 px-5 py-6 text-center">
          <LumiHalo state="idle" size="lumi" />
          <p className="text-body font-medium">{t("empty")}</p>
        </div>
      ) : (
        <ul aria-label={t("listLabel")} className="flex flex-col gap-2">
          {staples.map((s) => {
            const label = name(s);
            const other = "missing" in s.createdBy || s.createdBy.id !== me.id ? actorName(s.createdBy, tAll) : null;
            if (editing === s.id) {
              return (
                <li key={s.id} data-staple={s.id} className="row-card px-3 py-3">
                  <StoreForm
                    staple={s}
                    label={label}
                    busy={busyId === s.id}
                    offline={offline}
                    onSave={(store) => void saveStore(s, store)}
                    onCancel={() => {
                      setEditing(null);
                      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-staple-more="${CSS.escape(s.id)}"]`)?.focus());
                    }}
                  />
                  {failed === s.id && <p className="mt-2 text-small text-error-text">{t("editFailed")}</p>}
                </li>
              );
            }
            return (
              <li key={s.id} data-staple={s.id} className="row-card flex flex-col">
                <div className="flex min-h-tap items-center gap-3 py-1 pr-1 pl-3">
                  <FoodTile place={tilePlace(s, state)} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-body font-medium">{label}</span>
                    <span className="text-small text-text-muted">{s.store ? s.store.value : t("anywhere")}</span>
                  </span>
                  {other && (
                    <span className="rounded-button bg-accent-soft px-2 text-caption font-strong text-accent-text">
                      <span className="sr-only">{t("addedBy")} </span>
                      {sentenceCase(other, locale)}
                    </span>
                  )}
                  <Menu.Root>
                    <Menu.Trigger
                      aria-label={t("more", { name: label.toLocaleLowerCase(locale) })}
                      disabled={offline || busyId === s.id}
                      data-staple-more={s.id}
                      className="btn-icon disabled:opacity-60"
                    >
                      <MoreIcon aria-hidden="true" className="size-icon" />
                    </Menu.Trigger>
                    <Menu.Portal>
                      <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-60">
                        <Menu.Popup className="min-w-40 rounded-md bg-surface-raised p-1 shadow-pop">
                          <Menu.Item onClick={() => setEditing(s.id)} className="flex min-h-tap cursor-pointer items-center rounded-md px-3 text-body data-highlighted:bg-surface-sunken">
                            {t("store")}
                          </Menu.Item>
                          <Menu.Item onClick={() => void remove(s)} className="flex min-h-tap cursor-pointer items-center rounded-md px-3 text-body data-highlighted:bg-surface-sunken">
                            {t("remove")}
                          </Menu.Item>
                        </Menu.Popup>
                      </Menu.Positioner>
                    </Menu.Portal>
                  </Menu.Root>
                </div>
                {failed === s.id && <p className="px-3 pb-2 text-small text-error-text">{t("editFailed")}</p>}
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={(e) => void addStaple(e)} className="flex flex-col gap-1">
        <label htmlFor={fieldId} className="text-small font-strong">
          {t("addLabel")}
        </label>
        <div className="flex gap-2">
          <input
            ref={addRef}
            id={fieldId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("addPlaceholder")}
            maxLength={200}
            autoComplete="off"
            disabled={offline}
            aria-describedby={failed === "add" ? failId : undefined}
            className="field flex-1"
          />
          <button type="submit" disabled={offline || !draft.trim()} aria-disabled={adding || undefined} className="btn btn-small">
            <AddIcon aria-hidden="true" className="size-icon-sm" />
            {t("addButton")}
          </button>
        </div>
        {failed === "add" && (
          <p id={failId} className="text-small text-error-text">
            {t("editFailed")}
          </p>
        )}
      </form>
    </>
  );
}

/** Store… on a staple: a store name, or Anywhere (SS5). */
function StoreForm({
  staple,
  label,
  busy,
  offline,
  onSave,
  onCancel,
}: {
  staple: StapleRow;
  label: string;
  busy: boolean;
  offline: boolean;
  onSave: (store: string | null) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("staples");
  const locale = useLocale();
  const [value, setValue] = useState(staple.store?.value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => inputRef.current?.focus(), []);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const store = value.trim();
        if (!busy) onSave(store ? store : null);
      }}
      className="flex flex-col gap-2"
    >
      <label htmlFor={id} className="text-small font-strong">
        {t("storeLabel", { name: label.toLocaleLowerCase(locale) })}
      </label>
      <input ref={inputRef} id={id} value={value} onChange={(e) => setValue(e.target.value)} placeholder={t("storePlaceholder")}
        maxLength={100}
        autoComplete="off"
        disabled={offline}
        onKeyDown={(e) => {
          // Esc in the field cancels the edit, not the whole sheet.
          if (e.key === "Escape") {
            e.stopPropagation();
            e.preventDefault();
            onCancel();
          }
        }}
        className="field"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={offline} aria-disabled={busy || undefined} className="btn btn-primary btn-small">
          {t("storeSave")}
        </button>
        {staple.store && (
          <button type="button" disabled={offline} aria-disabled={busy || undefined} onClick={() => !busy && onSave(null)} className="btn btn-small">
            {t("storeClear")}
          </button>
        )}
        <button type="button" onClick={onCancel} className="btn-quiet ml-auto">
          {t("storeCancel")}
        </button>
      </div>
    </form>
  );
}

/** "You told me these before: fish sauce, jasmine rice. Add them · Not now" (SS2, SS8). */
function StaplesOffer({
  names,
  offline,
  onAnswered,
  onChange,
  onDismissed,
}: {
  names: string[];
  offline: boolean;
  onAnswered: () => void;
  onChange: (result: ApplyResult) => void;
  onDismissed: () => void;
}) {
  const t = useTranslations("staples.offer");
  const format = useFormatter();
  const actions = useKitchenActions();
  const announce = useAnnounce();
  const [pending, setPending] = useState<"accept" | "dismiss" | null>(null);
  const [failed, setFailed] = useState(false);
  const textId = useId();

  const answer = async (accept: boolean) => {
    if (pending || offline) return;
    setPending(accept ? "accept" : "dismiss");
    setFailed(false);
    try {
      const res = await actions.answerStaplesOffer(accept);
      if (res.ok) {
        onAnswered();
        if (accept && res.result.applied.some((a) => a.refs.length)) onChange(res.result);
        else {
          actions.showOwn(res.result);
          onDismissed();
        }
        return;
      }
    } catch {
      // fall through
    }
    setPending(null);
    setFailed(true);
    announce(t("failed"));
  };

  return (
    <div role="group" aria-labelledby={textId} data-staples-offer="" className="card flex items-start gap-3 px-4 py-3">
      <LumiHalo state="idle" size="tap" />
      <div className="flex flex-1 flex-col gap-2">
        <p id={textId} className="text-body">
          {t("text", { names: format.list(names, { type: "conjunction" }) })}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void answer(true)} disabled={offline} aria-disabled={pending !== null || undefined} className="btn btn-primary btn-small">
            {pending === "accept" ? t("adding") : t("accept")}
          </button>
          <button type="button" onClick={() => void answer(false)} disabled={offline} aria-disabled={pending !== null || undefined} className="btn-quiet">
            {t("dismiss")}
          </button>
        </div>
        {failed && <p className="text-small text-error-text">{t("failed")}</p>}
      </div>
    </div>
  );
}

