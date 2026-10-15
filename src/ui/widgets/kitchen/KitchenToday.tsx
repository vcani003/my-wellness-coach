"use client";
/**
 * The Kitchen's card on Today: what changed since your last visit (and "Levi used up the eggs"
 * while you look, ux.md §6), To review, and **Use it up**: the few things worth cooking soon, from
 * facts only (defrosted, days in the fridge, leftovers; 0025), with one button that asks Lumi for
 * ideas that use them. An empty kitchen gets a welcome instead.
 */
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRef } from "react";
import { useAskLumi } from "@/ui/chat/AskLumi";
import { itemName } from "@/ui/fallbacks";
import { LUMI_ART } from "@/ui/lumi/Lumi";
import { SparkleIcon } from "@/ui/primitives/icons";
import { useKitchenData } from "@/ui/sync/KitchenDataContext";
import { PlaceTile } from "./KitchenWidget";
import { groupItems, useItUpRows, type UseItUpReason } from "./model";
import { LiveRemovals, SinceLastVisit } from "./SharedCues";
import { ToReview } from "./ToReview";

export function KitchenToday() {
  const t = useTranslations("today");
  const { snapshot, now, cues } = useKitchenData();
  const rootRef = useRef<HTMLDivElement>(null);
  const state = snapshot.state;
  if (!state) return null;
  const empty = groupItems(state.items).length === 0;

  return (
    <div ref={rootRef} tabIndex={-1} className="flex flex-col gap-4 outline-none">
      {cues && <SinceLastVisit cues={cues} onDismissed={() => rootRef.current?.focus()} />}
      {cues && <LiveRemovals cues={cues} />}
      <ToReview reviews={state.toReview} finalFocus={rootRef} />
      {empty ? (
        <div className="card flex items-center gap-4 px-5 py-5">
          {/* eslint-disable-next-line @next/next/no-img-element -- a small static SVG */}
          <img src={LUMI_ART.listening} alt="" width={72} height={72} className="size-sticker-md shrink-0" />
          <div className="flex flex-col gap-1">
            <p className="text-title font-medium">{t("emptyTitle")}</p>
            <p className="text-small text-text-muted">{t("emptyBody")}</p>
          </div>
        </div>
      ) : (
        <UseItUp now={now} />
      )}
    </div>
  );
}

function UseItUp({ now }: { now: Date }) {
  const t = useTranslations("today.useItUp");
  const tAll = useTranslations();
  const locale = useLocale();
  const { snapshot } = useKitchenData();
  const { ask, canAsk } = useAskLumi();
  const rows = useItUpRows(snapshot.state?.items ?? [], now);
  const reason = (r: UseItUpReason) => t(`reason.${r.kind}`, { days: r.days });

  if (!rows.length) {
    return (
      <p className="flex flex-wrap items-center gap-x-2 text-small text-text-muted">
        <span>{t("nothing")}</span>
        <Link href="/kitchen" className="btn-quiet px-0 underline">
          {t("seeKitchen")}
        </Link>
      </p>
    );
  }

  return (
    <section aria-labelledby="today-use-it-up" className="card flex flex-col gap-3 px-5 py-5">
      <h2 id="today-use-it-up" className="text-title font-medium">
        {t("title")}
      </h2>
      <ul className="flex flex-col gap-2">
        {rows.map(({ item, reason: r }) => (
          <li key={item.id} data-entity-id={item.id} className="flex items-center gap-3">
            <PlaceTile place={item.location?.value ?? "unknown"} />
            <span className="flex flex-col">
              <span className="text-body font-strong">{itemName(item.name.value, tAll, locale)}</span>
              <span className="text-small text-text-muted">{reason(r)}</span>
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={!canAsk}
        onClick={() => ask(t("ask"))}
        className="btn btn-primary self-start"
      >
        <SparkleIcon aria-hidden="true" className="size-icon" />
        {t("getIdeas")}
      </button>
    </section>
  );
}
