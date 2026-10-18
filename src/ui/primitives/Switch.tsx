"use client";
/**
 * An on/off switch (Base UI, role "switch"): a 44 px tall hit area around a drawn track. The
 * state is never colour alone: the thumb moves, and the track gets a tick when on.
 */
import { Switch as Base } from "@base-ui/react/switch";

export function Switch({
  checked,
  onChange,
  disabled,
  labelledBy,
  describedBy,
  ...data
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  labelledBy: string;
  describedBy?: string;
  [data: `data-${string}`]: string | undefined;
}) {
  return (
    <Base.Root
      checked={checked}
      onCheckedChange={(next) => onChange(next)}
      disabled={disabled}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className="switch"
      {...data}
    >
      <Base.Thumb className="switch-thumb" />
    </Base.Root>
  );
}
