"use client";
import { useActionState } from "react";
import { unlock, type UnlockState } from "./actions";

export function UnlockForm() {
  const [state, action, pending] = useActionState<UnlockState, FormData>(unlock, {});
  return (
    <form action={action} noValidate>
      <label htmlFor="code">Access code</label>
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
        {state.error ?? ""}
      </p>
      <button type="submit" disabled={pending}>
        {pending ? "Checking…" : "Unlock"}
      </button>
    </form>
  );
}
