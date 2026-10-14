"use client";
/**
 * Kitchen "See all" (ux.md §3, K1, 0017; CAT1 Rec): the whole kitchen, view-only except To review.
 * A full page on a phone, the whole workspace on desktop, with the chat dock still there.
 * - **Search** at the top ("Search your kitchen"): instant, by the name as said or the English /
 *   standard name, accents ignored (`matchesItemSearch`). While searching, one flat list of
 *   results, each with where it is and the matched words marked. The result count is spoken
 *   once typing pauses, through the app's one polite live region.
 * - **By place | By type**: remembered on this device. By place is the Kitchen widget's grouping;
 *   By type groups under the 12 categories in a fixed order, each row saying where it is.
 */
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { ItemRow } from "@/contracts/kitchen-state";
import { useAnnounce } from "@/ui/a11y/Announcer";
import { BackIcon, CloseIcon, SearchIcon } from "@/ui/primitives/icons";
import { useKitchenData } from "@/ui/sync/KitchenDataContext";
import { ItemRowView } from "./KitchenWidget";
import { groupByCategory, groupItems, searchKitchen } from "./model";
import { seeAllFocusTarget } from "./see-all-focus";
import { ToReview } from "./ToReview";
import { useKitchenView, type KitchenView } from "./view-pref";

export const SEE_ALL_HEADING_ID = "kitchen-see-all-heading";
/** How long typing must pause before the result count is spoken. */
const ANNOUNCE_DELAY_MS = 700;

export function KitchenSeeAll() {
  const t = useTranslations("kitchen");
  const format = useFormatter();
  const router = useRouter();
  const announce = useAnnounce();
  const { snapshot, marks, remoteIds, me, now } = useKitchenData();
  const { state, status, syncedAt } = snapshot;
  const [view, setView] = useKitchenView();
  const [query, setQuery] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const opener = useRef<"search" | "all">("all");

  // Arriving: the search field after the widget's search icon, else the heading.
  useEffect(() => {
    const target = seeAllFocusTarget();
    opener.current = target === "search" ? "search" : "all";
    if (target === "search") searchRef.current?.focus();
    else headingRef.current?.focus({ preventScroll: true });
  }, []);

  const searching = query.trim().length > 0;
  const results = state && searching ? searchKitchen(state.items, query) : [];

  // "2 matches" / "No matches for 'x'", once typing pauses (never per keystroke).
  const spoken = searching ? (results.length ? t("seeAll.matches", { count: results.length }) : t("seeAll.noMatches", { query: query.trim() })) : "";
  useEffect(() => {
    if (!spoken) return;
    const timer = setTimeout(() => announce(spoken), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [spoken, announce]);

  const back = () => {
    router.push("/");
    // Back goes with this page: return focus to the link that opened it, once home.
    const start = performance.now();
    const tick = () => {
      if (window.location.pathname === "/") {
        const el =
          document.querySelector<HTMLElement>(`[data-kitchen-opener="${opener.current}"]`) ??
          document.querySelector<HTMLElement>("#workspace");
        return el?.focus();
      }
      if (performance.now() - start < 5000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const clear = () => {
    setQuery("");
    searchRef.current?.focus();
  };

  return (
    <article ref={rootRef} tabIndex={-1} aria-labelledby={SEE_ALL_HEADING_ID} className="mx-auto flex w-full max-w-prose flex-col gap-4 pb-6 outline-none">
      <div className="flex flex-col gap-2">
        <button type="button" onClick={back} className="flex min-h-tap items-center gap-2 self-start rounded-button pr-3 text-body font-medium text-accent-text">
          <BackIcon aria-hidden="true" className="size-icon" />
          {t("seeAll.back")}
        </button>
        <h2 id={SEE_ALL_HEADING_ID} ref={headingRef} tabIndex={-1} className="text-heading font-strong outline-none">
          {t("seeAll.heading")}
        </h2>
      </div>

      {!state ? (
        status === "error" ? (
          <p className="rounded-md bg-error-bg px-4 py-3 text-small text-error-text">{t("error")}</p>
        ) : (
          <p aria-busy="true" className="text-small text-text-muted">
            {t("loading")}
          </p>
        )
      ) : (
        <>
          {status === "stale" && syncedAt !== null && (
            <p className="rounded-sm bg-surface-sunken px-3 py-2 text-small text-text-muted">
              {t("stale", { time: format.dateTime(new Date(syncedAt), { hour: "numeric", minute: "2-digit" }) })}
            </p>
          )}

          <div className="sticky top-[var(--topbar-height)] z-10 -mx-4 flex flex-col gap-3 bg-surface-default px-4 py-2 desk:static desk:mx-0 desk:px-0">
            <SearchField inputRef={searchRef} query={query} onChange={setQuery} onClear={clear} />
            <ViewToggle view={view} onChange={setView} />
          </div>

          {searching ? (
            <SearchResults items={results} query={query} meId={me.id} now={now} marks={marks} remoteIds={remoteIds} />
          ) : (
            <>
              <ToReview reviews={state.toReview} finalFocus={rootRef} />
              <ItemGroups items={state.items} view={view} meId={me.id} now={now} marks={marks} remoteIds={remoteIds} />
            </>
          )}
        </>
      )}
    </article>
  );
}

function SearchField({
  inputRef,
  query,
  onChange,
  onClear,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onChange: (query: string) => void;
  onClear: () => void;
}) {
  const t = useTranslations("kitchen.seeAll");
  return (
    <div role="search" className="relative">
      <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 size-icon -translate-y-1/2 text-text-muted" />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && query) {
            e.preventDefault();
            e.stopPropagation();
            onClear();
          }
        }}
        aria-label={t("searchLabel")}
        placeholder={t("searchPlaceholder")}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        data-kitchen-search=""
        className="min-h-tap w-full rounded-button border border-border-strong bg-surface-raised py-2 pr-7 pl-7 text-body placeholder:text-text-muted"
      />
      {query && (
        <button
          type="button"
          onClick={onClear}
          aria-label={t("clear")}
          className="absolute top-1/2 right-0 flex size-tap -translate-y-1/2 items-center justify-center rounded-full text-text-muted"
        >
          <CloseIcon aria-hidden="true" className="size-icon" />
        </button>
      )}
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: KitchenView; onChange: (view: KitchenView) => void }) {
  const t = useTranslations("kitchen.seeAll");
  return (
    <div role="group" aria-label={t("viewLabel")} className="flex self-start rounded-button bg-surface-sunken p-1">
      {(["place", "type"] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => onChange(v)}
          data-kitchen-view={v}
          className={`min-h-tap rounded-button px-4 text-small font-medium ${
            view === v ? "border border-selected-border bg-surface-raised text-text-default shadow-card" : "border border-transparent text-text-muted"
          }`}
        >
          {t(v === "place" ? "byPlace" : "byType")}
        </button>
      ))}
    </div>
  );
}

interface RowContext {
  meId: string;
  now: Date;
  marks: ReturnType<typeof useKitchenData>["marks"];
  remoteIds: ReadonlySet<string>;
}

function ItemGroups({ items, view, ...row }: RowContext & { items: readonly ItemRow[]; view: KitchenView }) {
  const t = useTranslations();
  const groups =
    view === "type"
      ? groupByCategory(items).map((g) => ({ key: g.key, title: t(`category.${g.key}`), items: g.items }))
      : groupItems(items).map((g) => ({ key: g.key, title: t(`kitchen.groups.${g.key}`), items: g.items }));
  if (groups.length === 0) return <p className="text-body text-text-muted">{t("kitchen.empty")}</p>;
  return (
    <div className="flex flex-col gap-4" data-kitchen-grouping={view}>
      {view === "type" && <p className="text-caption text-text-muted">{t("kitchen.seeAll.sortedHint")}</p>}
      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`see-all-${view}-${group.key}`} data-group={group.key}>
          <h3 id={`see-all-${view}-${group.key}`} className="mb-1 text-caption font-strong tracking-wide text-text-muted">
            {group.title}
          </h3>
          <ul className="flex flex-col">
            {group.items.map((item) => (
              <ItemRowView
                key={item.id}
                item={item}
                mark={row.marks[item.id]}
                remote={row.remoteIds.has(item.id)}
                meId={row.meId}
                now={row.now}
                showPlace={view === "type"}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function SearchResults({ items, query, ...row }: RowContext & { items: ItemRow[]; query: string }) {
  const t = useTranslations("kitchen.seeAll");
  const headingId = useId();
  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-1" data-kitchen-results="none">
        <p className="text-body font-medium">{t("noMatches", { query: query.trim() })}</p>
        <p className="text-small text-text-muted">{t("noMatchesHint")}</p>
      </div>
    );
  }
  return (
    <section aria-labelledby={headingId} data-kitchen-results="">
      <h3 id={headingId} className="mb-1 text-caption font-strong tracking-wide text-text-muted">
        {t("matches", { count: items.length })}
      </h3>
      <ul className="flex flex-col">
        {items.map((item) => (
          <ItemRowView
            key={item.id}
            item={item}
            mark={row.marks[item.id]}
            remote={row.remoteIds.has(item.id)}
            meId={row.meId}
            now={row.now}
            showPlace
            query={query}
          />
        ))}
      </ul>
    </section>
  );
}
