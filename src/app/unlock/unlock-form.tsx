"use client";
/**
 * The access-code form (Clay & Honey, 0024). Phone-first: one field with Show/Hide (codes are
 * long and typed on phones), a large pill button, and a calm inline error. The server action
 * (./actions) and its checks are unchanged; this file is presentation only.
 *
 * - The field is focused at load (this page has one job) and again after an error, keeping what
 *   was typed so a typo can be fixed with Show instead of retyping the whole code.
 * - On iPhone the keyboard covers the page, so once it opens we scroll the button into view
 *   (globals.css `.unlock-page` re-centres the card above it via --keyboard-inset).
 */
import { useActionState, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { HideIcon, KitchenMarkIcon, ShowIcon, SpinnerIcon } from "@/ui/primitives/icons";
import { useKeyboardInset } from "@/ui/shell/viewport";
import { unlock, type UnlockState } from "./actions";

const FIELD_ID = "code";
const ERROR_ID = "code-error";
const NOTE_ID = "code-note";

export function UnlockForm() {
  const t = useTranslations("unlock");
  const [state, action, pending] = useActionState<UnlockState, FormData>(unlock, {});
  const [code, setCode] = useState("");
  const [shown, setShown] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const submit = useRef<HTMLButtonElement>(null);
  useKeyboardInset();

  // At load, and after each failed try: back to the field (jsx-a11y's no-autofocus is about the
  // attribute on busy pages; here the field is the page's only purpose).
  useEffect(() => {
    field.current?.focus();
  }, [state]);

  /** Once the iPhone keyboard has opened, make sure it isn't hiding Unlock. */
  const keepButtonVisible = () => {
    const vv = window.visualViewport;
    if (!vv) return;
    const reveal = () =>
      requestAnimationFrame(() => requestAnimationFrame(() => submit.current?.scrollIntoView({ block: "nearest" })));
    vv.addEventListener("resize", reveal, { once: true });
    window.setTimeout(() => vv.removeEventListener("resize", reveal), 1500);
  };

  const error = state.error ? t(`errors.${state.error.key}`, { minutes: state.error.minutes ?? 1 }) : "";
  const describedBy = [error ? ERROR_ID : null, NOTE_ID].filter(Boolean).join(" ");

  return (
    <div className="w-full max-w-sm rounded-lg bg-surface-raised px-5 py-6 shadow-card">
      <div className="flex flex-col items-center text-center">
        <span aria-hidden="true" className="flex size-fab items-center justify-center rounded-md bg-accent-default text-text-inverse">
          <KitchenMarkIcon className="size-6" />
        </span>
        <h1 className="mt-4 font-heading text-heading font-strong">{t("title")}</h1>
        <p className="mt-2 text-body text-text-muted">{t("intro")}</p>
      </div>

      <form action={action} noValidate className="mt-5">
        <label htmlFor={FIELD_ID} className="text-small font-medium">
          {t("label")}
        </label>
        <div className="relative mt-2">
          <input
            ref={field}
            id={FIELD_ID}
            name="code"
            type={shown ? "text" : "password"}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onFocus={keepButtonVisible}
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={`min-h-tap w-full rounded-md border bg-surface-sunken py-3 pl-4 pr-24 text-body text-text-default ${
              error ? "border-error-text" : "border-border-strong"
            }`}
          />
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-controls={FIELD_ID}
            aria-label={shown ? t("hideLabel") : t("showLabel")}
            className="absolute inset-y-0 right-1 my-auto flex min-h-tap items-center gap-1 rounded-button px-3 text-small font-medium text-accent-text"
          >
            {shown ? <HideIcon aria-hidden="true" className="size-icon-sm" /> : <ShowIcon aria-hidden="true" className="size-icon-sm" />}
            {shown ? t("hide") : t("show")}
          </button>
        </div>

        {/* Always in the page, so screen readers announce the error when it appears. */}
        <p id={ERROR_ID} role="alert" className="mt-2 text-small text-error-text empty:mt-0">
          {error}
        </p>

        <button
          ref={submit}
          type="submit"
          disabled={pending}
          aria-busy={pending || undefined}
          className="mt-5 flex min-h-tap w-full items-center justify-center gap-2 rounded-button bg-accent-default px-5 py-3 text-title font-strong text-text-inverse shadow-card transition-opacity duration-(--motion-duration-quick) ease-gentle disabled:opacity-80"
        >
          {pending && <SpinnerIcon aria-hidden="true" className="size-icon motion-safe:animate-spin" />}
          {pending ? t("checking") : t("submit")}
        </button>

        <p id={NOTE_ID} className="mt-4 text-center text-caption text-text-muted">
          {t("staySignedIn")}
        </p>
      </form>
    </div>
  );
}
