"use client";
/**
 * A confirm sheet for the two big Settings actions (ux.md §5, §7): **Sign out everywhere** and
 * **Delete my data**. A bottom sheet on a phone, a centred dialog on desktop (Base UI Dialog:
 * focus is trapped, Esc and tapping outside cancel, focus returns to the button that opened it).
 *
 * - Focus starts on the safe choice (Cancel), or on the phrase field when one is asked for.
 * - With `phrase`, the confirm button stays `aria-disabled` (still focusable and announced) until
 *   the typed text matches, case and outer spaces ignored, exactly as the server checks it.
 * - `onConfirm` resolves false (or throws) → the sheet stays open with a plain error (0018).
 */
import { useId, useRef, useState, type ReactNode } from "react";
import { Dialog } from "@/ui/primitives/Dialog";

export interface ConfirmSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  cancelLabel: string;
  failedText: string;
  /** `danger` for what can't be undone (Delete my data); `accent` otherwise. */
  tone?: "accent" | "danger";
  /** Typed confirmation, e.g. "delete my data". */
  phrase?: { value: string; label: string };
  onConfirm(): Promise<boolean>;
}

export const phraseMatches = (typed: string, phrase: string) => typed.trim().toLowerCase() === phrase.trim().toLowerCase();

export function ConfirmSheet(props: ConfirmSheetProps) {
  return (
    <Dialog.Root open={props.open} onOpenChange={(open) => props.onOpenChange(open)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-scrim" />
        {/* Always rendered: unmounting the Popup ourselves left Base UI's backdrop stuck closing,
            blocking every tap after Cancel. A new key on each open gives a fresh, empty sheet. */}
        <SheetBody key={props.open ? "open" : "closed"} {...props} />
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SheetBody({ onOpenChange, title, children, confirmLabel, busyLabel, cancelLabel, failedText, tone = "accent", phrase, onConfirm }: ConfirmSheetProps) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const errorId = useId();
  const ready = !phrase || phraseMatches(typed, phrase.value);

  const confirm = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setFailed(false);
    let ok = false;
    try {
      ok = await onConfirm();
    } catch {
      ok = false;
    }
    // On success the page is leaving (to /unlock); stay busy so nothing can be tapped twice.
    if (!ok) {
      setBusy(false);
      setFailed(true);
    }
  };

  return (
    <Dialog.Popup
      initialFocus={phrase ? fieldRef : cancelRef}
      aria-describedby={failed ? errorId : undefined}
      className="sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col gap-3 overflow-y-auto rounded-t-sheet bg-surface-raised px-5 pt-5 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-pop desk:inset-x-auto desk:top-1/2 desk:bottom-auto desk:left-1/2 desk:w-[30rem] desk:-translate-x-1/2 desk:-translate-y-1/2 desk:rounded-sheet"
    >
      <Dialog.Title className="font-heading text-title font-medium">{title}</Dialog.Title>
      <div className="flex flex-col gap-2 text-body">{children}</div>
      {phrase && (
        <div className="flex flex-col gap-1">
          <label htmlFor={fieldId} className="text-body font-medium">
            {phrase.label}
          </label>
          <input
            ref={fieldRef}
            id={fieldId}
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void confirm();
            }}
            disabled={busy}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            className="field"
          />
        </div>
      )}
      {failed && (
        <p id={errorId} role="alert" className="rounded-md bg-error-bg px-3 py-2 text-small text-error-text">
          {failedText}
        </p>
      )}
      <button
        type="button"
        onClick={() => void confirm()}
        aria-disabled={!ready || busy || undefined}
        aria-busy={busy || undefined}
        className={`btn w-full ${tone === "danger" ? "btn-danger" : "btn-primary"}`}
      >
        {busy ? busyLabel : confirmLabel}
      </button>
      <button
        ref={cancelRef}
        type="button"
        onClick={() => onOpenChange(false)}
        disabled={busy}
        className="btn w-full"
      >
        {cancelLabel}
      </button>
    </Dialog.Popup>
  );
}
