"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { unlock, type UnlockState } from "./actions";

export function UnlockForm() {
  const t = useTranslations("unlock");
  const [state, action, pending] = useActionState<UnlockState, FormData>(unlock, {});
  return (
    <>
      <h1>{t("title")}</h1>
      <p>{t("intro")}</p>
      <form action={action} noValidate>
      <label htmlFor="code">{t("label")}</label>
      <input
        id="code"
        name="code"
        type="password"
        autoComplete="current-password"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        aria-invalid={state.error ? true : undefined}
        aria-describedby={state.error ? "code-error" : undefined}
      />
      <p id="code-error" role="alert">
        {state.error ? t(`errors.${state.error.key}`, { minutes: state.error.minutes ?? 1 }) : ""}
      </p>
      <button type="submit" disabled={pending}>
        {pending ? t("checking") : t("submit")}
      </button>
      </form>
    </>
  );
}
