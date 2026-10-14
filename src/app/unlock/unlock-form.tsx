"use client";
/**
 * `/unlock` (Clay & Honey, 0024; SU1 Rec). Two calm modes on one card:
 * - **Name + passphrase** (the default): `signInWithPassphrase`. `autocomplete` `username` /
 *   `current-password`, so password managers fill both.
 * - **"Use an access code instead"**: the original access-code form, unchanged, kept as a backup
 *   (`./actions` `unlock`).
 * Switching modes moves focus to the new mode's first field. Each form keeps what was typed after
 * an error and puts focus back on the field to fix; its error is one `role="alert"` region that is
 * always in the page, so it's announced when it appears. On iPhone the keyboard covers the page, so
 * once it opens we scroll the submit button into view (`.unlock-page` pads by --keyboard-inset).
 */
import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { AuthCard, primaryButtonClass, quietLinkClass, revealOnKeyboard, SecretField, TextField } from "@/ui/auth/fields";
import { SpinnerIcon } from "@/ui/primitives/icons";
import { useKeyboardInset } from "@/ui/shell/viewport";
import { unlock, type UnlockState } from "./actions";
import { signInWithPassphrase } from "./passphrase-actions";

type Mode = "passphrase" | "code";

export function UnlockForm() {
  const t = useTranslations("unlock");
  // Each form focuses its first field when it mounts, so switching modes moves focus there.
  const [mode, setMode] = useState<Mode>("passphrase");
  useKeyboardInset();

  return (
    <AuthCard title={t("title")} intro={mode === "passphrase" ? t("introPassphrase") : t("intro")}>
      {mode === "passphrase" ? <PassphraseForm /> : <CodeForm />}
      <button type="button" onClick={() => setMode(mode === "passphrase" ? "code" : "passphrase")} className={`${quietLinkClass} mt-3`}>
        {mode === "passphrase" ? t("useCode") : t("usePassphrase")}
      </button>
    </AuthCard>
  );
}

const NAME_ID = "signin-name";
const PASS_ID = "signin-passphrase";
const PASS_ERROR_ID = "signin-error";
const PASS_NOTE_ID = "signin-note";

function PassphraseForm() {
  const t = useTranslations("unlock");
  const tAuth = useTranslations("auth");
  const [name, setName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<{ key: string; minutes?: number } | null>(null);
  const [pending, startTransition] = useTransition();
  const nameRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);
  const submit = useRef<HTMLButtonElement>(null);

  // This page has one job: start in the first field (jsx-a11y's no-autofocus is about busy pages).
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    if (!name.trim() || !passphrase) {
      setError({ key: "empty" });
      (name.trim() ? passRef : nameRef).current?.focus();
      return;
    }
    setError(null);
    startTransition(async () => {
      let res;
      try {
        res = await signInWithPassphrase({ name, passphrase });
      } catch {
        res = { ok: false as const, error: { key: "failed" as const } };
      }
      // Success redirects to `/`; nothing to do here.
      if (!res || res.ok !== false) return;
      setError(res.error);
      passRef.current?.focus();
    });
  };

  const known = ["empty", "wrong", "tooMany", "notConfigured", "failed"];
  const errorText = error ? t(`passphraseErrors.${known.includes(error.key) ? error.key : "failed"}`, { minutes: error.minutes ?? 1 }) : "";
  const describedBy = [errorText ? PASS_ERROR_ID : null, PASS_NOTE_ID];

  return (
    <form onSubmit={onSubmit} noValidate className="mt-5">
      <TextField
        id={NAME_ID}
        name="username"
        label={t("nameLabel")}
        value={name}
        onChange={setName}
        inputRef={nameRef}
        invalid={Boolean(errorText) && (error?.key !== "empty" || !name.trim())}
        describedBy={describedBy}
        onFocus={() => revealOnKeyboard(() => submit.current)}
      />
      <div className="mt-4" />
      <SecretField
        id={PASS_ID}
        name="password"
        label={t("passphraseLabel")}
        value={passphrase}
        onChange={setPassphrase}
        inputRef={passRef}
        autoComplete="current-password"
        showLabel={tAuth("showPassphrase")}
        hideLabel={tAuth("hidePassphrase")}
        showText={tAuth("show")}
        hideText={tAuth("hide")}
        invalid={Boolean(errorText) && (error?.key !== "empty" || !passphrase)}
        describedBy={describedBy}
        onFocus={() => revealOnKeyboard(() => submit.current)}
      />

      {/* Always in the page, so screen readers announce the error when it appears. */}
      <p id={PASS_ERROR_ID} role="alert" className="mt-2 text-small text-error-text empty:mt-0">
        {errorText}
      </p>

      <button ref={submit} type="submit" disabled={pending} aria-busy={pending || undefined} className={`${primaryButtonClass} mt-5`}>
        {pending && <SpinnerIcon aria-hidden="true" className="size-icon motion-safe:animate-spin" />}
        {pending ? t("signingIn") : t("signIn")}
      </button>

      <p id={PASS_NOTE_ID} className="mt-4 text-center text-caption text-text-muted">
        {t("staySignedIn")}
      </p>
    </form>
  );
}

const FIELD_ID = "code";
const ERROR_ID = "code-error";
const NOTE_ID = "code-note";

/** The access-code form, unchanged in behaviour (backend-data.md §7, now a backup). */
function CodeForm() {
  const t = useTranslations("unlock");
  const [state, action, pending] = useActionState<UnlockState, FormData>(unlock, {});
  const [code, setCode] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const submit = useRef<HTMLButtonElement>(null);

  // At load, and after each failed try: back to the field.
  useEffect(() => {
    field.current?.focus();
  }, [state]);

  const error = state.error ? t(`errors.${state.error.key}`, { minutes: state.error.minutes ?? 1 }) : "";

  return (
    <form action={action} noValidate className="mt-5">
      <SecretField
        id={FIELD_ID}
        name="code"
        label={t("label")}
        value={code}
        onChange={setCode}
        inputRef={field}
        autoComplete="current-password"
        showLabel={t("showLabel")}
        hideLabel={t("hideLabel")}
        showText={t("show")}
        hideText={t("hide")}
        invalid={Boolean(error)}
        describedBy={[error ? ERROR_ID : null, NOTE_ID]}
        onFocus={() => revealOnKeyboard(() => submit.current)}
      />

      {/* Always in the page, so screen readers announce the error when it appears. */}
      <p id={ERROR_ID} role="alert" className="mt-2 text-small text-error-text empty:mt-0">
        {error}
      </p>

      <button ref={submit} type="submit" disabled={pending} aria-busy={pending || undefined} className={`${primaryButtonClass} mt-5`}>
        {pending && <SpinnerIcon aria-hidden="true" className="size-icon motion-safe:animate-spin" />}
        {pending ? t("checking") : t("submit")}
      </button>

      <p id={NOTE_ID} className="mt-4 text-center text-caption text-text-muted">
        {t("staySignedIn")}
      </p>
    </form>
  );
}
