"use client";
/**
 * Tap an item to edit it (0045 KOS3; 0057, 0036, 0055 KOS4-e; item-actions.md re-cut for the
 * Kitchen OS rows): the Kitchen place's one edit control. It holds which item's sheet is open
 * (and the kitchen version it opened at), what is saving, and the one result shown under its row.
 * - **Save** (name, amount, place, type) is one `editItem` call: one change set, one receipt, one
 *   Undo. The sheet closes and the receipt shows under the row, with focus on its Undo.
 * - **How much is left?** and **Staple** act at once (a level was one tap in KOS4, and a switch
 *   that waits for Save surprises people). Their receipt shows in the sheet and under the row;
 *   the sheet stays open, now based on the version it just saved. Out on the whole item closes it.
 * - **Remove** asks once, then closes; the row stays drawn as "Removed" with the receipt.
 * - **Someone changed it first** (STALE_TARGET) / **it's gone**: nothing was saved, the sheet
 *   closes, the row shows the latest with "Levi just changed fish sauce…" / "…isn't in the kitchen
 *   any more." **Failed** (no answer): the sheet stays open with what was typed (0018).
 * - The result lasts until your next message and survives moving between places (PlaceMemory).
 * - Offline (0044, until KOS7's queue): the sheet still opens, to read, with every change off.
 */
import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { ActionResult } from "@/app/actions";
import type { StockLevel } from "@/contracts/common";
import type { ItemRow } from "@/contracts/kitchen-state";
import { useAnnounce } from "@/ui/a11y/Announcer";
import { toReceipt, type Receipt as ReceiptModel } from "@/ui/chat/chat-reducer";
import { useFormatMsg } from "@/ui/chat/format-msg";
import { Receipt } from "@/ui/chat/Receipt";
import { actorName, byOther, sentenceCase } from "@/ui/fallbacks";
import { usePlaceMemory } from "@/ui/places/PlaceMemory";
import { useKitchenActions, type ItemEditFields } from "@/ui/sync/KitchenActionsContext";
import { useKitchenData } from "@/ui/sync/KitchenDataContext";
import { outcomeOf, type ItemNote } from "./item-edit-model";

/** The open sheet: which item, the version it opened at (moved on by your own changes in it). */
export interface Editing {
  itemId: string;
  /** The row as it was when tapped: the sheet keeps showing it if the item leaves meanwhile. */
  item: ItemRow;
  version: number;
  /** One per opening; the sheet's own receipts carry it. */
  sheet: string;
}

/** What the sheet hears back: `failed` = keep it open with a message; `done` = handled. */
export type SheetAnswer = "failed" | "done";

export interface ItemEditControl {
  offline: boolean;
  busyId: string | null;
  note: ItemNote | null;
  editing: Editing | null;
  open(item: ItemRow, opener: HTMLElement | null): void;
  close(): void;
  save(item: ItemRow, edit: ItemEditFields, batchId?: string): Promise<SheetAnswer>;
  setLevel(item: ItemRow, level: StockLevel, batchId?: string): Promise<SheetAnswer>;
  setStaple(item: ItemRow, staple: boolean): Promise<SheetAnswer>;
  remove(item: ItemRow): Promise<SheetAnswer>;
  undo(): void;
  /** Where the sheet's dialog returns focus when it closes. */
  finalFocus(): HTMLElement | boolean;
}

const Ctx = createContext<ItemEditControl | null>(null);
/** Where the note under the row, and the one in the sheet, live, so focus can move to them. */
const RowNoteRef = createContext<RefObject<HTMLDivElement | null> | null>(null);
const SheetNoteRef = createContext<RefObject<HTMLDivElement | null> | null>(null);

export interface NoteRefs {
  row: RefObject<HTMLDivElement | null>;
  sheet: RefObject<HTMLDivElement | null>;
}

export function ItemEditProvider({ control, refs, children }: { control: ItemEditControl; refs: NoteRefs; children: ReactNode }) {
  return (
    <Ctx.Provider value={control}>
      <RowNoteRef.Provider value={refs.row}>
        <SheetNoteRef.Provider value={refs.sheet}>{children}</SheetNoteRef.Provider>
      </RowNoteRef.Provider>
    </Ctx.Provider>
  );
}

export function useItemEdit(): ItemEditControl | null {
  return useContext(Ctx);
}

/** Focus the note's Undo when there is one, else the note itself (its Undo may be gone). */
function focusIn(el: HTMLElement | null, undo: boolean) {
  if (!el) return;
  const button = undo ? el.querySelector<HTMLButtonElement>("[data-receipt] button[aria-label^='Undo']") : null;
  (button ?? el).focus();
}

/** The Kitchen place's edit state and actions (one per place). */
export function useItemEditControl(offline: boolean) {
  const t = useTranslations();
  const announce = useAnnounce();
  const formatMsg = useFormatMsg();
  const actions = useKitchenActions();
  const { me, turn = 0, snapshot } = useKitchenData();
  const [stored, setNote] = usePlaceMemory<ItemNote | null>("kitchen.item.note", null);
  const note = stored && stored.turn === turn ? stored : null;
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const rowNoteRef = useRef<HTMLDivElement>(null);
  const sheetNoteRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  // A result that should take focus once: its Undo (a new receipt) or the note (stale, gone, undone).
  const focusNext = useRef<{ key: string; undo: boolean } | null>(null);
  const closingToNote = useRef(false);
  const editingRef = useRef(editing);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);
  const version = snapshot.state?.version ?? 0;

  useEffect(() => {
    const want = focusNext.current;
    if (!note || !want || want.key !== note.key) return;
    const inSheet = editing && note.sheet === editing.sheet;
    const el = inSheet ? sheetNoteRef.current : rowNoteRef.current;
    if (!el && !inSheet && editing) return; // the sheet is still closing; try again when it has
    focusNext.current = null;
    focusIn(el, want.undo);
    // A closing dialog may hand focus back a frame later; take it once more.
    const frame = requestAnimationFrame(() => focusIn(inSheet ? sheetNoteRef.current : rowNoteRef.current, want.undo));
    return () => cancelAnimationFrame(frame);
  }, [note, editing]);

  const show = useCallback(
    (next: ItemNote, focus: { undo: boolean } | null) => {
      focusNext.current = focus ? { key: next.key, undo: focus.undo } : null;
      setNote(next);
    },
    [setNote],
  );

  const close = useCallback((toNote = false) => {
    closingToNote.current = toNote;
    setEditing(null);
  }, []);

  /** One answer, whatever the button: stale / gone / saved / nothing / failed. */
  const run = useCallback(
    async (item: ItemRow, call: (version: number) => Promise<ActionResult>, how: { closeOnSave: boolean; focusUndo: boolean }): Promise<SheetAnswer> => {
      const open = editingRef.current;
      if (!open || offline) return "failed";
      setBusyId(item.id);
      const base = { itemId: item.id, before: item, turn, key: crypto.randomUUID(), sheet: open.sheet };
      try {
        const res = await call(open.version);
        if (!res.ok) return "failed";
        const { result } = res;
        const latest = result.state.items.find((i) => i.id === item.id);
        const outcome = outcomeOf(result);
        if (outcome === "stale" || outcome === "gone") {
          // Nothing was saved: show the latest, say why, and close (item-actions.md §5).
          actions.showOwn(result);
          const who = latest && byOther(latest.updatedBy, me.id) ? sentenceCase(actorName(latest.updatedBy, t)) : t("kitchen.edit.you");
          show(latest && outcome === "stale" ? { ...base, kind: "stale", who } : { ...base, kind: "gone" }, { undo: false });
          close(true);
          return "done";
        }
        if (outcome === "nothing") {
          if (how.closeOnSave) close();
          return "done";
        }
        actions.showOwn(result, { highlight: true });
        const receipt = toReceipt(result);
        const closes = how.closeOnSave || !latest;
        show({ ...base, kind: "receipt", receipt, ...(closes ? { sheet: undefined } : {}) }, closes || how.focusUndo ? { undo: true } : null);
        announce(t("kitchen.edit.announce", { changes: receipt.applied.map((a) => formatMsg(a.summary, "plain")).join(", ") }));
        if (closes) close(true);
        else setEditing((e) => (e && e.sheet === open.sheet ? { ...e, version: Math.max(e.version, result.newVersion) } : e));
        return "done";
      } catch {
        return "failed";
      } finally {
        setBusyId(null);
      }
    },
    [actions, announce, close, formatMsg, me.id, offline, show, t, turn],
  );

  const undo = useCallback(async () => {
    const current = note;
    const receipt = current?.receipt;
    if (!current || !receipt || receipt.undo === "pending" || receipt.undo === "done") return;
    const withUndo = (undo: ReceiptModel["undo"], focus: boolean) =>
      show({ ...current, receipt: { ...receipt, undo }, key: crypto.randomUUID() }, focus ? { undo: false } : null);
    withUndo("pending", false);
    try {
      const res = await actions.undo(receipt.changeSetId);
      if (res.ok && res.result.applied.length) {
        actions.showOwn(res.result);
        withUndo("done", true);
        const newVersion = res.result.newVersion;
        setEditing((e) => (e ? { ...e, version: Math.max(e.version, newVersion) } : e));
        const changes = receipt.applied.map((a) => formatMsg(a.summary, "plain")).join(", ");
        announce(t("receipt.announceUndone", { changes }));
        return;
      }
    } catch {
      // fall through: say so in place
    }
    withUndo("refused", true);
    announce(t("receipt.cantUndo"));
  }, [actions, announce, formatMsg, note, show, t]);

  const control = useMemo<ItemEditControl>(
    () => ({
      offline,
      busyId,
      note,
      editing,
      open(item, el) {
        opener.current = el;
        closingToNote.current = false;
        setEditing({ itemId: item.id, item, version, sheet: crypto.randomUUID() });
      },
      close: () => close(),
      save: (item, edit, batchId) => run(item, (v) => actions.editItem(item.id, edit, { basedOnVersion: v, ...(batchId ? { batchId } : {}) }), { closeOnSave: true, focusUndo: true }),
      setLevel: (item, level, batchId) => run(item, (v) => actions.setStockLevel(item.id, level, batchId, v), { closeOnSave: false, focusUndo: false }),
      setStaple: (item, staple) => run(item, (v) => actions.setItemStaple(item.id, staple, { basedOnVersion: v }), { closeOnSave: false, focusUndo: false }),
      remove: (item) => run(item, (v) => actions.removeItem(item.id, { basedOnVersion: v }), { closeOnSave: true, focusUndo: true }),
      undo: () => void undo(),
      finalFocus() {
        // A result under the row takes focus itself (see the effect above); otherwise back to the row.
        if (closingToNote.current) return false;
        const el = opener.current;
        return el && el.isConnected ? el : true;
      },
    }),
    [actions, busyId, close, editing, note, offline, run, undo, version],
  );
  return [control, { row: rowNoteRef, sheet: sheetNoteRef } satisfies NoteRefs] as const;
}

/** The message for a stale or gone note. */
function NoteMessage({ note }: { note: ItemNote }) {
  const t = useTranslations("kitchen.edit");
  const name = note.before.name.value;
  const text = note.kind === "stale" ? t("conflict", { who: note.who ?? "", name }) : t("gone", { name: sentenceCase(name) });
  return <p className="rounded-md bg-warning-bg px-3 py-2 text-small text-warning-text">{text}</p>;
}

/** The result under the row it changed: the receipt with Undo, or why nothing changed. */
export function ItemNoteView({ itemId }: { itemId: string }) {
  const control = useContext(Ctx);
  const ref = useContext(RowNoteRef);
  const note = control?.note;
  if (!control || !ref || !note || note.itemId !== itemId) return null;
  return (
    <div ref={ref} tabIndex={-1} data-item-note={note.kind} className="scroll-mt-(--topbar-height) px-3 pb-3 outline-none">
      {note.receipt ? <Receipt receipt={note.receipt} onUndo={control.undo} /> : <NoteMessage note={note} />}
    </div>
  );
}

/** The same receipt inside the open sheet, for a level or Staple change made there. */
export function SheetNoteView() {
  const control = useContext(Ctx);
  const ref = useContext(SheetNoteRef);
  const note = control?.note;
  if (!control || !ref || !note?.receipt || !control.editing || note.sheet !== control.editing.sheet) return null;
  return (
    <div ref={ref} tabIndex={-1} data-sheet-note="" className="outline-none">
      <Receipt receipt={note.receipt} onUndo={control.undo} />
    </div>
  );
}
