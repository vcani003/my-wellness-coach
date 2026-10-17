"use client";
/**
 * The frame every place sits in: a named region (its title, e.g. "Kitchen"), the place's screen,
 * and its own error boundary (0018). Route pages render `<Place id="kitchen" />`; the shell
 * provides `onRetry` (refresh the kitchen) through `PlaceRetryContext`.
 */
import { AppearScope } from "@/ui/primitives/Appear";
import { useTranslations } from "next-intl";
import { createContext, useContext, type ReactNode } from "react";
import { PlaceErrorBoundary } from "./PlaceErrorBoundary";
import { places } from "./registry";

const PlaceRetryContext = createContext<() => void>(() => {});
export const PlaceRetryProvider = PlaceRetryContext.Provider;
export const usePlaceRetry = () => useContext(PlaceRetryContext);

/** "Couldn't load this · Retry", in place. */
export function PlaceFailed({ retry }: { retry: () => void }) {
  const t = useTranslations("workspace");
  return (
    <p className="flex flex-wrap items-center gap-2 rounded-md bg-error-bg px-4 py-3 text-small text-error-text">
      {t("widgetError")}
      <button type="button" onClick={retry} className="btn-quiet underline">
        {t("retry")}
      </button>
    </p>
  );
}

export function PlaceSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-label={title} data-place={id} className="place-enter mx-auto flex w-full max-w-prose flex-col gap-4 pb-6">
      {/* Rows, cards and notes that turn up while you're here ease in; the place's own arrival is .place-enter. */}
      <AppearScope>{children}</AppearScope>
    </section>
  );
}

export function Place({ id }: { id: string }) {
  const t = useTranslations();
  const onRetry = usePlaceRetry();
  const def = places.find((p) => p.id === id);
  if (!def) return null;
  const Body = def.Component;
  return (
    <PlaceSection id={def.id} title={t(def.titleKey)}>
      <PlaceErrorBoundary placeId={def.id} onRetry={onRetry} fallback={(retry) => <PlaceFailed retry={retry} />}>
        <Body onRetry={onRetry} />
      </PlaceErrorBoundary>
    </PlaceSection>
  );
}
