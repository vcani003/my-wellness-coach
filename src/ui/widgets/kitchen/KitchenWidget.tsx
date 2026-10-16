"use client";
/**
 * The Kitchen place (Kitchen OS dock, 0042; ux.md §3, decisions 0011, 0017, CAT1, K1): the whole
 * kitchen, view-only except To review. At the top, the shared-kitchen lines ("Since your last
 * visit", "Levi used up the eggs", ux.md §6) and To review; then **search** ("Search your
 * kitchen", instant, accents ignored, matched words marked) and **By place | By type**
 * (remembered on this device). By place groups Fridge / Freezer / Pantry / Not sure where; By type
 * groups under the 12 categories, each row saying where it is. Rows show "added X days ago",
 * batches, Running low, "New" / "Updated" after your own message, and "Levi · just now" for the
 * other person's changes. Empty, loading, error and stale states stay inside the place (0018).
 */
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { ItemRow } from "@/contracts/kitchen-state";
import { useAnnounce } from "@/ui/a11y/Announcer";
import { LumiHalo } from "@/ui/lumi/Lumi";
import { FoodTile } from "@/ui/primitives/FoodTile";
import { actorName, byOther as byOtherActor, itemName, sentenceCase } from "@/ui/fallbacks";
import { Collapsible } from "@/ui/primitives/Collapsible";
import { CaretDownIcon, CloseIcon, FreezerIcon, FridgeIcon, PantryIcon, SearchIcon, UnknownPlaceIcon } from "@/ui/primitives/icons";
import { useKitchenData, type ChangeMark } from "@/ui/sync/KitchenDataContext";
import { useOnline } from "@/ui/sync/useOnline";
import type { PlaceProps } from "@/ui/places/types";
import { batchesOf, calendarDaysSince, groupByCategory, groupItems, highlightParts, isDefrosted, searchKitchen, type GroupKey } from "./model";
import { LiveRemovals, SinceLastVisit } from "./SharedCues";
import { ghostOf, LevelLabel, LevelMenu, LevelNoteView, StockLevelProvider, useStockLevelControl } from "./StockLevel";
import { ToReview } from "./ToReview";
import { useKitchenView, type KitchenView } from "./view-pref";

/** How long typing must pause before the result count is spoken. */
const ANNOUNCE_DELAY_MS = 700;

const PLACE_ICON = { fridge: FridgeIcon, freezer: FreezerIcon, pantry: PantryIcon, unknown: UnknownPlaceIcon } as const;

/** A place's tile (Kitchen OS): the place colour and its icon. Decorative; the words say where. */
export function PlaceTile({ place, small = false }: { place: GroupKey; small?: boolean }) {
  const Icon = PLACE_ICON[place];
  return (
    <span aria-hidden="true" data-place={place} className={`place-tile ${small ? "size-avatar" : ""}`}>
      <Icon className={small ? "size-icon-sm" : "size-icon"} />
    </span>
  );
}

export function KitchenWidget({ onRetry }: PlaceProps) {
  const t = useTranslations("kitchen");
  const format = useFormatter();
  const announce = useAnnounce();
  const { snapshot, marks, remoteIds, me, now, cues } = useKitchenData();
  const { state, status, syncedAt } = snapshot;
  const [view, setView] = useKitchenView();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  // Where focus goes when a To review sheet closes (the card it came from may be gone).
  const rootRef = useRef<HTMLDivElement>(null);
  // Item buttons need a connection until KOS7 (0044): the same test as the header's Offline pill.
  const online = useOnline();
  const [levels, noteRef] = useStockLevelControl(!online || status === "stale" || status === "error");

  // An item set to Out has left the kitchen; it stays here, faded, while its receipt shows.
  const ghost = state ? ghostOf(levels.note, state) : null;
  const items = state ? (ghost ? [...state.items, ghost] : state.items) : [];
  const searching = query.trim().length > 0;
  const results = state && searching ? searchKitchen(items, query) : [];

  // "2 matches" / "No matches for 'x'", once typing pauses (never per keystroke).
  const spoken = searching ? (results.length ? t("seeAll.matches", { count: results.length }) : t("seeAll.noMatches", { query: query.trim() })) : "";
  useEffect(() => {
    if (!spoken) return;
    const timer = setTimeout(() => announce(spoken), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [spoken, announce]);

  if (!state) {
    if (status === "error") {
      return (
        <p className="flex flex-wrap items-center gap-2 rounded-md bg-error-bg px-4 py-3 text-small text-error-text">
          {t("error")}
          <button type="button" onClick={onRetry} className="btn-quiet underline">
            {t("retry")}
          </button>
        </p>
      );
    }
    return (
      <div aria-busy="true" className="flex flex-col gap-2">
        <p className="text-small text-text-muted">{t("loading")}</p>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-tap rounded-md bg-surface-sunken" />
        ))}
      </div>
    );
  }

  const clear = () => {
    setQuery("");
    searchRef.current?.focus();
  };
  const hasItems = groupItems(items).length > 0;

  return (
    <StockLevelProvider control={levels} noteRef={noteRef}>
      <div ref={rootRef} tabIndex={-1} className="flex flex-col gap-4 outline-none">
        {status === "stale" && syncedAt !== null && (
          <p className="rounded-md bg-surface-sunken px-3 py-2 text-small text-text-muted">
            {t("stale", { time: format.dateTime(new Date(syncedAt), { hour: "numeric", minute: "2-digit" }) })}
          </p>
        )}
        {cues && <SinceLastVisit cues={cues} onDismissed={() => rootRef.current?.focus()} />}
        {cues && <LiveRemovals cues={cues} />}
        {!searching && <ToReview reviews={state.toReview} finalFocus={rootRef} />}

        {!hasItems ? (
          <EmptyKitchen />
        ) : (
          <>
            <div className="sticky top-[var(--topbar-height)] z-10 -mx-4 flex flex-col gap-3 bg-surface-default px-4 py-2 desk:static desk:mx-0 desk:px-0">
              <SearchField inputRef={searchRef} query={query} onChange={setQuery} onClear={clear} />
              {/* Stays while searching: results are one flat list either way, and the choice is kept (CAT1). */}
              <ViewToggle view={view} onChange={setView} />
            </div>
            {searching ? (
              <SearchResults items={results} query={query} meId={me.id} now={now} marks={marks} remoteIds={remoteIds} ghostId={ghost?.id} />
            ) : (
              <ItemGroups items={items} view={view} meId={me.id} now={now} marks={marks} remoteIds={remoteIds} ghostId={ghost?.id} />
            )}
          </>
        )}
      </div>
    </StockLevelProvider>
  );
}

function EmptyKitchen() {
  const t = useTranslations("kitchen");
  return (
    <div className="card flex flex-col items-center gap-3 px-5 py-6 text-center">
      <LumiHalo state="sleep" size="lumi" />
      <p className="text-body font-medium">{t("empty")}</p>
    </div>
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
        className="min-h-tap w-full rounded-button border-[1.5px] border-border-strong bg-surface-raised py-2 pr-7 pl-7 text-body placeholder:text-text-muted"
      />
      {query && (
        <button
          type="button"
          onClick={onClear}
          aria-label={t("clear")}
          className="btn-icon absolute top-1/2 right-0 -translate-y-1/2"
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
    <div role="group" aria-label={t("viewLabel")} className="seg-group self-start">
      {(["place", "type"] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => onChange(v)}
          data-kitchen-view={v}
          data-on={view === v}
          className="seg-option px-4"
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
  /** The item just set to Out, drawn faded in place while its receipt shows. */
  ghostId?: string;
}

function ItemGroups({ items, view, ...row }: RowContext & { items: readonly ItemRow[]; view: KitchenView }) {
  const t = useTranslations();
  const groups =
    view === "type"
      ? groupByCategory(items).map((g) => ({ key: g.key, place: null, title: t(`category.${g.key}`), items: g.items }))
      : groupItems(items).map((g) => ({ key: g.key, place: g.key, title: t(`kitchen.groups.${g.key}`), items: g.items }));
  return (
    <div className="flex flex-col gap-5" data-kitchen-grouping={view}>
      {view === "type" && <p className="text-caption text-text-muted">{t("kitchen.seeAll.sortedHint")}</p>}
      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`kitchen-${view}-${group.key}`} data-group={group.key}>
          <div className="mb-2 flex items-center gap-2">
            {group.place && <PlaceTile place={group.place} small />}
            <h3 id={`kitchen-${view}-${group.key}`} className="text-title font-medium">
              {group.title}
            </h3>
          </div>
          <ul className="flex flex-col gap-2">
            {group.items.map((item) => (
              <ItemRowView
                key={item.id}
                item={item}
                mark={row.marks[item.id]}
                remote={row.remoteIds.has(item.id)}
                meId={row.meId}
                now={row.now}
                showPlace={view === "type"}
                gone={item.id === row.ghostId}
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
      <h3 id={headingId} className="section-label mb-2">
        {t("matches", { count: items.length })}
      </h3>
      <ul className="flex flex-col gap-2">
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
            gone={item.id === row.ghostId}
          />
        ))}
      </ul>
    </section>
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
  gone = false,
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
  /** Just set to Out (KOS4): faded, labelled Out, no menu, until your next message. */
  gone?: boolean;
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
  const several = batches.length > 1 && !gone;
  const level = gone ? "out" : item.stock?.value;
  const name = itemName(item.name.value, t, locale);

  const content = (
    <>
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-body font-strong">
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
        {level && <LevelLabel level={level} />}
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

  const rowClass = `row-card ${highlighted && !gone ? "change-highlight" : ""}`;
  // The food's emoji tile, tinted by where it's kept (0048); the catalog emoji comes with KOS2.
  const tile = <FoodTile place={item.location?.value ?? "unknown"} />;
  // ⋯ "More for rice" with How much is left? (KOS4); KOS3's tap-to-edit will take it over.
  const menu = gone ? null : <LevelMenu item={item} name={name} />;
  const note = <LevelNoteView itemId={item.id} />;
  if (!several) {
    return (
      <li data-entity-id={item.id} data-change={gone ? "gone" : (mark ?? (remote ? "remote" : undefined))} className={rowClass}>
        <div className={`flex min-h-tap items-center gap-3 py-2 pl-3 ${menu ? "pr-1" : "pr-3"}`}>
          {tile}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">{content}</span>
          {menu}
        </div>
        {note}
      </li>
    );
  }

  // Several batches: the whole row is a disclosure that lists them, view-only (K1, 0025).
  return (
    <li data-entity-id={item.id} data-change={mark ?? (remote ? "remote" : undefined)} className={rowClass}>
      <Collapsible.Root>
        <div className="flex items-center pr-1">
          <Collapsible.Trigger
            data-batches-toggle=""
            className="group flex min-h-tap min-w-0 flex-1 items-center gap-3 rounded-md py-2 pr-2 pl-3 text-left"
          >
            {tile}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">{content}</span>
            <CaretDownIcon
              aria-hidden="true"
              className="size-icon-sm shrink-0 text-text-muted transition-transform group-data-[panel-open]:rotate-180 motion-reduce:transition-none"
            />
          </Collapsible.Trigger>
          {menu}
        </div>
        <Collapsible.Panel className="px-4 pb-3">
          <BatchList item={item} meId={meId} name={name} />
        </Collapsible.Panel>
      </Collapsible.Root>
      {note}
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
              {b.stock && <LevelLabel level={b.stock.value} />}
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
