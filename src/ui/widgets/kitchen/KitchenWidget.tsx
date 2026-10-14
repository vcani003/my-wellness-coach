"use client";
/**
 * The Kitchen widget (ux.md §3, decisions 0011 and 0017): To review at the top, then items grouped Fridge / Freezer /
 * Pantry / Not sure where, "added X days ago", Running low, "New" / "Updated" after your own
 * message, and "Levi · just now" for the other person's changes, plus "Since your last visit" and
 * "Levi used up the eggs" for what left the list (SharedCues, ux.md §6). Empty, loading, error and
 * stale states stay inside the widget (0018).
 */
import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useRef } from "react";
import type { ItemRow } from "@/contracts/kitchen-state";
import { actorName, byOther as byOtherActor, itemName, sentenceCase } from "@/ui/fallbacks";
import { Collapsible } from "@/ui/primitives/Collapsible";
import { CaretDownIcon, SearchIcon } from "@/ui/primitives/icons";
import { useKitchenData, type ChangeMark } from "@/ui/sync/KitchenDataContext";
import type { WidgetProps } from "@/ui/workspace/types";
import { batchesOf, calendarDaysSince, groupItems, highlightParts, isDefrosted } from "./model";
import { requestSeeAllFocus } from "./see-all-focus";
import { LiveRemovals, SinceLastVisit } from "./SharedCues";
import { ToReview } from "./ToReview";

export function KitchenSummary() {
  const t = useTranslations("kitchen");
  const { snapshot } = useKitchenData();
  if (!snapshot.state) return null;
  const toReview = snapshot.state.toReview.length;
  // Collapsed on a phone, the bar is the only hint that something waits in To review.
  return (
    <>
      {t("count", { count: snapshot.state.items.length })}
      {toReview > 0 && ` · ${t("review.summary", { count: toReview })}`}
    </>
  );
}

export function KitchenWidget({ onRetry }: WidgetProps) {
  const t = useTranslations("kitchen");
  const format = useFormatter();
  const { snapshot, marks, remoteIds, me, now, cues } = useKitchenData();
  const { state, status, syncedAt } = snapshot;
  // Where focus goes when a To review sheet closes (the card it came from may be gone).
  const rootRef = useRef<HTMLDivElement>(null);

  if (!state) {
    if (status === "error") {
      return (
        <p className="flex flex-wrap items-center gap-2 rounded-md bg-error-bg px-4 py-3 text-small text-error-text">
          {t("error")}
          <button type="button" onClick={onRetry} className="min-h-tap rounded-button px-3 font-medium text-accent-text underline">
            {t("retry")}
          </button>
        </p>
      );
    }
    return (
      <div aria-busy="true" className="flex flex-col gap-2">
        <p className="text-small text-text-muted">{t("loading")}</p>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-tap rounded-sm bg-surface-sunken" />
        ))}
      </div>
    );
  }

  const groups = groupItems(state.items);
  return (
    <div ref={rootRef} tabIndex={-1} className="flex flex-col gap-4 outline-none">
      {status === "stale" && syncedAt !== null && (
        <p className="rounded-sm bg-surface-sunken px-3 py-2 text-small text-text-muted">
          {t("stale", { time: format.dateTime(new Date(syncedAt), { hour: "numeric", minute: "2-digit" }) })}
        </p>
      )}
      {cues && <SinceLastVisit cues={cues} onDismissed={() => rootRef.current?.focus()} />}
      {cues && <LiveRemovals cues={cues} />}
      <ToReview reviews={state.toReview} finalFocus={rootRef} />
      {groups.length > 0 && (
        // CAT1: the full view (sorting, search) is one tap away; this compact list stays as it is.
        <div className="-my-2 flex items-center justify-end gap-1">
          <Link
            href="/kitchen"
            data-kitchen-opener="search"
            aria-label={t("seeAll.searchLink")}
            onClick={() => requestSeeAllFocus("search")}
            className="flex size-tap items-center justify-center rounded-full text-accent-text"
          >
            <SearchIcon aria-hidden="true" className="size-icon" />
          </Link>
          <Link
            href="/kitchen"
            data-kitchen-opener="all"
            onClick={() => requestSeeAllFocus("heading")}
            className="flex min-h-tap items-center rounded-button px-3 text-small font-medium text-accent-text underline underline-offset-2"
          >
            {t("seeAll.link", { count: state.items.filter((i) => i.stock?.value !== "out").length })}
          </Link>
        </div>
      )}
      {groups.length === 0 ? (
        <p className="text-body text-text-muted">{t("empty")}</p>
      ) : (
        groups.map((group) => (
          <section key={group.key} aria-labelledby={`kitchen-group-${group.key}`} data-group={group.key}>
            <h3
              id={`kitchen-group-${group.key}`}
              className="mb-1 text-caption font-strong tracking-wide text-text-muted"
            >
              {t(`groups.${group.key}`)}
            </h3>
            <ul className="flex flex-col">
              {group.items.map((item) => (
                <ItemRowView
                  key={item.id}
                  item={item}
                  mark={marks[item.id]}
                  remote={remoteIds.has(item.id)}
                  meId={me.id}
                  now={now}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

/** A search match inside a name (CAT1): marked, so it doesn't rely on colour alone (bold too). */
export function HighlightedName({ text, query }: { text: string; query?: string }) {
  if (!query?.trim()) return <>{text}</>;
  return (
    <>
      {highlightParts(text, query).map((part, i) =>
        part.match ? (
          <mark key={i} className="bg-highlight-bg font-strong text-text-default">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

export function ItemRowView({
  item,
  mark,
  remote,
  meId,
  now,
  showPlace = false,
  query,
}: {
  item: ItemRow;
  mark?: ChangeMark;
  remote: boolean;
  meId: string;
  now: Date;
  /** See all's By type and search results: "Fish sauce · Pantry" (CAT1). */
  showPlace?: boolean;
  /** See all's search: the words to mark in the name. */
  query?: string;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const locale = useLocale();
  const days = calendarDaysSince(item.addedAt, now);
  const byOther = "missing" in item.updatedBy || item.updatedBy.id !== meId;
  const updatedMs = now.getTime() - new Date(item.updatedAt).getTime();
  const when = updatedMs < 60_000 ? t("kitchen.justNow") : format.relativeTime(new Date(item.updatedAt), now);
  const highlighted = Boolean(mark) || remote;
  const batches = batchesOf(item);
  const several = batches.length > 1;
  const name = itemName(item.name.value, t, locale);

  const content = (
    <>
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-body font-medium">
          <HighlightedName text={name} query={query} />
          {showPlace && (
            <span className="text-small font-regular text-text-muted">
              {" · "}
              {t(`kitchen.groups.${item.location?.value ?? "unknown"}`)}
            </span>
          )}
        </span>
        {item.quantity && <span className="text-small text-text-muted">{item.quantity.value.asSaid}</span>}
        {mark && (
          <span className="rounded-button bg-highlight-bg px-2 text-caption font-strong text-highlight-text">
            {t(mark === "new" ? "kitchen.new" : "kitchen.updated")}
          </span>
        )}
      </span>
      <span className="flex flex-wrap gap-x-2 text-caption text-text-muted">
        {/* "2 batches · oldest 12 days" (0025): the row's addedAt is the oldest open batch's. */}
        <span>{several ? t("kitchen.batches.summary", { count: batches.length, days }) : t("kitchen.addedDaysAgo", { days })}</span>
        {item.stock?.value === "low" && <span className="font-strong text-warning-text">{t("kitchen.low")}</span>}
        {item.opened?.value && <span>{t("kitchen.opened")}</span>}
        {item.frozen?.value && item.location?.value !== "freezer" && <span>{t("kitchen.frozen")}</span>}
        {isDefrosted(item) && <span>{t("kitchen.defrosted")}</span>}
        {byOther && (
          <span className={remote ? "font-strong text-highlight-text" : ""}>
            {t("kitchen.byPerson", { name: sentenceCase(actorName(item.updatedBy, t), locale), when })}
          </span>
        )}
      </span>
    </>
  );

  const rowClass = `rounded-sm ${highlighted ? "change-highlight" : ""}`;
  if (!several) {
    return (
      <li
        data-entity-id={item.id}
        data-change={mark ?? (remote ? "remote" : undefined)}
        className={`flex min-h-tap flex-col justify-center gap-0.5 px-3 py-3 ${rowClass}`}
      >
        {content}
      </li>
    );
  }

  // Several batches: the whole row is a disclosure that lists them, view-only (K1, 0025).
  return (
    <li data-entity-id={item.id} data-change={mark ?? (remote ? "remote" : undefined)} className={rowClass}>
      <Collapsible.Root>
        <Collapsible.Trigger
          data-batches-toggle=""
          className="group flex min-h-tap w-full items-center gap-2 rounded-sm px-3 py-3 text-left"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">{content}</span>
          <CaretDownIcon
            aria-hidden="true"
            className="size-icon-sm shrink-0 text-text-muted transition-transform group-data-[panel-open]:rotate-180 motion-reduce:transition-none"
          />
        </Collapsible.Trigger>
        <Collapsible.Panel className="px-3 pb-3">
          <BatchList item={item} meId={meId} name={name} />
        </Collapsible.Panel>
      </Collapsible.Root>
    </li>
  );
}

/** One line per open batch, oldest first: added date, where, frozen or defrosted, Low, and who added it. */
function BatchList({ item, meId, name }: { item: ItemRow; meId: string; name: string }) {
  const t = useTranslations();
  const format = useFormatter();
  const locale = useLocale();
  const date = (iso: string) => format.dateTime(new Date(iso), { month: "short", day: "numeric" });
  return (
    <>
      <ul aria-label={t("kitchen.batches.listLabel", { name })} className="flex flex-col gap-1 border-l-2 border-border-default pl-3">
        {batchesOf(item).map((b) => {
          const defrosted = b.defrostedOn && !b.frozen?.value;
          const who = byOtherActor(b.createdBy, meId)
            ? t("kitchen.batches.addedBy", { name: sentenceCase(actorName(b.createdBy, t), locale) })
            : t("kitchen.batches.addedByYou");
          return (
            <li key={b.id} data-batch-id={b.id} className="flex flex-wrap gap-x-2 text-small">
              <span className="font-medium">{t("kitchen.batches.added", { date: date(b.addedAt) })}</span>
              {b.quantity && <span className="text-text-muted">{b.quantity.value.asSaid}</span>}
              {b.location && <span className="text-text-muted">{t(`kitchen.groups.${b.location.value}`)}</span>}
              {b.frozen?.value && <span className="text-text-muted">{t("kitchen.frozen")}</span>}
              {defrosted && (
                <span className="text-text-muted">{t("kitchen.batches.defrostedOn", { date: date(b.defrostedOn!.value) })}</span>
              )}
              {b.stock?.value === "low" && <span className="font-strong text-warning-text">{t("kitchen.low")}</span>}
              {b.opened?.value && <span className="text-text-muted">{t("kitchen.opened")}</span>}
              <span className="text-text-muted">{who}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-caption text-text-muted">{t("kitchen.batches.viewOnly")}</p>
    </>
  );
}
