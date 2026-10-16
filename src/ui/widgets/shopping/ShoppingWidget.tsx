"use client";
/**
 * The Shopping list widget (ux.md §10, decision 0027): shared by the kitchen, grouped by store
 * with "Anywhere" last. A row is a big "got it" checkbox (whole row is the tap target), the name
 * and quantity as said, who ticked it when it wasn't you, and ⋯ → Remove. Ticks show at once and
 * are kept on this phone when there's no signal (SL4 Rec). "Done shopping" opens "Add to your
 * kitchen?", whose Do later waits in the Kitchen's To review. Empty, loading, error and stale
 * states stay inside the widget (0018).
 */
import { usePlaceMemory } from "@/ui/places/PlaceMemory";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import type { ShoppingItemRow } from "@/contracts/kitchen-state";
import { Checkbox } from "@/ui/primitives/Checkbox";
import { useAnnounce } from "@/ui/a11y/Announcer";
import { actorName, itemName, sentenceCase } from "@/ui/fallbacks";
import { LumiHalo } from "@/ui/lumi/Lumi";
import { MoreIcon, NotSyncedIcon, UndoIcon } from "@/ui/primitives/icons";
import { Menu } from "@/ui/primitives/Menu";
import { useKitchenActions } from "@/ui/sync/KitchenActionsContext";
import { useKitchenData, type ChangeMark } from "@/ui/sync/KitchenDataContext";
import type { PlaceProps } from "@/ui/places/types";
import { DoneShoppingSheet } from "./DoneShoppingSheet";
import { RestockStaples } from "./RestockStaples";
import { ANYWHERE, groupShopping, shownTicked, withGhosts } from "./model";
import type { PendingTick } from "./tick-queue";
import { useAddFromList } from "./useAddFromList";
import { useTickQueue } from "./useTickQueue";

export const SHOPPING_WIDGET_ID = "shopping.list";

/** The List place: "6 · 2 got", Restock staples (0054), then the list. */
export function ListPlace({ onRetry }: PlaceProps) {
  const { snapshot } = useKitchenData();
  return (
    <>
      {Boolean(snapshot.state?.shoppingList.length) && (
        <p className="section-label">
          <ShoppingSummary />
        </p>
      )}
      <RestockStaples onRetry={onRetry} />
      <ShoppingWidget onRetry={onRetry} />
    </>
  );
}

export function ShoppingSummary() {
  const t = useTranslations("shopping");
  const { snapshot } = useKitchenData();
  const { pending } = useTickQueue();
  const list = snapshot.state?.shoppingList;
  if (!list) return null;
  const got = list.filter((i) => shownTicked(i, pending.get(i.id))).length;
  return <>{t("summary", { count: list.length, got })}</>;
}

interface Ghost {
  id: string;
  name: string;
  store?: string;
  index: number;
  changeSetId: string;
  turn: number;
}
interface Notice {
  text: string;
  undo?: { changeSetId: string; label: string };
  /** The notice already says "Your list is clear", so the empty state doesn't say it again. */
  listClear?: boolean;
  turn: number;
}

type Row = { kind: "item"; item: ShoppingItemRow } | { kind: "ghost"; ghost: Ghost; item: Pick<ShoppingItemRow, "id" | "store"> };

export function ShoppingWidget({ onRetry }: PlaceProps) {
  const t = useTranslations();
  const format = useFormatter();
  const locale = useLocale();
  const announce = useAnnounce();
  const actions = useKitchenActions();
  const { snapshot, marks, remoteIds, me, turn = 0 } = useKitchenData();
  const { queue, pending } = useTickQueue();
  const addFromList = useAddFromList();
  const { state, status, syncedAt } = snapshot;
  const rootRef = useRef<HTMLDivElement>(null);
  // Kept while you visit other places, so Undo stays beside the change (PlaceMemory).
  const [ghosts, setGhosts] = usePlaceMemory<Ghost[]>("shopping.ghosts", []);
  const [notice, setNotice] = usePlaceMemory<Notice | null>("shopping.notice", null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  // Rows already ticked when the app opened sit at the bottom; ticks made now never move a row.
  const [tickedAtOpen] = useState(() => new Set((state?.shoppingList ?? []).filter((i) => i.ticked).map((i) => i.id)));

  if (!state) {
    if (status === "error") {
      return (
        <p className="flex flex-wrap items-center gap-2 rounded-md bg-error-bg px-4 py-3 text-small text-error-text">
          {t("shopping.error")}
          <button type="button" onClick={onRetry} className="btn-quiet underline">
            {t("shopping.retry")}
          </button>
        </p>
      );
    }
    return (
      <div aria-busy="true" className="flex flex-col gap-2">
        <p className="text-small text-text-muted">{t("shopping.loading")}</p>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-tap rounded-md bg-surface-sunken" />
        ))}
      </div>
    );
  }

  const list = state.shoppingList;
  const name = (n: string | undefined) => itemName(n, t, locale);
  const liveGhosts = ghosts.filter((g) => g.turn === turn && !list.some((i) => i.id === g.id));
  const rows: Row[] = withGhosts<Row>(
    list.map((item) => ({ kind: "item", item })),
    liveGhosts.map((g) => ({
      index: g.index,
      row: { kind: "ghost", ghost: g, item: { id: g.id, store: g.store ? { value: g.store, basis: "said", confidence: "high" } : undefined } },
    })),
  );
  const groups = groupShopping(rows, tickedAtOpen);
  const anyTicked = list.some((i) => shownTicked(i, pending.get(i.id)));
  const queuedCount = [...pending.values()].filter((p) => p.status === "queued").length;
  const currentNotice = notice && notice.turn === turn ? notice : null;

  const toggle = (item: ShoppingItemRow) => {
    actions.touched(SHOPPING_WIDGET_ID);
    void queue.tick(item.id, !shownTicked(item, pending.get(item.id)));
  };

  const remove = async (item: ShoppingItemRow) => {
    actions.touched(SHOPPING_WIDGET_ID);
    const label = name(item.name.value);
    setBusyIds((s) => new Set([...s, item.id]));
    try {
      const res = await actions.removeShopping(item.id);
      if (res.ok && res.result.applied.length) {
        setGhosts((g) => [
          ...g.filter((x) => x.turn === turn),
          { id: item.id, name: label, store: item.store?.value, index: list.findIndex((i) => i.id === item.id), changeSetId: res.result.changeSetId, turn },
        ]);
        actions.showOwn(res.result);
        announce(t("shopping.removed", { name: label }));
      } else {
        announce(t("shopping.removeFailed", { name: label }));
        setNotice({ text: t("shopping.removeFailed", { name: label }), turn });
      }
    } catch {
      setNotice({ text: t("shopping.removeFailed", { name: label }), turn });
    } finally {
      setBusyIds((s) => new Set([...s].filter((id) => id !== item.id)));
    }
  };

  const undo = async (changeSetId: string, after?: () => void) => {
    try {
      const res = await actions.undo(changeSetId);
      if (res.ok && res.result.applied.length) {
        actions.showOwn(res.result);
        after?.();
        announce(t("shopping.undone"));
        return true;
      }
    } catch {
      // fall through
    }
    setNotice({ text: t("shopping.cantUndo"), turn });
    announce(t("shopping.cantUndo"));
    return false;
  };

  /** Add the chosen items to the kitchen. Unticked ones are ticked first (the backend needs that). */
  const finish = async (ids: string[]): Promise<boolean> => {
    actions.touched(SHOPPING_WIDGET_ID);
    const added = await addFromList(ids);
    if (!added) return false;
    setNotice({ text: added.text, undo: { changeSetId: added.changeSetId, label: added.undoLabel }, listClear: added.listClear, turn });
    announce(added.text);
    return true;
  };

  /** Do later: the chosen items wait in the Kitchen's To review; the list stays as it is. */
  const later = async (ids: string[]): Promise<boolean> => {
    actions.touched(SHOPPING_WIDGET_ID);
    try {
      const res = await actions.queueShoppingForLater(ids);
      if (!res.ok || !res.result.applied.length) return false;
      actions.showOwn(res.result);
      const text = t("shopping.savedForLater");
      setNotice({ text, turn });
      announce(text);
      return true;
    } catch {
      return false;
    }
  };

  return (
    <div ref={rootRef} tabIndex={-1} className="flex flex-col gap-4 outline-none">
      {status === "stale" && syncedAt !== null && (
        <p className="rounded-md bg-surface-sunken px-3 py-2 text-small text-text-muted">
          {t("shopping.stale", { time: format.dateTime(new Date(syncedAt), { hour: "numeric", minute: "2-digit" }) })}
        </p>
      )}
      {queuedCount > 0 && status !== "stale" && (
        <p className="flex items-center gap-2 text-small text-text-muted">
          <NotSyncedIcon aria-hidden="true" className="size-icon-sm" />
          {t("shopping.queuedCount", { count: queuedCount })}
        </p>
      )}
      {currentNotice && (
        <p className="flex flex-wrap items-center gap-2 rounded-md bg-success-bg px-4 py-2 text-small text-success-text">
          <span>{currentNotice.text}</span>
          {currentNotice.undo && (
            <button
              type="button"
              aria-label={currentNotice.undo.label}
              onClick={() => {
                const u = currentNotice.undo!;
                void undo(u.changeSetId, () => setNotice({ text: t("shopping.undone"), turn }));
              }}
              className="btn-quiet"
            >
              <UndoIcon aria-hidden="true" className="size-icon-sm" />
              {t("shopping.undo")}
            </button>
          )}
        </p>
      )}

      {list.length === 0 && liveGhosts.length === 0 ? (
        !currentNotice?.listClear && <EmptyList />
      ) : (
        groups.map((group, gi) => {
          const store = group.key === ANYWHERE ? t("shopping.anywhere") : group.key;
          const count = group.rows.filter((r) => r.kind === "item").length;
          const headingId = `shopping-group-${gi}`;
          return (
            <section key={group.key} aria-labelledby={headingId} data-group={store}>
              <h3 id={headingId} className="section-label mb-2 px-1">
                <span aria-hidden="true">
                  {store} · {count}
                </span>
                <span className="sr-only">{store}</span>
              </h3>
              <ul className="flex flex-col gap-2">
                {group.rows.map((row) =>
                  row.kind === "ghost" ? (
                    <li key={`ghost-${row.ghost.id}`} className="flex min-h-tap items-center gap-2 rounded-md border-2 border-dashed border-border-default px-4 text-small text-text-muted">
                      <span>{t("shopping.removed", { name: row.ghost.name })}</span>
                      <button
                        type="button"
                        aria-label={t("shopping.undoRemoveLabel", { name: row.ghost.name.toLocaleLowerCase(locale) })}
                        onClick={() => void undo(row.ghost.changeSetId, () => setGhosts((g) => g.filter((x) => x.id !== row.ghost.id)))}
                        className="btn-quiet"
                      >
                        <UndoIcon aria-hidden="true" className="size-icon-sm" />
                        {t("shopping.undo")}
                      </button>
                    </li>
                  ) : (
                    <ShoppingRowView
                      key={row.item.id}
                      item={row.item}
                      pending={pending.get(row.item.id)}
                      mark={marks[row.item.id]}
                      remote={remoteIds.has(row.item.id)}
                      meId={me.id}
                      busy={busyIds.has(row.item.id)}
                      onToggle={() => toggle(row.item)}
                      onRetry={() => void queue.retry(row.item.id)}
                      onRemove={() => void remove(row.item)}
                    />
                  ),
                )}
              </ul>
            </section>
          );
        })
      )}

      {anyTicked && (
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="btn btn-primary self-start"
        >
          {t("shopping.doneShopping")}
        </button>
      )}
      <DoneShoppingSheet
        open={sheetOpen}
        items={list.map((item) => ({ id: item.id, name: name(item.name.value), ticked: shownTicked(item, pending.get(item.id)) }))}
        onClose={() => setSheetOpen(false)}
        onAdd={finish}
        onLater={later}
        finalFocus={rootRef}
      />
    </div>
  );
}

function ShoppingRowView({
  item,
  pending,
  mark,
  remote,
  meId,
  busy,
  onToggle,
  onRetry,
  onRemove,
}: {
  item: ShoppingItemRow;
  pending?: PendingTick;
  mark?: ChangeMark;
  remote: boolean;
  meId: string;
  busy: boolean;
  onToggle: () => void;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const label = itemName(item.name.value, t, locale);
  const ticked = shownTicked(item, pending);
  // Show who ticked it only when it wasn't you, and only for the kitchen's tick (not a pending one of yours).
  const tickedBy = ticked && !pending && item.ticked && ("missing" in item.ticked.by || item.ticked.by.id !== meId) ? actorName(item.ticked.by, t) : null;
  const highlighted = Boolean(mark) || remote;
  return (
    <li
      data-entity-id={item.id}
      data-change={mark ?? (remote ? "remote" : undefined)}
      className={`row-card flex flex-col ${highlighted ? "change-highlight" : ""}`}
    >
      <div className="flex min-h-tap items-center">
        <label className="flex min-h-tap flex-1 cursor-pointer items-center gap-3 py-2 pl-4">
          <Checkbox
            checked={ticked}
            onChange={onToggle}
            aria-label={tickedBy ? t("shopping.tickLabelBy", { name: label, person: tickedBy }) : t("shopping.tickLabel", { name: label })}
          />
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className={`text-body font-medium ${ticked ? "text-text-muted line-through" : ""}`}>{label}</span>
            {item.quantity && <span className="text-small text-text-muted">{item.quantity.value.asSaid}</span>}
            {mark && (
              <span className="rounded-button bg-highlight-bg px-2 text-caption font-strong text-highlight-text">
                {t(mark === "new" ? "kitchen.new" : "kitchen.updated")}
              </span>
            )}
            {tickedBy && (
              <span aria-hidden="true" className="rounded-button bg-accent-soft px-2 text-caption font-strong text-accent-text">
                {sentenceCase(tickedBy, locale)}
              </span>
            )}
          </span>
        </label>
        <Menu.Root>
          <Menu.Trigger
            aria-label={t("shopping.more", { name: label.toLocaleLowerCase(locale) })}
            disabled={busy}
            className="btn-icon mr-1 disabled:opacity-60"
          >
            <MoreIcon aria-hidden="true" className="size-icon" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-40">
              <Menu.Popup className="min-w-40 rounded-md bg-surface-raised p-1 shadow-pop">
                <Menu.Item
                  onClick={onRemove}
                  className="flex min-h-tap cursor-pointer items-center rounded-md px-3 text-body data-highlighted:bg-surface-sunken"
                >
                  {t("shopping.remove")}
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
      {pending?.status === "queued" && (
        <p className="flex items-center gap-1 pb-2 pl-12 text-caption text-text-muted">
          <NotSyncedIcon aria-hidden="true" className="size-icon-sm" />
          {t("shopping.notSynced")}
        </p>
      )}
      {pending?.status === "failed" && (
        <p className="flex flex-wrap items-center gap-2 pb-2 pl-12 text-caption text-error-text">
          {t("shopping.tickFailed")}
          <button type="button" onClick={onRetry} className="btn-quiet underline">
            {t("shopping.retry")}
          </button>
        </p>
      )}
    </li>
  );
}


function EmptyList() {
  const t = useTranslations("shopping");
  return (
    <div className="card flex flex-col items-center gap-3 px-5 py-6 text-center">
      <LumiHalo state="happy" size="lumi" />
      <p className="text-body font-medium">{t("empty")}</p>
    </div>
  );
}
