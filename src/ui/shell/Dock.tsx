"use client";
/**
 * The Kitchen OS dock (0042): the five places as real links, so the phone's Back button works and
 * the chat stays mounted (it lives in the `(main)` layout). The current place is marked with
 * `aria-current="page"` and a peach fill plus bold label (not colour alone). Each is at least 52 px
 * tall. On desktop it's the slim left nav of 0034.
 */
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { PlaceDef } from "@/ui/places/types";

export function Dock({ places, currentId, onNavigate }: { places: readonly PlaceDef[]; currentId: string | null; onNavigate: (id: string) => void }) {
  const t = useTranslations();
  return (
    <nav aria-label={t("places.label")} className="dock-nav bg-surface-default px-3 pt-2 desk:border-r-2 desk:border-border-default desk:px-2 desk:pt-4">
      <ul className="flex justify-around gap-1 rounded-button border-2 border-border-outline bg-surface-raised p-1 shadow-sticker desk:flex-col desk:justify-start desk:rounded-lg desk:shadow-none">
        {places.map((p) => {
          const on = p.id === currentId;
          const Icon = p.Icon;
          return (
            <li key={p.id} className="flex flex-1 desk:flex-none">
              <Link
                href={p.href}
                aria-current={on ? "page" : undefined}
                onClick={() => onNavigate(p.id)}
                data-place-link={p.id}
                className={`flex min-h-[52px] w-full flex-col items-center justify-center gap-0.5 rounded-button px-1 text-caption desk:min-w-[72px] desk:rounded-md desk:py-2 ${
                  on ? "bg-accent-default font-strong text-text-on-accent" : "font-medium text-text-muted"
                }`}
              >
                <Icon aria-hidden="true" weight={on ? "fill" : "regular"} className="size-icon" />
                {t(p.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
