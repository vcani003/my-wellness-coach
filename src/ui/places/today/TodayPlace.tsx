"use client";
/**
 * Today: the focal hero (Lumi, the greeting and the date, on the soft pink → peach hero card;
 * 0038: one focal point, exaggerated scale), the allergy confirmations banner (0019 AI7), then a
 * card from each place that adds one, in dock order, each in its own error boundary (0018).
 */
import { useFormatter, useTranslations } from "next-intl";
import { LumiHalo } from "@/ui/lumi/Lumi";
import { ConfirmBanner } from "@/ui/settings/ConfirmPrompt";
import { useKitchenData } from "@/ui/sync/KitchenDataContext";
import { PlaceErrorBoundary } from "../PlaceErrorBoundary";
import { PlaceFailed } from "../Place";
import { places } from "../registry";
import type { PlaceProps } from "../types";

export function greetingKey(hour: number): "morning" | "afternoon" | "evening" {
  return hour < 11 ? "morning" : hour < 17 ? "afternoon" : "evening";
}

export function TodayPlace({ onRetry }: PlaceProps) {
  const t = useTranslations("today");
  const format = useFormatter();
  const { me, now } = useKitchenData();
  const cards = places.filter((p) => p.TodayCard);

  return (
    <>
      <div className="hero mt-3 flex items-center gap-4 px-6 py-6">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="eyebrow" suppressHydrationWarning>
            {format.dateTime(now, { weekday: "long", month: "long", day: "numeric" })}
          </p>
          <h2 className="text-display font-medium" suppressHydrationWarning>
            {t(`greeting.${greetingKey(now.getHours())}`, { name: me.name })}
          </h2>
          <p className="text-small text-text-muted">{t("intro")}</p>
        </div>
        <LumiHalo state="idle" size="lumi-lg" />
      </div>
      <ConfirmBanner />
      {cards.map((p) => {
        const Card = p.TodayCard!;
        return (
          <PlaceErrorBoundary key={p.id} placeId={`${p.id}.today`} onRetry={onRetry} fallback={(retry) => <PlaceFailed retry={retry} />}>
            <Card />
          </PlaceErrorBoundary>
        );
      })}
    </>
  );
}
