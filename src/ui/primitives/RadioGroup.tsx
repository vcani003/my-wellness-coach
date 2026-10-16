"use client";
/** A labelled radio group (Base UI), styled as a compact segmented control. */
import { Radio } from "@base-ui/react/radio";
import { RadioGroup as BaseRadioGroup } from "@base-ui/react/radio-group";
import { useId, type ReactNode } from "react";

export function SegmentedRadio({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <span id={id} className="text-caption text-warning-text">
        {label}
      </span>
      <BaseRadioGroup
        aria-labelledby={id}
        value={value}
        onValueChange={(v) => onChange(String(v))}
        disabled={disabled}
        className="seg-group"
      >
        {options.map((o) => (
          <label
            key={o.value}
            className="seg-option cursor-pointer has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring"
          >
            <Radio.Root value={o.value} className="sr-only">
              <Radio.Indicator />
            </Radio.Root>
            {o.label}
          </label>
        ))}
      </BaseRadioGroup>
    </div>
  );
}

/**
 * A labelled choice row (Base UI radio group): the label on its own line, the options as a
 * segmented control under it, so three choices fit a phone. One tab stop; arrows move the choice.
 */
export function ChoiceRadio({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <span id={id} className="text-body font-medium">
        {label}
      </span>
      <BaseRadioGroup
        aria-labelledby={id}
        value={value}
        onValueChange={(v) => onChange(String(v))}
        disabled={disabled}
        className="seg-group flex-wrap self-start"
      >
        {options.map((o) => (
          <label
            key={o.value}
            className="seg-option cursor-pointer has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring"
          >
            <Radio.Root value={o.value} className="sr-only">
              <Radio.Indicator />
            </Radio.Root>
            {o.label}
          </label>
        ))}
      </BaseRadioGroup>
    </div>
  );
}

export interface ChoiceOption<V extends string> {
  value: V;
  label: ReactNode;
  /** Decorative art before the words (a place tile, a level meter). */
  icon?: ReactNode;
  /** A short tag after the words, e.g. "now"; read as "Pantry, now" when the label is plain text. */
  tag?: string;
  /** Extra attributes for tests and styling, e.g. `data-place`. */
  data?: Record<`data-${string}`, string>;
}

/**
 * A labelled single choice drawn as tappable tiles (Base UI radio group): one tab stop, arrows
 * move the choice. The chosen tile is ringed and bolder, so it never relies on colour alone.
 * `layout`: "grid" = 2 columns (room for a tile, a word and "now" even in a desktop dialog); "wrap" = chips that wrap; "list" = one per line.
 */
export function ChoiceTiles<V extends string>({
  label,
  hint,
  value,
  options,
  onChange,
  disabled,
  layout = "grid",
  ...data
}: {
  label: string;
  hint?: string;
  value: V | null;
  options: ChoiceOption<V>[];
  onChange: (value: V) => void;
  disabled?: boolean;
  layout?: "grid" | "wrap" | "list";
  [data: `data-${string}`]: string | undefined;
}) {
  const id = useId();
  const hintId = useId();
  const layoutClass =
    layout === "grid" ? "grid grid-cols-2 gap-2" : layout === "list" ? "flex flex-col gap-2" : "flex flex-wrap gap-2";
  return (
    <div className="flex flex-col gap-2" {...data}>
      <div className="flex flex-col">
        <span id={id} className="text-body font-medium">
          {label}
        </span>
        {hint && (
          <span id={hintId} className="text-caption text-text-muted">
            {hint}
          </span>
        )}
      </div>
      <BaseRadioGroup
        aria-labelledby={id}
        aria-describedby={hint ? hintId : undefined}
        value={value}
        onValueChange={(v) => onChange(v as V)}
        disabled={disabled}
        className={layoutClass}
      >
        {options.map((o) => (
          <label key={o.value} className={`choice ${layout === "list" ? "w-full" : ""}`} {...o.data}>
            {/* With a tag, the name is said in full ("Pantry, now"); the drawn tag is then decoration. */}
            <Radio.Root value={o.value} aria-label={o.tag && typeof o.label === "string" ? `${o.label}, ${o.tag}` : undefined} className="sr-only">
              <Radio.Indicator />
            </Radio.Root>
            {o.icon}
            <span className="min-w-0 flex-1">{o.label}</span>
            {o.tag && (
              <span aria-hidden="true" className="choice-tag">
                {o.tag}
              </span>
            )}
          </label>
        ))}
      </BaseRadioGroup>
    </div>
  );
}
