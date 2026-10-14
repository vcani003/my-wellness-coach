"use client";
/**
 * Sign-in building blocks (Clay & Honey, 0024), shared by `/unlock`, `/join/<token>`,
 * `/reset/<token>` and Settings → Change passphrase, so they all look and behave the same.
 *
 * - `AuthCard`: the calm centred card with the Kitchen mark, an h1 and an intro line.
 * - `SecretField`: a passphrase or access-code field with **Show/Hide** (long phrases are typed on
 *   phones). The toggle's name says what it will do ("Show passphrase"). `autoComplete` is passed
 *   through so password managers fill (`current-password`) or offer to save (`new-password`).
 * - `TextField`: the name field (`autoComplete="username"`, so a password manager saves the pair).
 * Errors are rendered by the form (one live region per form), and tied in with `describedBy`.
 */
import { useState, type ReactNode, type Ref } from "react";
import { HideIcon, KitchenMarkIcon, ShowIcon } from "@/ui/primitives/icons";

export const inputClass = (invalid: boolean, extra = "") =>
  `min-h-tap w-full rounded-md border bg-surface-sunken py-3 pl-4 text-body text-text-default ${extra} ${
    invalid ? "border-error-text" : "border-border-strong"
  }`;

export const primaryButtonClass =
  "flex min-h-tap w-full items-center justify-center gap-2 rounded-button bg-accent-default px-5 py-3 text-title font-strong text-text-inverse shadow-card transition-opacity duration-(--motion-duration-quick) ease-gentle disabled:opacity-80";

export const quietLinkClass =
  "flex min-h-tap w-full items-center justify-center rounded-button px-3 text-small font-medium text-accent-text underline underline-offset-2";

export function AuthCard({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="w-full max-w-sm rounded-lg bg-surface-raised px-5 py-6 shadow-card">
      <div className="flex flex-col items-center text-center">
        <span aria-hidden="true" className="flex size-fab items-center justify-center rounded-md bg-accent-default text-text-inverse">
          <KitchenMarkIcon className="size-6" />
        </span>
        <h1 className="mt-4 font-heading text-heading font-strong">{title}</h1>
        {intro && <p className="mt-2 text-body text-text-muted">{intro}</p>}
      </div>
      {children}
    </div>
  );
}

interface BaseFieldProps {
  id: string;
  name?: string;
  label: string;
  value: string;
  onChange(value: string): void;
  invalid?: boolean;
  /** IDs of the hint and error that describe this field, in reading order. */
  describedBy?: (string | null | undefined | false)[];
  inputRef?: Ref<HTMLInputElement>;
  onFocus?(): void;
  enterKeyHint?: "go" | "next" | "done";
  disabled?: boolean;
}

const describe = (ids: BaseFieldProps["describedBy"]) => ids?.filter(Boolean).join(" ") || undefined;

export function TextField({ id, name, label, value, onChange, invalid, describedBy, inputRef, onFocus, enterKeyHint, disabled }: BaseFieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-small font-medium">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        name={name ?? id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        autoComplete="username"
        autoCapitalize="words"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint={enterKeyHint ?? "next"}
        maxLength={40}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describe(describedBy)}
        className={inputClass(Boolean(invalid), "pr-4")}
      />
    </div>
  );
}

export function SecretField({
  id,
  name,
  label,
  value,
  onChange,
  invalid,
  describedBy,
  inputRef,
  onFocus,
  enterKeyHint,
  disabled,
  autoComplete,
  showLabel,
  hideLabel,
  showText,
  hideText,
  hint,
}: BaseFieldProps & {
  autoComplete: "current-password" | "new-password";
  showLabel: string;
  hideLabel: string;
  showText: string;
  hideText: string;
  /** Shown under the field and read with it (e.g. the strength hint). Not a live region. */
  hint?: string;
}) {
  const [shown, setShown] = useState(false);
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-small font-medium">
        {label}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          name={name ?? id}
          type={shown ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint={enterKeyHint ?? "go"}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describe([hint ? hintId : null, ...(describedBy ?? [])])}
          className={inputClass(Boolean(invalid), "pr-24")}
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-controls={id}
          aria-label={shown ? hideLabel : showLabel}
          className="absolute inset-y-0 right-1 my-auto flex min-h-tap items-center gap-1 rounded-button px-3 text-small font-medium text-accent-text"
        >
          {shown ? <HideIcon aria-hidden="true" className="size-icon-sm" /> : <ShowIcon aria-hidden="true" className="size-icon-sm" />}
          {shown ? hideText : showText}
        </button>
      </div>
      {hint && (
        <p id={hintId} className="text-caption text-text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Once the iPhone keyboard has opened, scroll `target` (the submit button) into view. */
export function revealOnKeyboard(target: () => HTMLElement | null) {
  const vv = window.visualViewport;
  if (!vv) return;
  const reveal = () => requestAnimationFrame(() => requestAnimationFrame(() => target()?.scrollIntoView({ block: "nearest" })));
  vv.addEventListener("resize", reveal, { once: true });
  window.setTimeout(() => vv.removeEventListener("resize", reveal), 1500);
}
