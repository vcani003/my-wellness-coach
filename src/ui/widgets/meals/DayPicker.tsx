"use client";
/**
 * The day control on a meal (0045 KOS1, 0058): a small pill that opens a menu of days. Only the
 * plan window is offered (yesterday to 21 days ahead), so a day outside it can't be picked; a
 * planned meal also gets **No day**. A menu of radio items rather than a date input: every day
 * reads "Tomorrow · Sat, Oct 17" in the reader's language, the window is the whole choice, and it
 * needs no date library. Keyboard: arrows move, Enter picks, Esc closes, focus returns (Base UI).
 */
import { useLocale, useTranslations } from "next-intl";
import { useId } from "react";
import type { WeekPlan } from "@/contracts/week-plan";
import { formatPlanDay } from "@/ui/plan-day-format";
import { CheckIcon, PlanIcon } from "@/ui/primitives/icons";
import { Menu } from "@/ui/primitives/Menu";
import { dayOptions, relativeDay } from "./week-model";

const NONE = "none";

/** "Today" / "Tomorrow" / "Yesterday", else "Tue, Oct 20". */
export function usePlanDayName() {
  const t = useTranslations("meals.plan");
  const locale = useLocale();
  return (date: string, today: string, style: "short" | "long" = "short") => {
    const rel = relativeDay(date, today);
    return rel ? t(rel) : formatPlanDay(date, locale, style);
  };
}

export function DayPicker({
  title,
  date,
  today,
  window,
  mode,
  disabled,
  describedBy,
  onPick,
}: {
  title: string;
  /** The meal's day now; absent = no day. */
  date?: string;
  today: string;
  window: WeekPlan["window"];
  /** `change`: a planned meal (with No day). `plan`: a chosen meal, planned for the picked day. */
  mode: "change" | "plan";
  disabled?: boolean;
  describedBy?: string;
  onPick: (date: string | null) => void;
}) {
  const t = useTranslations("meals.plan");
  const tRecipe = useTranslations("meals.recipe");
  const locale = useLocale();
  const dayName = usePlanDayName();
  const titleId = useId();
  const options = dayOptions(window);

  const visible = mode === "plan" ? tRecipe("planForDay") : date ? dayName(date, today) : t("dayPick");
  const label =
    mode === "plan"
      ? tRecipe("planForDayLabel", { title })
      : date
        ? t("dayChangeLabel", { title, day: formatPlanDay(date, locale, "long") })
        : t("dayPickLabel", { title });

  const optionLabel = (d: string) => {
    const rel = relativeDay(d, today);
    return rel ? t("dayOption", { name: t(rel), date: formatPlanDay(d, locale, "short") }) : formatPlanDay(d, locale, "short");
  };

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={label}
        aria-describedby={describedBy}
        disabled={disabled}
        data-day-picker={date ?? NONE}
        className={`btn btn-small ${date ? "" : "text-text-muted"}`}
      >
        <PlanIcon aria-hidden="true" className="size-icon-sm text-accent-text" />
        {visible}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
          {/* tabIndex 0: the list scrolls (23 days), so the scroll area itself is keyboard-reachable (axe scrollable-region-focusable). */}
          <Menu.Popup tabIndex={0} className="max-h-[min(60dvh,26rem)] min-w-56 overflow-y-auto rounded-md bg-surface-raised p-1 shadow-pop">
            <p id={titleId} className="eyebrow px-3 pt-2 pb-1">
              {t("whichDay")}
            </p>
            <Menu.RadioGroup
              aria-labelledby={titleId}
              value={date ?? NONE}
              onValueChange={(value: string) => {
                if (value === (date ?? NONE)) return;
                onPick(value === NONE ? null : value);
              }}
            >
              {options.map((d) => (
                <Menu.RadioItem
                  key={d}
                  value={d}
                  closeOnClick
                  data-day-option={d}
                  className="flex min-h-tap cursor-pointer items-center gap-2 rounded-md px-3 text-body data-highlighted:bg-surface-sunken"
                >
                  <span className={`flex-1 ${d === today ? "font-strong text-accent-text" : ""}`}>{optionLabel(d)}</span>
                  <Menu.RadioItemIndicator className="text-accent-text">
                    <CheckIcon aria-hidden="true" className="size-icon-sm" />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
              {mode === "change" && (
                <Menu.RadioItem
                  value={NONE}
                  closeOnClick
                  data-day-option={NONE}
                  className="mt-1 flex min-h-tap cursor-pointer items-center gap-2 rounded-md border-t border-border-default px-3 text-body data-highlighted:bg-surface-sunken"
                >
                  <span className="flex-1">{t("noDay")}</span>
                  <Menu.RadioItemIndicator className="text-accent-text">
                    <CheckIcon aria-hidden="true" className="size-icon-sm" />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              )}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
