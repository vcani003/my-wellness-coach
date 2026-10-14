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
        className="flex rounded-button border border-border-strong bg-surface-raised p-0.5"
      >
        {options.map((o) => (
          <label
            key={o.value}
            className="flex min-h-tap cursor-pointer items-center rounded-button px-3 text-small font-medium text-text-default has-data-checked:bg-accent-default has-data-checked:text-text-inverse has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring"
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
