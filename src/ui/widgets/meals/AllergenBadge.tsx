"use client";
/**
 * The allergen badge (0019, 0024): a small plum "Allergy" badge, the one place plum is used. Tap
 * it to see whose allergy it is and their own note, word for word. It only reflects what's saved:
 * never "safe", never advice. The flags are computed by code on the server.
 * The details are always in the accessible description, so a screen reader hears them without tapping.
 */
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import type { AllergenFlag } from "@/contracts/common";
import { AllergyIcon } from "@/ui/primitives/icons";
import { useKitchenData } from "@/ui/sync/KitchenDataContext";
import { useMeals } from "./MealsContext";

export function useAllergyLines(flags: AllergenFlag[]) {
  const t = useTranslations("meals.allergy");
  const { me } = useKitchenData();
  const { members } = useMeals();
  // One line per person and allergy; the same allergen named twice (title + ingredient) shows once.
  const seen = new Set<string>();
  const lines: { key: string; contains: string; note?: string }[] = [];
  for (const f of flags) {
    const key = `${f.userId}|${f.subject}|${f.ingredient.toLocaleLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mine = f.userId === me.id;
    const name = members.find((m) => m.userId === f.userId)?.displayName?.trim() || t("someone");
    lines.push({
      key,
      contains: mine
        ? t("containsYours", { ingredient: f.ingredient, subject: f.subject })
        : t("contains", { ingredient: f.ingredient, name, subject: f.subject }),
      ...(f.note?.trim() ? { note: mine ? t("yourNote", { note: f.note.trim() }) : t("theirNote", { note: f.note.trim() }) } : {}),
    });
  }
  return lines;
}

export function AllergenBadge({ flags, startOpen = false }: { flags: AllergenFlag[]; startOpen?: boolean }) {
  const t = useTranslations("meals.allergy");
  const [open, setOpen] = useState(startOpen);
  const panelId = useId();
  const lines = useAllergyLines(flags);
  if (lines.length === 0) return null;
  const summary = lines.map((l) => [l.contains, l.note].filter(Boolean).join(" ")).join(" ");
  return (
    <div className="flex flex-col items-start gap-1" data-allergy="">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t("badgeLabel", { details: summary })}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-tap items-center gap-1 rounded-button border-2 border-allergy-border bg-allergy-bg px-3 text-small font-strong text-allergy-text"
      >
        <AllergyIcon aria-hidden="true" className="size-icon-sm text-allergy-border" />
        {t("badge")}
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="rounded-md border-l-4 border-allergy-border bg-allergy-bg px-3 py-2 text-small text-allergy-text"
      >
        {lines.map((l) => (
          <p key={l.key}>
            {l.contains}
            {l.note && <span className="block">{l.note}</span>}
          </p>
        ))}
      </div>
    </div>
  );
}
