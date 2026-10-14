"use client";
/**
 * The `/join/<token>` and `/reset/<token>` forms (SU1 Rec; backend-data.md §7). Same calm card
 * as `/unlock`.
 * - **join:** "Join Vero's kitchen": your name + a passphrase → `acceptJoin`.
 * - **reset:** "Set your passphrase" for the named member → `acceptReset`. A hidden `username`
 *   field carries their name, so a password manager saves the right pair.
 * The passphrase field uses `autocomplete="new-password"`, Show/Hide, and a hint that counts to 12
 * characters and is never alarming (`strength.ts`). Too short is caught here first; everything
 * else is the server's answer. Success redirects to `/` (the server action does it). If the link
 * stops working meanwhile (used elsewhere, or expired), the card turns into `LinkGone`.
 */
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { AuthFailure } from "@/lib/auth/invites";
import { SpinnerIcon } from "@/ui/primitives/icons";
import { useKeyboardInset } from "@/ui/shell/viewport";
import { AuthCard, primaryButtonClass, revealOnKeyboard, SecretField, TextField } from "./fields";
import { LinkGone } from "./LinkGone";
import { passphraseHint, passphraseProblemKey } from "./strength";

/** What the server actions answer when they don't redirect. */
export type LinkSubmitResult = AuthFailure | undefined | void;

export type SetPassphraseFormProps =
  | {
      mode: "join";
      token: string;
      invitedBy: string;
      submit(input: { token: string; displayName: string; passphrase: string }): Promise<LinkSubmitResult>;
    }
  | {
      mode: "reset";
      token: string;
      forName: string;
      /** Who made the link: named if it stops working meanwhile. */
      invitedBy?: string;
      submit(input: { token: string; passphrase: string }): Promise<LinkSubmitResult>;
    };

const NAME_ID = "link-name";
const PASS_ID = "link-passphrase";
const ERROR_ID = "link-error";
const NOTE_ID = "link-note";

const NAME_ERRORS = new Set(["nameEmpty", "nameInvalid", "nameTaken"]);
const KNOWN = new Set([...NAME_ERRORS, "passphraseTooShort", "passphraseTooLong", "full", "tooMany", "notConfigured", "failed"]);

export function SetPassphraseForm(props: SetPassphraseFormProps) {
  const t = useTranslations("auth");
  const [name, setName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<{ key: string; minutes?: number } | null>(null);
  const [gone, setGone] = useState(false);
  const [pending, startTransition] = useTransition();
  const nameRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);
  const submit = useRef<HTMLButtonElement>(null);
  useKeyboardInset();

  // The page has one job: start in its first field.
  useEffect(() => {
    (props.mode === "join" ? nameRef : passRef).current?.focus();
  }, [props.mode]);

  const fail = (key: string, minutes?: number) => {
    setError({ key, minutes });
    (NAME_ERRORS.has(key) ? nameRef : passRef).current?.focus();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    if (props.mode === "join" && !name.trim()) return fail("nameEmpty");
    const weak = passphraseProblemKey(passphrase);
    if (weak) return fail(weak);
    setError(null);
    startTransition(async () => {
      let res: LinkSubmitResult;
      try {
        res = props.mode === "join" ? await props.submit({ token: props.token, displayName: name, passphrase }) : await props.submit({ token: props.token, passphrase });
      } catch {
        res = { ok: false, error: { key: "failed" } };
      }
      if (!res || res.ok !== false) return; // redirected to `/`
      if (res.error.key === "invalidLink") return setGone(true);
      fail(KNOWN.has(res.error.key) ? res.error.key : "failed", res.error.minutes);
    });
  };

  if (gone) return <LinkGone invitedBy={props.invitedBy} focusHeading />;

  const hint = passphraseHint(passphrase);
  const hintText = hint.key === "more" ? t("strength.more", { count: hint.count }) : t(`strength.${hint.key}`);
  const errorText = error ? t(`errors.${error.key}`, { minutes: error.minutes ?? 1 }) : "";
  const nameInvalid = Boolean(error && NAME_ERRORS.has(error.key));
  const passInvalid = Boolean(error && error.key.startsWith("passphrase"));
  const keyboard = () => revealOnKeyboard(() => submit.current);

  return (
    <AuthCard
      title={props.mode === "join" ? t("join.title", { name: props.invitedBy }) : t("reset.title")}
      intro={props.mode === "join" ? t("join.intro") : t("reset.intro", { name: props.forName })}
    >
      <form onSubmit={onSubmit} noValidate className="mt-5">
        {props.mode === "join" ? (
          <div className="mb-4">
            <TextField
              id={NAME_ID}
              name="username"
              label={t("join.nameLabel")}
              value={name}
              onChange={setName}
              inputRef={nameRef}
              invalid={nameInvalid}
              describedBy={[nameInvalid ? ERROR_ID : null]}
              onFocus={keyboard}
            />
          </div>
        ) : (
          // For password managers only: which account this passphrase belongs to.
          <input type="text" name="username" autoComplete="username" value={props.forName} readOnly hidden />
        )}
        <SecretField
          id={PASS_ID}
          name="new-password"
          label={props.mode === "join" ? t("join.passphraseLabel") : t("reset.passphraseLabel")}
          value={passphrase}
          onChange={setPassphrase}
          inputRef={passRef}
          autoComplete="new-password"
          showLabel={t("showPassphrase")}
          hideLabel={t("hidePassphrase")}
          showText={t("show")}
          hideText={t("hide")}
          hint={hintText}
          invalid={passInvalid}
          describedBy={[error && !nameInvalid ? ERROR_ID : null, NOTE_ID]}
          onFocus={keyboard}
        />

        {/* Always in the page, so screen readers announce the error when it appears. */}
        <p id={ERROR_ID} role="alert" className="mt-2 text-small text-error-text empty:mt-0">
          {errorText}
        </p>

        <button ref={submit} type="submit" disabled={pending} aria-busy={pending || undefined} className={`${primaryButtonClass} mt-5`}>
          {pending && <SpinnerIcon aria-hidden="true" className="size-icon motion-safe:animate-spin" />}
          {pending ? t(`${props.mode}.busy`) : t(`${props.mode}.submit`)}
        </button>

        <p id={NOTE_ID} className="mt-4 text-center text-caption text-text-muted">
          {t("staySignedIn")}
        </p>
      </form>
    </AuthCard>
  );
}
