"use client";
/**
 * Settings → Account: **Set your passphrase** (first time; the current secret is your access
 * code) or **Change passphrase** (SU1 Rec; `changePassphrase({current, next})`).
 *
 * - Two Show/Hide fields: current (`current-password`) and new (`new-password`, with the calm
 *   strength hint), plus a hidden `username` field so a password manager saves the right pair.
 * - Too short is caught here; a wrong current secret, rate limits and failures are the server's
 *   answer, shown in one alert region, with focus back on the field to fix. Nothing is cleared.
 * - Success closes the sheet (focus returns to the button) and Settings says "Passphrase saved."
 */
import { useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";
import type { AuthFailure } from "@/lib/auth/invites";
import { SecretField } from "@/ui/auth/fields";
import { passphraseHint, passphraseProblemKey } from "@/ui/auth/strength";
import { Dialog } from "@/ui/primitives/Dialog";

export interface PassphraseSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** False the first time: the "current" secret is the access code. */
  hasPassphrase: boolean;
  userName: string;
  change(input: { current: string; next: string }): Promise<{ ok: true } | AuthFailure>;
  onSaved(): void;
}

export function PassphraseSheet(props: PassphraseSheetProps) {
  return (
    <Dialog.Root open={props.open} onOpenChange={(open) => props.onOpenChange(open)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-scrim" />
        {/* Always rendered (Base UI needs its Popup to finish closing, or the backdrop stays and
            blocks the page); a new key on each open gives a fresh, empty sheet. */}
        <SheetBody key={props.open ? "open" : "closed"} {...props} />
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const CURRENT_ID = "passphrase-current";
const NEXT_ID = "passphrase-next";
const ERROR_ID = "passphrase-error";
const NOTE_ID = "passphrase-note";

function SheetBody({ onOpenChange, hasPassphrase, userName, change, onSaved }: PassphraseSheetProps) {
  const t = useTranslations("settings.account.passphraseSheet");
  const tAuth = useTranslations("auth");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<{ text: string; field: "current" | "next" | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const currentRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);

  const fail = (text: string, field: "current" | "next" | null) => {
    setError({ text, field });
    (field === "current" ? currentRef : nextRef).current?.focus();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!current) return fail(hasPassphrase ? t("emptyCurrent") : t("emptyCode"), "current");
    const weak = passphraseProblemKey(next);
    if (weak) return fail(tAuth(`errors.${weak}`), "next");
    setBusy(true);
    setError(null);
    let res: { ok: true } | AuthFailure;
    try {
      res = await change({ current, next });
    } catch {
      res = { ok: false, error: { key: "failed" } };
    }
    setBusy(false);
    if (res.ok) {
      onSaved();
      onOpenChange(false);
      return;
    }
    const { key, minutes } = res.error;
    if (key === "wrong") return fail(hasPassphrase ? t("wrongCurrent") : t("wrongCode"), "current");
    if (key === "passphraseTooShort" || key === "passphraseTooLong") return fail(tAuth(`errors.${key}`), "next");
    if (key === "tooMany") return fail(tAuth("errors.tooMany", { minutes: minutes ?? 1 }), null);
    return fail(tAuth("errors.failed"), null);
  };

  const hint = passphraseHint(next);
  const hintText = hint.key === "more" ? tAuth("strength.more", { count: hint.count }) : tAuth(`strength.${hint.key}`);

  return (
    <Dialog.Popup
      initialFocus={currentRef}
      className="sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col overflow-y-auto rounded-t-sheet bg-surface-raised px-5 pt-5 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-pop desk:inset-x-auto desk:top-1/2 desk:bottom-auto desk:left-1/2 desk:w-[30rem] desk:-translate-x-1/2 desk:-translate-y-1/2 desk:rounded-sheet"
    >
      <Dialog.Title className="font-heading text-title font-medium">{hasPassphrase ? t("changeTitle") : t("setTitle")}</Dialog.Title>
      <form onSubmit={(e) => void submit(e)} noValidate className="mt-3 flex flex-col">
        <input type="text" name="username" autoComplete="username" value={userName} readOnly hidden />
        <SecretField
          id={CURRENT_ID}
          name="current-password"
          label={hasPassphrase ? t("currentLabel") : t("codeLabel")}
          value={current}
          onChange={setCurrent}
          inputRef={currentRef}
          autoComplete="current-password"
          showLabel={hasPassphrase ? t("showCurrent") : t("showCode")}
          hideLabel={hasPassphrase ? t("hideCurrent") : t("hideCode")}
          showText={tAuth("show")}
          hideText={tAuth("hide")}
          invalid={error?.field === "current"}
          describedBy={[error?.field === "current" ? ERROR_ID : null]}
          enterKeyHint="next"
        />
        <div className="mt-4">
          <SecretField
            id={NEXT_ID}
            name="new-password"
            label={t("newLabel")}
            value={next}
            onChange={setNext}
            inputRef={nextRef}
            autoComplete="new-password"
            showLabel={t("showNew")}
            hideLabel={t("hideNew")}
            showText={tAuth("show")}
            hideText={tAuth("hide")}
            hint={hintText}
            invalid={error?.field === "next"}
            describedBy={[error && error.field !== "current" ? ERROR_ID : null, hasPassphrase ? NOTE_ID : null]}
            enterKeyHint="done"
          />
        </div>
        {hasPassphrase && (
          <p id={NOTE_ID} className="mt-2 text-small text-text-muted">
            {t("otherDevices")}
          </p>
        )}
        {/* Always in the sheet, so screen readers announce the error when it appears. */}
        <p id={ERROR_ID} role="alert" className="mt-2 text-small text-error-text empty:mt-0">
          {error?.text ?? ""}
        </p>
        <button
          type="submit"
          aria-disabled={busy || undefined}
          aria-busy={busy || undefined}
          className="btn btn-primary mt-4 w-full"
        >
          {busy ? t("saving") : t("save")}
        </button>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          disabled={busy}
          className="btn mt-3 w-full"
        >
          {t("cancel")}
        </button>
      </form>
    </Dialog.Popup>
  );
}
