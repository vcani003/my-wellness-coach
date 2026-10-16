"use client";
/**
 * Stock levels on the Kitchen place (0045 KOS4, 0055): Plenty · Some left · Running low · Out.
 * - **Label:** a small three-bar meter plus the word, in the row's details line. Never colour
 *   alone (the word says it), never the allergy berry. Unknown shows nothing.
 * - **Control:** the row's ⋯ "More for rice" menu (the same pattern as the List's ⋯), holding one
 *   radio group "How much is left?". KOS3 (tap an item to edit it) will absorb it later: the menu
 *   is where item actions gather until then. It sets the whole item (`setItemStockLevel` without a
 *   batch); one batch's level is said in chat for now.
 * - **Result:** the normal "What changed" receipt with one Undo, in place under the row, and focus
 *   moves to it. Out removes the item from the kitchen, so its row stays as an "Out" ghost (like
 *   the List's "removed · Undo") until your next message. Low and Out offer "Add rice to my list"
 *   (SL3): the receipt draws it from `listOffers` (`ui/chat/ListOffers`), the same as in chat.
 * - **Offline:** item buttons need a connection until KOS7 (0044), so ⋯ is off while offline; the
 *   header's Offline pill and the place's "Offline · showing your kitchen as of…" line say why.
 * - Lasts until your next message and survives moving between places (PlaceMemory). Never
 *   crashes: a failed save says so in place and changes nothing (0018).
 */
import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { StockLevel } from "@/contracts/common";
import type { ItemRow, KitchenState } from "@/contracts/kitchen-state";
import { useAnnounce } from "@/ui/a11y/Announcer";
import { toReceipt, type Receipt as ReceiptModel } from "@/ui/chat/chat-reducer";
import { useFormatMsg } from "@/ui/chat/format-msg";
import { Receipt } from "@/ui/chat/Receipt";
import { usePlaceMemory } from "@/ui/places/PlaceMemory";
import { CheckIcon, MoreIcon } from "@/ui/primitives/icons";
import { Menu } from "@/ui/primitives/Menu";
import { useKitchenActions } from "@/ui/sync/KitchenActionsContext";
import { useKitchenData } from "@/ui/sync/KitchenDataContext";

const LEVELS: readonly StockLevel[] = ["plenty", "some", "low", "out"];
const BARS: Record<StockLevel, number> = { plenty: 3, some: 2, low: 1, out: 0 };
/** Calm colours from the existing tokens: mint for Plenty, muted for Some and Out, amber for Low. */
const TONE: Record<StockLevel, string> = {
  plenty: "font-medium text-success-text",
  some: "font-medium text-text-muted",
  low: "font-strong text-warning-text",
  out: "font-strong text-text-muted",
};

/** The three-bar meter. Decorative: the word next to it carries the meaning. */
export function LevelMeter({ level }: { level: StockLevel }) {
  return (
    <span aria-hidden="true" className="level-meter">
      {[0, 1, 2].map((i) => (
        <span key={i} {...(i < BARS[level] ? { "data-on": "" } : {})} />
      ))}
    </span>
  );
}

/** "▮▮▯ Some left" in a row's details line. */
export function LevelLabel({ level }: { level: StockLevel }) {
  const t = useTranslations("kitchen.level");
  return (
    <span data-stock={level} className={`inline-flex items-center gap-1 ${TONE[level]}`}>
      <LevelMeter level={level} />
      {t(level)}
    </span>
  );
}

/** One level change shown under its row, until your next message. */
export interface LevelNote {
  itemId: string;
  /** The row as it was before the change: drawn as the "Out" ghost once the item is gone. */
  before: ItemRow;
  level: StockLevel;
  turn: number;
  /** The receipt; absent when the save failed. */
  receipt?: ReceiptModel;
  /** New on each result that should take focus once. */
  key: string;
}

export interface LevelControl {
  offline: boolean;
  busyId: string | null;
  note: LevelNote | null;
  pick(item: ItemRow, level: StockLevel): void;
  undo(): void;
}

const Ctx = createContext<LevelControl | null>(null);
/** Where the receipt (or failure) under the row lives, so focus can move to it. */
const NoteRefCtx = createContext<RefObject<HTMLDivElement | null> | null>(null);

export function StockLevelProvider({ control, noteRef, children }: { control: LevelControl; noteRef: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  return (
    <Ctx.Provider value={control}>
      <NoteRefCtx.Provider value={noteRef}>{children}</NoteRefCtx.Provider>
    </Ctx.Provider>
  );
}

/** The item that left the kitchen with Out, drawn in place while its receipt shows. */
export function ghostOf(note: LevelNote | null, state: KitchenState): ItemRow | null {
  if (!note || note.level !== "out" || !note.receipt?.applied.length) return null;
  return state.items.some((i) => i.id === note.itemId) ? null : note.before;
}

/** The Kitchen place's level state and actions (one per place), and the ref of the note shown. */
export function useStockLevelControl(
  offline: boolean,
): readonly [LevelControl, RefObject<HTMLDivElement | null>] {
  const t = useTranslations();
  const announce = useAnnounce();
  const formatMsg = useFormatMsg();
  const actions = useKitchenActions();
  const { turn = 0 } = useKitchenData();
  const [stored, setNote] = usePlaceMemory<LevelNote | null>("kitchen.level.note", null);
  const note = stored && stored.turn === turn ? stored : null;
  const [busyId, setBusyId] = useState<string | null>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  const focusKey = useRef<string | null>(null);

  // A new result (saved, failed, undone, added to the list) takes focus once: its row may be gone.
  useEffect(() => {
    if (!note || focusKey.current !== note.key) return;
    focusKey.current = null;
    noteRef.current?.focus();
  }, [note]);
  const show = useCallback(
    (next: LevelNote, focus = true) => {
      if (focus) focusKey.current = next.key;
      setNote(next);
    },
    [setNote],
  );

  const pick = useCallback(
    async (item: ItemRow, level: StockLevel) => {
      if (offline || busyId || item.stock?.value === level) return;
      setBusyId(item.id);
      const base = { itemId: item.id, before: item, level, turn, key: crypto.randomUUID() };
      try {
        const res = await actions.setStockLevel(item.id, level);
        if (res.ok && (res.result.applied.length || res.result.rejected.length)) {
          actions.showOwn(res.result, { highlight: true });
          show({ ...base, receipt: toReceipt(res.result) });
        } else {
          show(base);
        }
      } catch {
        show(base);
      } finally {
        setBusyId(null);
      }
    },
    [actions, busyId, offline, show, turn],
  );

  const undo = useCallback(async () => {
    const current = note;
    const receipt = current?.receipt;
    if (!current || !receipt || receipt.undo === "pending") return;
    const withUndo = (undo: ReceiptModel["undo"], focus: boolean) =>
      show({ ...current, receipt: { ...receipt, undo }, key: crypto.randomUUID() }, focus);
    withUndo("pending", false);
    try {
      const res = await actions.undo(receipt.changeSetId);
      if (res.ok && res.result.applied.length) {
        actions.showOwn(res.result);
        withUndo("done", true);
        const changes = receipt.applied.map((a) => formatMsg(a.summary, "plain")).join(", ");
        announce(t("receipt.announceUndone", { changes }));
        return;
      }
    } catch {
      // fall through: say so in place
    }
    withUndo("refused", true);
  }, [actions, announce, formatMsg, note, show, t]);

  const control = useMemo<LevelControl>(
    () => ({
      offline,
      busyId,
      note,
      pick: (item: ItemRow, level: StockLevel) => void pick(item, level),
      undo: () => void undo(),
    }),
    [offline, busyId, note, pick, undo],
  );
  return [control, noteRef] as const;
}

/** The row's ⋯ menu with "How much is left?" (Plenty · Some left · Running low · Out). */
export function LevelMenu({ item, name }: { item: ItemRow; name: string }) {
  const t = useTranslations("kitchen.level");
  const control = useContext(Ctx);
  const titleId = useId();
  if (!control) return null;
  const busy = control.busyId === item.id;
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={t("more", { name })}
        aria-busy={busy || undefined}
        disabled={control.offline || busy}
        data-level-menu={item.id}
        className="btn-icon disabled:opacity-60"
      >
        <MoreIcon aria-hidden="true" className="size-icon" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-40">
          <Menu.Popup className="min-w-48 rounded-md bg-surface-raised p-1 shadow-pop">
            <p id={titleId} className="eyebrow px-3 pt-2 pb-1">
              {t("menuTitle")}
            </p>
            <Menu.RadioGroup aria-labelledby={titleId} value={item.stock?.value ?? null} onValueChange={(value: StockLevel) => control.pick(item, value)}>
              {LEVELS.map((level) => (
                <Menu.RadioItem
                  key={level}
                  value={level}
                  closeOnClick
                  data-level={level}
                  className="flex min-h-tap cursor-pointer items-center gap-3 rounded-md px-3 text-body data-checked:font-strong data-highlighted:bg-surface-sunken"
                >
                  <span className={`inline-flex ${TONE[level]}`}>
                    <LevelMeter level={level} />
                  </span>
                  <span className="flex-1">{t(level)}</span>
                  <Menu.RadioItemIndicator className="text-accent-text">
                    <CheckIcon aria-hidden="true" className="size-icon-sm" />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** The receipt (or the failure) under the row it changed. */
export function LevelNoteView({ itemId }: { itemId: string }) {
  const t = useTranslations("kitchen.level");
  const control = useContext(Ctx);
  const noteRef = useContext(NoteRefCtx);
  const note = control?.note;
  if (!control || !note || note.itemId !== itemId) return null;
  const { receipt } = note;
  if (!receipt) {
    return (
      <div ref={noteRef} tabIndex={-1} data-level-note="failed" className="px-3 pb-3 outline-none">
        <p className="rounded-md bg-error-bg px-3 py-2 text-small text-error-text">{t("failed")}</p>
      </div>
    );
  }
  return (
    <div ref={noteRef} tabIndex={-1} data-level-note={receipt.changeSetId} className="scroll-mt-(--topbar-height) px-3 pb-3 outline-none">
      <Receipt receipt={receipt} onUndo={control.undo} />
    </div>
  );
}
