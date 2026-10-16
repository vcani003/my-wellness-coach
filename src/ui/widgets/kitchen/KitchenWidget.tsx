"use client";
/**
 * The Kitchen place (Kitchen OS dock, 0042; ux.md §3, decisions 0011, 0017, CAT1, K1): the whole
 * kitchen. Tap an item to edit it (0045 KOS3, `ItemEditSheet`). At the top, the shared-kitchen lines ("Since your last
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
import { actorName, itemName, sentenceCase } from "@/ui/fallbacks";
import { CaretRightIcon, CloseIcon, CounterIcon, FreezerIcon, FridgeIcon, PantryIcon, SearchIcon, UnknownPlaceIcon } from "@/ui/primitives/icons";
import { useKitchenData, type ChangeMark } from "@/ui/sync/KitchenDataContext";
import { useOnline } from "@/ui/sync/useOnline";
import type { PlaceProps } from "@/ui/places/types";
import { batchesOf, calendarDaysSince, groupByCategory, groupItems, highlightParts, isDefrosted, searchKitchen, type GroupKey } from "./model";
import { LiveRemovals, SinceLastVisit } from "./SharedCues";
import { ItemEditProvider, ItemNoteView, useItemEdit, useItemEditControl } from "./ItemEdit";
import { ItemEditSheet } from "./ItemEditSheet";
import { ghostOf, type GhostKind } from "./item-edit-model";
import { LevelLabel } from "./StockLevel";
import { ToReview } from "./ToReview";
import { useKitchenView, type KitchenView } from "./view-pref";

/** How long typing must pause before the result count is spoken. */
const ANNOUNCE_DELAY_MS = 700;

const PLACE_ICON = { fridge: FridgeIcon, freezer: FreezerIcon, pantry: PantryIcon, counter: CounterIcon, unknown: UnknownPlaceIcon } as const;

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
  const [edit, noteRefs] = useItemEditControl(!online || status === "stale" || status === "error");

  // An item set to Out or removed has left the kitchen; it stays here, faded, while its note shows.
  const ghost = state ? ghostOf(edit.note, state) : null;
  const items = state ? (ghost ? [...state.items, ghost.row] : state.items) : [];
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
    <ItemEditProvider control={edit} refs={noteRefs}>
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
              <SearchResults items={results} query={query} meId={me.id} now={now} marks={marks} remoteIds={remoteIds} ghost={ghost} />
            ) : (
              <ItemGroups items={items} view={view} meId={me.id} now={now} marks={marks} remoteIds={remoteIds} ghost={ghost} />
            )}
          </>
        )}
      </div>
      <ItemEditSheet />
    </ItemEditProvider>
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
  /** The item just set to Out or removed, drawn faded in place while its note shows. */
  ghost: { row: ItemRow; kind: GhostKind } | null;
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
                ghost={item.id === row.ghost?.row.id ? row.ghost.kind : undefined}
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
            ghost={item.id === row.ghost?.row.id ? row.ghost.kind : undefined}
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
  ghost,
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
  /** It left the kitchen just now (Out, Removed, or gone): faded, no edit button, until your next message. */
  ghost?: GhostKind;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const locale = useLocale();
  const control = useItemEdit();
  const detailsId = useId();
  const amountId = useId();
  const days = calendarDaysSince(item.addedAt, now);
  const byOther = "missing" in item.updatedBy || item.updatedBy.id !== meId;
  const updatedMs = now.getTime() - new Date(item.updatedAt).getTime();
  const when = updatedMs < 60_000 ? t("kitchen.justNow") : format.relativeTime(new Date(item.updatedAt), now);
  const highlighted = Boolean(mark) || remote;
  const batches = batchesOf(item);
  const several = batches.length > 1 && !ghost;
  const level = ghost === "out" ? "out" : ghost ? undefined : item.stock?.value;
  const name = itemName(item.name.value, t, locale);
  const saving = control?.busyId === item.id;
  // One way in (KOS3): the name is the edit button, stretched over the whole row for a tap.
  const editable = Boolean(control) && !ghost;

  const nameText = (
    <>
      <HighlightedName text={name} query={query} />
      {showPlace && (
        <span className="text-small font-regular text-text-muted">
          {" · "}
          {t(`kitchen.groups.${item.location?.value ?? "unknown"}`)}
        </span>
      )}
    </>
  );

  return (
    <li
      data-entity-id={item.id}
      data-change={ghost ? "gone" : (mark ?? (remote ? "remote" : undefined))}
      className={`row-card ${highlighted && !ghost ? "change-highlight" : ""}`}
    >
      <div className="relative flex min-h-tap items-center gap-3 py-2 pr-3 pl-3">
        {/* The food's emoji tile, tinted by where it's kept (0048); the catalog emoji comes with KOS2. */}
        {/* Gone (Out / Removed): only the decorative tile fades, so the words keep AA contrast. */}
        <span className={ghost ? "opacity-50 grayscale" : "contents"}>
          <FoodTile place={item.location?.value ?? "unknown"} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-baseline gap-x-2">
            {editable ? (
              <button
                type="button"
                onClick={(e) => control?.open(item, e.currentTarget)}
                aria-label={t("kitchen.edit.open", { name: item.name.value })}
                aria-describedby={item.quantity ? `${amountId} ${detailsId}` : detailsId}
                aria-haspopup="dialog"
                data-item-edit={item.id}
                className="text-left text-body font-strong outline-none after:absolute after:inset-0 after:rounded-md after:content-[''] focus-visible:after:outline-3 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus-ring"
              >
                {nameText}
              </button>
            ) : (
              <span className="text-body font-strong">{nameText}</span>
            )}
            {item.quantity && (
              <span id={amountId} className="text-small text-text-muted">
                {item.quantity.value.asSaid}
              </span>
            )}
            {mark && !ghost && (
              <span className="rounded-button bg-highlight-bg px-2 text-caption font-strong text-highlight-text">
                {t(mark === "new" ? "kitchen.new" : "kitchen.updated")}
              </span>
            )}
          </span>
          <span id={detailsId} className="flex flex-wrap gap-x-2 text-caption text-text-muted">
            {saving ? (
              <span data-row-saving="" className="font-strong">
                {t("kitchen.edit.saving")}
              </span>
            ) : (
              <>
                {/* "2 batches · oldest 12 days" (0025): the row's addedAt is the oldest open batch's. */}
                <span>{several ? t("kitchen.batches.summary", { count: batches.length, days }) : t("kitchen.addedDaysAgo", { days })}</span>
                {level && <LevelLabel level={level} />}
                {ghost === "removed" && <span className="font-strong">{t("kitchen.edit.removed")}</span>}
                {!ghost && item.opened?.value && <span>{t("kitchen.opened")}</span>}
                {!ghost && item.frozen?.value && item.location?.value !== "freezer" && <span>{t("kitchen.frozen")}</span>}
                {!ghost && isDefrosted(item) && <span>{t("kitchen.defrosted")}</span>}
                {byOther && !ghost && (
                  <span className={remote ? "font-strong text-highlight-text" : ""}>
                    {t("kitchen.byPerson", { name: sentenceCase(actorName(item.updatedBy, t), locale), when })}
                  </span>
                )}
              </>
            )}
          </span>
        </span>
        {editable && <CaretRightIcon aria-hidden="true" className="size-icon-sm shrink-0 text-text-muted" />}
      </div>
      <ItemNoteView itemId={item.id} />
    </li>
  );
}
