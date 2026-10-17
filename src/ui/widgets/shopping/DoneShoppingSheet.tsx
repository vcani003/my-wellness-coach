"use client";
/**
 * "Add to your kitchen?" from the shopping list (ux.md §5, §10, SL2): a bottom sheet on a phone,
 * a centred dialog on desktop. Add N items → into the kitchen and off the list.
 * - From "Done shopping": "Got it" items are pre-selected; "Not ticked" ones start unselected in
 *   case you forgot to tick. **Do later** saves the chosen items to the Kitchen's To review
 *   (`onLater`); Esc, swipe-down and tapping outside count as Do later, so nothing is lost (ux.md §5).
 *   Skip changes nothing.
 * - From a To review card: its items are all pre-selected. Do later just closes (it's still in
 *   To review); Skip closes the card (`onSkip`).
 */
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { Checkbox } from "@/ui/primitives/Checkbox";
import { Dialog, SheetBackdrop, SheetPopup, useOpenKey } from "@/ui/primitives/Dialog";

export interface SheetItem {
  id: string;
  name: string;
  ticked: boolean;
}

export interface DoneShoppingSheetProps {
  open: boolean;
  items: SheetItem[];
  onClose: () => void;
  onAdd: (ids: string[]) => Promise<boolean>;
  /** Do later with the chosen items. Absent = Do later only closes. */
  onLater?: (ids: string[]) => Promise<boolean>;
  /** Skip. Absent = Skip only closes (nothing changes). */
  onSkip?: () => Promise<boolean>;
  /** Which items start selected: the ticked ones (Done shopping) or all (a To review card). */
  preselect?: "ticked" | "all";
  finalFocus?: RefObject<HTMLElement | null>;
}

export function DoneShoppingSheet(props: DoneShoppingSheetProps) {
  // Esc, swipe-down and tapping outside run the open sheet's Do later.
  const dismissRef = useRef(props.onClose);
  const sheetKey = useOpenKey(props.open);
  return (
    <Dialog.Root open={props.open} onOpenChange={(open) => !open && dismissRef.current()}>
      <Dialog.Portal>
        <SheetBackdrop />
        {/* A new key on each open (useOpenKey, not on close, so it can play its exit), so the pre-selection is fresh each time. */}
        <SheetBody key={sheetKey} {...props} dismissRef={dismissRef} />
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type Failure = "add" | "later" | "skip";

function SheetBody({
  items,
  onClose,
  onAdd,
  onLater,
  onSkip,
  preselect = "ticked",
  finalFocus,
  dismissRef,
}: DoneShoppingSheetProps & { dismissRef: RefObject<() => void> }) {
  const t = useTranslations("shopping.sheet");
  const tShop = useTranslations("shopping");
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(items.filter((i) => preselect === "all" || i.ticked).map((i) => i.id)),
  );
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<Failure | null>(null);
  const errorId = useId();
  const got = items.filter((i) => i.ticked);
  const notTicked = items.filter((i) => !i.ticked);
  const chosen = () => items.filter((i) => selected.has(i.id)).map((i) => i.id);
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Run a step; close when it saved, else keep the sheet open with a plain error. */
  const run = async (kind: Failure, step: () => Promise<boolean>) => {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    const ok = await step();
    setBusy(false);
    if (ok) onClose();
    else setFailed(kind);
  };
  const add = () => run("add", () => onAdd(chosen()));
  const later = () => {
    if (busy) return;
    const ids = chosen();
    // Nothing chosen: nothing to keep for later.
    if (!onLater || ids.length === 0) return onClose();
    return run("later", () => onLater(ids));
  };
  const skip = () => (onSkip ? run("skip", onSkip) : onClose());
  useEffect(() => {
    dismissRef.current = () => void later();
  });

  const section = (key: "gotIt" | "notTicked", list: SheetItem[]) =>
    list.length > 0 && (
      <fieldset className="flex flex-col">
        <legend className="mb-1 text-caption font-strong tracking-wide text-text-muted uppercase">{t(key)}</legend>
        {list.map((i) => (
          <label key={i.id} className="flex min-h-tap cursor-pointer items-center gap-3 rounded-md px-1">
            <Checkbox
              checked={selected.has(i.id)}
              onChange={() => toggle(i.id)}
            />
            <span className="text-body">{i.name}</span>
          </label>
        ))}
      </fieldset>
    );

  return (
    <SheetPopup
      finalFocus={finalFocus}
      aria-describedby={failed ? errorId : undefined}
      className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col gap-3 rounded-t-sheet bg-surface-raised px-5 pt-5 pb-[max(1rem,env(safe-area-inset-bottom))] desk:inset-x-auto desk:top-1/2 desk:bottom-auto desk:left-1/2 desk:w-[28rem] desk:-translate-x-1/2 desk:-translate-y-1/2 desk:rounded-sheet"
    >
      <div className="flex items-start gap-2">
        <div>
          <Dialog.Title className="font-heading text-title font-medium">{t("title")}</Dialog.Title>
          <Dialog.Description className="text-small text-text-muted">{t("from")}</Dialog.Description>
        </div>
        <button
          type="button"
          onClick={() => setSelected(selected.size ? new Set() : new Set(items.map((i) => i.id)))}
          className="ml-auto min-h-tap rounded-button px-3 text-small font-strong text-accent-text"
        >
          {selected.size ? t("unselectAll") : t("selectAll")}
        </button>
      </div>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        {section("gotIt", got)}
        {section("notTicked", notTicked)}
      </div>
      {failed && (
        <p id={errorId} role="alert" className="rounded-md bg-error-bg px-3 py-2 text-small text-error-text">
          {tShop(failed === "add" ? "doneFailed" : failed === "later" ? "laterFailed" : "skipFailed")}
        </p>
      )}
      <button
        type="button"
        onClick={() => void add()}
        disabled={busy || selected.size === 0}
        className="btn btn-primary w-full"
      >
        {busy ? t("adding") : t("add", { count: selected.size })}
      </button>
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => void later()} disabled={busy} className="btn-quiet">
          {t("doLater")}
        </button>
        <button type="button" onClick={() => void skip()} disabled={busy} className="btn-quiet">
          {t("skip")}
        </button>
      </div>
    </SheetPopup>
  );
}
