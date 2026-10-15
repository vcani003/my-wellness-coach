"use client";
/** A labelled radio group (Base UI), styled as a compact segmented control. */
import { Radio } from "@base-ui/react/radio";
import { RadioGroup as BaseRadioGroup } from "@base-ui/react/radio-group";
import { useId } from "react";

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
        className="flex rounded-button border-2 border-border-outline bg-surface-raised p-0.5"
      >
        {options.map((o) => (
          <label
            key={o.value}
            className="flex min-h-tap cursor-pointer items-center rounded-button px-3 text-small font-medium text-text-default has-data-checked:bg-accent-default has-data-checked:text-text-on-accent font-strong has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring"
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
        className="flex flex-wrap self-start rounded-button border-2 border-border-outline bg-surface-raised p-0.5"
      >
        {options.map((o) => (
          <label
            key={o.value}
            className="flex min-h-tap cursor-pointer items-center rounded-button px-3 text-small font-medium text-text-default has-data-checked:bg-accent-default has-data-checked:text-text-on-accent font-strong has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring"
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
