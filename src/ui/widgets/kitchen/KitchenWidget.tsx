"use client";
/**
 * The Kitchen widget (ux.md §3, decisions 0011 and 0017): To review at the top, then items grouped Fridge / Freezer /
 * Pantry / Not sure where, "added X days ago", Running low, "New" / "Updated" after your own
 * message, and "Levi · just now" for the other person's changes. Empty, loading, error and
 * stale states stay inside the widget (0018).
 */
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useRef } from "react";
import type { ItemRow } from "@/contracts/kitchen-state";
import { actorName, itemName } from "@/ui/fallbacks";
import { useKitchenData, type ChangeMark } from "@/ui/sync/KitchenDataContext";
import type { WidgetProps } from "@/ui/workspace/types";
import { calendarDaysSince, groupItems } from "./model";
import { ToReview } from "./ToReview";

export function KitchenSummary() {
  const t = useTranslations("kitchen");
  const { snapshot } = useKitchenData();
  if (!snapshot.state) return null;
  return <>{t("count", { count: snapshot.state.items.length })}</>;
}

export function KitchenWidget({ onRetry }: WidgetProps) {
  const t = useTranslations("kitchen");
  const format = useFormatter();
  const { snapshot, marks, remoteIds, me, now } = useKitchenData();
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
      <ToReview reviews={state.toReview} finalFocus={rootRef} />
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

function ItemRowView({
  item,
  mark,
  remote,
  meId,
  now,
}: {
  item: ItemRow;
  mark?: ChangeMark;
  remote: boolean;
  meId: string;
  now: Date;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const locale = useLocale();
  const days = calendarDaysSince(item.addedAt, now);
  const byOther = "missing" in item.updatedBy || item.updatedBy.id !== meId;
  const updatedMs = now.getTime() - new Date(item.updatedAt).getTime();
  const when = updatedMs < 60_000 ? t("kitchen.justNow") : format.relativeTime(new Date(item.updatedAt), now);
  const highlighted = Boolean(mark) || remote;

  return (
    <li
      data-entity-id={item.id}
      data-change={mark ?? (remote ? "remote" : undefined)}
      className={`flex min-h-tap flex-col justify-center gap-0.5 rounded-sm px-3 py-3 ${highlighted ? "change-highlight" : ""}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-body font-medium">{itemName(item.name.value, t, locale)}</span>
        {item.quantity && <span className="text-small text-text-muted">{item.quantity.value.asSaid}</span>}
        {mark && (
          <span className="rounded-button bg-highlight-bg px-2 text-caption font-strong text-highlight-text">
            {t(mark === "new" ? "kitchen.new" : "kitchen.updated")}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-x-2 text-caption text-text-muted">
        <span>{t("kitchen.addedDaysAgo", { days })}</span>
        {item.stock?.value === "low" && <span className="font-strong text-warning-text">{t("kitchen.low")}</span>}
        {item.opened?.value && <span>{t("kitchen.opened")}</span>}
        {item.frozen?.value && item.location?.value !== "freezer" && <span>{t("kitchen.frozen")}</span>}
        {byOther && (
          <span className={remote ? "font-strong text-highlight-text" : ""}>
            {t("kitchen.byPerson", { name: actorName(item.updatedBy, t), when })}
          </span>
        )}
      </div>
    </li>
  );
}
