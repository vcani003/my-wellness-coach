"use client";
/**
 * "Add to your kitchen?" from the shopping list (ux.md §5, §10, SL2): a bottom sheet on a phone,
 * a centred dialog on desktop. "Got it" items are pre-selected; "Not ticked" ones start
 * unselected in case you forgot to tick. Add N items → into the kitchen and off the list.
 * Do later, Skip, Esc and tapping outside change nothing: the ticks stay on the list.
 */
import { useTranslations } from "next-intl";
import { useId, useState, type RefObject } from "react";
import { Dialog } from "@/ui/primitives/Dialog";

export interface SheetItem {
  id: string;
  name: string;
  ticked: boolean;
}

export function DoneShoppingSheet(props: {
  open: boolean;
  items: SheetItem[];
  onClose: () => void;
  onAdd: (ids: string[]) => Promise<boolean>;
  finalFocus?: RefObject<HTMLElement | null>;
}) {
  return (
    <Dialog.Root open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-text-default/30" />
        {/* A new key on each open, so the pre-selection is fresh each time. */}
        <SheetBody key={props.open ? "open" : "closed"} {...props} />
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SheetBody({ items, onClose, onAdd, finalFocus }: Parameters<typeof DoneShoppingSheet>[0]) {
  const t = useTranslations("shopping.sheet");
  const tShop = useTranslations("shopping");
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(items.filter((i) => i.ticked).map((i) => i.id)));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const errorId = useId();
  const got = items.filter((i) => i.ticked);
  const notTicked = items.filter((i) => !i.ticked);
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const add = async () => {
    setBusy(true);
    setFailed(false);
    const ids = items.filter((i) => selected.has(i.id)).map((i) => i.id);
    const ok = await onAdd(ids);
    setBusy(false);
    if (ok) onClose();
    else setFailed(true);
  };

  const section = (key: "gotIt" | "notTicked", list: SheetItem[]) =>
    list.length > 0 && (
      <fieldset className="flex flex-col">
        <legend className="mb-1 text-caption font-strong tracking-wide text-text-muted uppercase">{t(key)}</legend>
        {list.map((i) => (
          <label key={i.id} className="flex min-h-tap cursor-pointer items-center gap-3 rounded-sm px-1">
            <input
              type="checkbox"
              checked={selected.has(i.id)}
              onChange={() => toggle(i.id)}
              className="size-6 shrink-0 cursor-pointer accent-accent-default"
            />
            <span className="text-body">{i.name}</span>
          </label>
        ))}
      </fieldset>
    );

  return (
    <Dialog.Popup
      finalFocus={finalFocus}
      aria-describedby={failed ? errorId : undefined}
      className="sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col gap-3 rounded-t-lg bg-surface-raised px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-dock desk:inset-x-auto desk:top-1/2 desk:bottom-auto desk:left-1/2 desk:w-[28rem] desk:-translate-x-1/2 desk:-translate-y-1/2 desk:rounded-lg"
    >
      <div className="flex items-start gap-2">
        <div>
          <Dialog.Title className="text-title font-strong">{t("title")}</Dialog.Title>
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
        <p id={errorId} role="alert" className="rounded-sm bg-error-bg px-3 py-2 text-small text-error-text">
          {tShop("doneFailed")}
        </p>
      )}
      <button
        type="button"
        onClick={() => void add()}
        disabled={busy || selected.size === 0}
        className="min-h-tap w-full rounded-button bg-accent-default px-5 text-body font-strong text-text-inverse disabled:opacity-60"
      >
        {busy ? t("adding") : t("add", { count: selected.size })}
      </button>
      <div className="flex items-center justify-between">
        <button type="button" onClick={onClose} disabled={busy} className="min-h-tap rounded-button px-3 text-body font-medium text-accent-text">
          {t("doLater")}
        </button>
        <button type="button" onClick={onClose} disabled={busy} className="min-h-tap rounded-button px-3 text-body font-medium text-accent-text">
          {t("skip")}
        </button>
      </div>
    </Dialog.Popup>
  );
}
