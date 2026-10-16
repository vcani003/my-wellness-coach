"use client";
/**
 * The main screen: the Kitchen OS shell (0042) on this app's own core.
 * - **Header:** the place's title, the household's avatars (→ Settings) and the sync status.
 * - **Stage:** the route's place (Today `/`, Kitchen, Plan, Meals + the Recipe, List, Settings).
 * - **Chat:** Lumi's latest reply with its "What changed" receipt (Undo, refusals, batch offers)
 *   and the message box. Phone: Peek (latest exchange), Full (whole conversation) or Minimized (a
 *   round chat button with a new-reply dot, UX4). Desktop: the right-hand column (0034), which
 *   you can minimize too.
 * - **Dock:** the five places (phone: at the bottom; desktop: the slim left nav).
 * It's a layout, so the chat stays mounted while you move between places. Your own change shows
 * at once from the ApplyResult; if it concerns a place you aren't looking at, the page stays put
 * and a cue says "Kitchen updated · Show" (0035 f). The other person's changes arrive through
 * `useKitchenSync`, with a soft highlight and one announcement, never moving focus or the page.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useNow, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  addToShoppingList,
  finishShopping,
  makeAgain,
  queueShoppingForLater,
  removeShoppingListItem,
  resolveToReview,
  setItemStockLevel,
  tickShoppingListItem,
  undoChange,
  untickShoppingListItem,
} from "@/app/actions";
import { closeBatch, keepOlderBatch } from "@/app/batches/actions";
import type { ChangeRef } from "@/contracts/apply-result";
import type { ChatHistoryPage } from "@/contracts/chat-history";
import type { KitchenState } from "@/contracts/kitchen-state";
import { AnnouncerProvider, useAnnounce } from "@/ui/a11y/Announcer";
import { marksFrom } from "@/ui/app/marks";
import { AskLumiProvider } from "@/ui/chat/AskLumi";
import { Composer, type ComposerHandle } from "@/ui/chat/Composer";
import { offersOf, openOlder, useBatchOfferWords } from "@/ui/chat/BatchOffers";
import { useFormatMsg } from "@/ui/chat/format-msg";
import { LumiFace, MessageList } from "@/ui/chat/MessageList";
import { useChat } from "@/ui/chat/useChat";
import { cueTarget, parseLastPlace, placeForHost, placeForPath, resumePlace } from "@/ui/places/model";
import { PlaceRetryProvider } from "@/ui/places/Place";
import { PlaceMemoryProvider } from "@/ui/places/PlaceMemory";
import { places, TODAY_PLACE_ID } from "@/ui/places/registry";
import { CaretDownIcon, CaretUpIcon, ChatIcon, GoIcon, MinusIcon } from "@/ui/primitives/icons";
import { ConfirmPromptProvider } from "@/ui/settings/ConfirmPrompt";
import type { PendingConfirm } from "@/ui/settings/model";
import { Dock } from "@/ui/shell/Dock";
import { Header, PLACE_TITLE_ID } from "@/ui/shell/Header";
import { DESKTOP_QUERY, useMediaQuery } from "@/ui/shell/useMediaQuery";
import { useKeyboardInset } from "@/ui/shell/viewport";
import { KitchenActionsProvider, type KitchenActions } from "@/ui/sync/KitchenActionsContext";
import { KitchenDataProvider, type ChangeMark } from "@/ui/sync/KitchenDataContext";
import { useKitchenSync } from "@/ui/sync/useKitchenSync";
import { useOnline } from "@/ui/sync/useOnline";
import { useSharedCues } from "@/ui/sync/useSharedCues";
import { useCueWords } from "@/ui/widgets/kitchen/cue-words";
import { MEAL_IDEAS_WIDGET_ID } from "@/ui/widgets/meals";
import { MealsProvider } from "@/ui/widgets/meals/MealsContext";
import { fetchPastMeals, RecipeBoxProvider, type RecipeBoxActions } from "@/ui/widgets/meals/RecipeBoxContext";
import { UpdateKitchenSheet } from "@/ui/widgets/meals/UpdateKitchenSheet";
import { useMealsController } from "@/ui/widgets/meals/useMealsController";
import { useTickQueue } from "@/ui/widgets/shopping/useTickQueue";

export interface KitchenAppProps {
  kitchenId: string;
  me: { id: string; name: string };
  members: { userId: string; displayName: string }[];
  devActingAs: boolean;
  initialState: KitchenState | null;
  /** Your latest saved chat (P2 a), read on the server; null if that failed (the chat retries). */
  initialHistory?: ChatHistoryPage | null;
  /** Your allergies or diets someone else added that you haven't confirmed (AI7): the Today banner. */
  initialPendingConfirm?: PendingConfirm[];
  /** The route's page: a place, the Recipe or Settings. */
  children?: ReactNode;
}

export type DockState = "peek" | "full" | "minimized";

/**
 * "Reopen where you left off" (ux.md §10: the list is waiting at the store). This phone keeps the
 * last place you used; a fresh open of `/` within a few hours goes back there. Best effort.
 */
const LAST_PLACE_KEY = "places.last";
const STARTED_KEY = "places.started";
function rememberPlace(id: string) {
  try {
    window.localStorage.setItem(LAST_PLACE_KEY, JSON.stringify({ id, at: Date.now() }));
  } catch {
    // Private mode or blocked storage: the app just opens on Today.
  }
}
/** Once per browser session (a cold start), the place to reopen instead of Today. */
function placeToResume(): string | null {
  try {
    if (window.sessionStorage.getItem(STARTED_KEY)) return null;
    window.sessionStorage.setItem(STARTED_KEY, "1");
    return resumePlace(parseLastPlace(window.localStorage.getItem(LAST_PLACE_KEY)), Date.now(), places.map((p) => p.id), TODAY_PLACE_ID);
  } catch {
    return null;
  }
}

/** Unsent shopping ticks are sent on app open and when you're back online, wherever you are (SL4). */
function TickQueueFlusher() {
  useTickQueue();
  return null;
}

export function KitchenApp(props: KitchenAppProps) {
  return (
    <AnnouncerProvider>
      <KitchenScreen {...props} />
    </AnnouncerProvider>
  );
}

const NO_PENDING: PendingConfirm[] = [];

interface Cue {
  placeId: string;
  kind: "updated" | "ideas";
}

function KitchenScreen({
  kitchenId,
  me,
  members,
  devActingAs,
  initialState,
  initialHistory = null,
  initialPendingConfirm = NO_PENDING,
  children,
}: KitchenAppProps) {
  const t = useTranslations();
  const locale = useLocale();
  const announce = useAnnounce();
  const formatMsg = useFormatMsg();
  const batchWords = useBatchOfferWords();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const online = useOnline();
  const now = useNow({ updateInterval: 60_000 });
  const router = useRouter();
  const pathname = usePathname();
  useKeyboardInset();

  const { sync, snapshot } = useKitchenSync({ kitchenId, meId: me.id, initial: initialState });
  const { cues, liveRemovals, clearLive } = useSharedCues({
    kitchenId,
    meId: me.id,
    sync,
    version: snapshot.state?.version ?? null,
  });
  const cueWords = useCueWords();
  const [marks, setMarks] = useState<Record<string, ChangeMark>>({});
  const [remoteIds, setRemoteIds] = useState<ReadonlySet<string>>(() => new Set());
  const [dock, setDock] = useState<DockState>("peek");
  const [newReply, setNewReply] = useState(false);
  const [turn, setTurn] = useState(0);
  const [cue, setCue] = useState<Cue | null>(null);

  const current = placeForPath(places, pathname);
  const settingsOpen = pathname === "/settings" || Boolean(pathname?.startsWith("/settings/"));
  const title = current ? t(current.titleKey) : settingsOpen ? t("settings.heading") : t("app.name");

  const headerRef = useRef<HTMLElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const focusAfterDock = useRef<"fab" | "composer" | null>(null);
  const focusTitleOnArrival = useRef(false);
  const dockNow = useRef(dock);
  const currentNow = useRef(current?.id ?? null);
  useEffect(() => {
    dockNow.current = dock;
  }, [dock]);
  useEffect(() => {
    currentNow.current = current?.id ?? null;
  }, [current?.id]);

  /**
   * Point at a place your change (or the ideas you asked for) concerns. The page never moves
   * (0035 f): if you're looking at it already, there's nothing to say, unless Full chat covers it.
   */
  const pointAt = useCallback((placeId: string, kind: Cue["kind"]) => {
    if (placeId === currentNow.current && dockNow.current !== "full") return;
    setCue({ placeId, kind });
  }, []);
  const pointAtRefs = useCallback(
    (refs: readonly ChangeRef[]) => {
      const target = cueTarget(places, refs, dockNow.current === "full" ? null : currentNow.current);
      if (target) setCue({ placeId: target.id, kind: "updated" });
    },
    [],
  );

  const focusWidget = useCallback(
    (id: string) => {
      const place = placeForHost(places, id);
      if (place) pointAt(place.id, id === MEAL_IDEAS_WIDGET_ID ? "ideas" : "updated");
    },
    [pointAt],
  );

  const meals = useMealsController({
    kitchenId,
    sync,
    members,
    showSaved(result, opts) {
      sync.applyOwn(result.state);
      if (opts?.focus) {
        setMarks(marksFrom(result));
        if (typeof opts.focus === "string") focusWidget(opts.focus);
        else pointAtRefs(result.applied.flatMap((a) => a.refs));
      }
    },
    focusWidget,
    fillComposer: (text) => fillComposer(text),
    ownRecipeText: (title) => t("meals.recipe.ownRecipePrefix", { title }),
    // The Recipe belongs to the place that hosts meal ideas (Meals), so a fresh-loaded Recipe's
    // Back goes there, not to Today.
    recipeHome: placeForHost(places, MEAL_IDEAS_WIDGET_ID)?.href,
  });

  const chat = useChat({
    kitchenId,
    initialHistory,
    getVersion: () => sync.getSnapshot().state?.version ?? 0,
    callbacks: {
      onApplied(result) {
        sync.applyOwn(result.state);
        setMarks(marksFrom(result));
        pointAtRefs(result.applied.flatMap((a) => a.refs));
      },
      onEvent(event, id) {
        meals.onEvent(event, id, "chat");
      },
      onTurnEnd({ id, reply, result, error }) {
        const recipeEdited = id ? meals.onStreamEnd(id) : false;
        const parts = [reply];
        if (error) parts.push(t("chat.errorNothingChanged"));
        else if (recipeEdited) parts.push(t("meals.recipe.announceUpdated"));
        else if (result?.applied.some((a) => a.refs.length)) parts.push(t("chat.announceKitchenUpdated"));
        // A batch choice waits in the receipt (0025): say so, since nothing else points to it.
        if (result && !error) {
          for (const offer of offersOf(result.applied)) {
            const older = openOlder(offer, result.state);
            if (older.length) parts.push(batchWords(offer, older).question);
          }
        }
        announce(parts.filter(Boolean).join(" "));
        if (dockNow.current === "minimized") setNewReply(true);
      },
      onUndone(result) {
        sync.applyOwn(result.state);
        setMarks(marksFrom(result));
        announce(t("receipt.announceUndone", { changes: result.applied.map((a) => formatMsg(a.summary, "plain")).join(", ") }));
      },
      onUndoRefused() {
        announce(t("receipt.cantUndo"));
      },
    },
  });

  const send = (text: string) => {
    if (!online) return false;
    const sent = chat.send(text);
    if (sent) {
      // "New" / "Updated" labels and cues last until your next message (ux.md §1).
      setMarks({});
      setRemoteIds(new Set());
      setCue(null);
      clearLive();
      setTurn((n) => n + 1);
    }
    return sent;
  };

  // Arriving at a place: remember it, clear a cue that pointed here, and (after a dock tap) put
  // focus on its title so reading starts there. Chat-driven moves (the Recipe) never take focus.
  // The very first arrival checks "reopen where you left off" FIRST (ux.md §10): a phone opened
  // fresh on Today goes back to the place used within a few hours. (It must read the last place
  // before this effect remembers Today over it.)
  const resumeChecked = useRef(false);
  useEffect(() => {
    if (!resumeChecked.current) {
      resumeChecked.current = true;
      if (window.location.pathname === "/" && !window.matchMedia(DESKTOP_QUERY).matches) {
        const id = placeToResume();
        const place = id ? places.find((p) => p.id === id) : null;
        if (place) {
          router.replace(place.href);
          return;
        }
      }
    }
    if (current) rememberPlace(current.id);
    setCue((c) => (c && c.placeId === current?.id && dockNow.current !== "full" ? null : c));
    if (focusTitleOnArrival.current) {
      focusTitleOnArrival.current = false;
      document.getElementById(PLACE_TITLE_ID)?.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
    }
  }, [current, router]);

  // Buttons that change the kitchen without chat (the list's tick, Remove, Done shopping, To review).
  const actions = useMemo<KitchenActions>(() => {
    const tap = () => ({
      kitchenId,
      tapId: crypto.randomUUID(),
      basedOnVersion: sync.getSnapshot().state?.version ?? 0,
    });
    return {
      kitchenId,
      tickShopping: (shoppingItemId, ticked) =>
        (ticked ? tickShoppingListItem : untickShoppingListItem)({ ...tap(), shoppingItemId }),
      removeShopping: (shoppingItemId) => removeShoppingListItem({ ...tap(), shoppingItemId }),
      finishShopping: (ids) => finishShopping({ ...tap(), items: ids.map((shoppingItemId) => ({ shoppingItemId })) }),
      queueShoppingForLater: (shoppingItemIds) => queueShoppingForLater({ ...tap(), shoppingItemIds }),
      resolveReview: (reviewId, outcome, shoppingItemIds) =>
        resolveToReview({ ...tap(), reviewId, outcome, ...(shoppingItemIds ? { shoppingItemIds } : {}) }),
      undo: (changeSetId) => undoChange({ ...tap(), changeSetId }),
      closeBatch: (itemId, batchIds) => closeBatch({ ...tap(), itemId, batchIds }),
      keepOlderBatch: (itemId, batchIds) => keepOlderBatch({ ...tap(), itemId, batchIds }),
      setStockLevel: (itemId, level, batchId) => setItemStockLevel({ ...tap(), itemId, level, ...(batchId ? { batchId } : {}) }),
      addToList: (source, items) => addToShoppingList({ ...tap(), source, items }),
      showOwn(result, opts) {
        sync.applyOwn(result.state);
        if (opts?.highlight) setMarks(marksFrom(result));
      },
      touched(id) {
        const place = placeForHost(places, id);
        if (place) rememberPlace(place.id);
      },
    };
  }, [kitchenId, sync]);

  const recipeBox = useMemo<RecipeBoxActions>(
    () => ({
      listPastMeals: (q) => fetchPastMeals(kitchenId, q),
      makeAgain: (fromMealId) =>
        makeAgain({ kitchenId, tapId: crypto.randomUUID(), basedOnVersion: sync.getSnapshot().state?.version ?? 0, fromMealId }),
    }),
    [kitchenId, sync],
  );

  // The other person's changes: soft highlight + one announcement per sync; never move focus,
  // the page or the dock (ux.md §6). Items they used up or removed are gone from the state, so
  // `/changes` says who ("Levi used up the eggs."), announced instead.
  useEffect(
    () =>
      sync.onRemoteChange((change) => {
        const { ids, actorNames } = change;
        setRemoteIds((prev) => new Set([...prev, ...ids]));
        const who = actorNames.length
          ? new Intl.ListFormat(locale, { type: "conjunction" }).format(actorNames)
          : t("fallback.someone");
        const updated = t("chat.announceRemote", { name: who });
        if (!change.removedIds.length) {
          announce(updated);
          return;
        }
        void liveRemovals(change)
          .catch(() => null)
          .then((removed) => {
            if (!removed?.length) return announce(updated);
            announce([cueWords.summarize(removed).text, ids.length ? updated : ""].filter(Boolean).join(" "));
          });
      }),
    [sync, announce, t, locale, liveRemovals, cueWords],
  );

  // Going offline (or coming back) is said once, through the one Announcer; the header pill shows it.
  const offlineNow = !online || snapshot.status === "stale" || snapshot.status === "error";
  const wasOffline = useRef(offlineNow);
  useEffect(() => {
    if (wasOffline.current === offlineNow) return;
    wasOffline.current = offlineNow;
    announce(offlineNow ? t("chat.offline") : t("app.online"));
  }, [offlineNow, announce, t]);

  // Keep the newest message in view. Keyed on the LAST message, so loading older messages at the
  // top doesn't jump you to the bottom (MessageList keeps your place instead).
  const lastMessage = chat.state.messages.at(-1);
  const lastLength = lastMessage?.kind === "assistant" ? lastMessage.text.length : 0;
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [lastMessage?.id, lastLength, chat.state.busy, dock]);

  // Publish the header and bottom (chat + dock) heights so content is never hidden behind them (WCAG 2.4.11).
  useEffect(() => {
    const root = document.documentElement;
    const header = headerRef.current;
    const bottom = bottomRef.current;
    if (!header || !bottom) return;
    const update = () => {
      root.style.setProperty("--topbar-height", `${header.offsetHeight}px`);
      root.style.setProperty("--dock-height", `${isDesktop ? 0 : bottom.offsetHeight}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(header);
    ro.observe(bottom);
    return () => ro.disconnect();
  }, [dock, isDesktop]);

  // Focus follows the dock only when YOU change it: minimize → chat button; open → composer.
  useEffect(() => {
    const target = focusAfterDock.current;
    focusAfterDock.current = null;
    if (target === "fab") fabRef.current?.focus();
    if (target === "composer") composerRef.current?.focus();
  }, [dock]);

  /** Open the chat with text in the composer (Use my own recipe, Edit note in Settings). */
  const fillComposer = (text: string) => {
    if (dockNow.current === "minimized") changeDock("peek");
    composerRef.current?.fill(text);
  };

  const changeDock = (next: DockState, focus: "fab" | "composer" | null = null) => {
    focusAfterDock.current = focus;
    if (next !== "minimized") setNewReply(false);
    setDock(next);
  };

  const phoneFull = !isDesktop && dock === "full";
  const cuePlace = cue ? places.find((p) => p.id === cue.placeId) : null;
  const cueText = cue && cuePlace ? (cue.kind === "ideas" ? t("cue.ideas") : t("cue.updated", { place: t(cuePlace.titleKey) })) : null;

  const welcome = (
    <div className="flex flex-col items-start gap-2">
      <div className="flex items-start gap-2">
        <LumiFace state="idle" />
        <p className="bubble-lumi px-4 py-2 text-body">
          <span className="eyebrow block" aria-hidden="true">
            {t("chat.assistant")}
          </span>
          <span className="sr-only">{t("chat.assistant")}: </span>
          {t("chat.welcome")}
        </p>
      </div>
      <div role="group" aria-label={t("chat.suggestionsLabel")} className="flex flex-wrap gap-2 pl-12">
        {(["bought", "froze", "low"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => composerRef.current?.fill(t(`chat.suggestions.${key}`).replace(/…$/, " "))}
            className="chip"
          >
            {t(`chat.suggestions.${key}`)}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <KitchenActionsProvider value={actions}>
    <KitchenDataProvider value={{ me, snapshot, marks, remoteIds, now, turn, cues }}>
    <MealsProvider value={meals.value}>
    <RecipeBoxProvider value={recipeBox}>
    <AskLumiProvider value={{ ask: send, canAsk: online && !chat.state.busy }}>
    <PlaceRetryProvider value={() => void sync.refresh()}>
    <PlaceMemoryProvider>
    <ConfirmPromptProvider initial={initialPendingConfirm} fillComposer={fillComposer}>
      <TickQueueFlusher />
      <div className="app-shell min-h-dvh" data-chat={dock === "minimized" ? "minimized" : "open"}>
        <a href="#workspace" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface-raised focus:p-2">
          {t("app.skipToWorkspace")}
        </a>
        <a href="#chat" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface-raised focus:p-2">
          {t("app.skipToChat")}
        </a>

        <Header
          ref={headerRef}
          title={title}
          me={me}
          members={members}
          devActingAs={devActingAs}
          sync={snapshot.status}
          online={online}
          settingsOpen={settingsOpen}
        />

        <main id="workspace" tabIndex={-1} aria-label={t("workspace.label")} inert={phoneFull} className="stage px-4 pt-4 outline-none desk:px-7 desk:pt-6">
          {children}
        </main>
        <UpdateKitchenSheet />

        <div ref={bottomRef} className="bottom-area" data-dock={dock}>
          <section
            id="chat"
            tabIndex={-1}
            aria-label={t("chat.label")}
            data-dock={dock}
            className="chat-dock flex flex-col rounded-t-sheet bg-surface-default shadow-dock desk:rounded-none desk:border-l-2 desk:border-border-default desk:shadow-none"
          >
            <h2 className="sr-only">{t("chat.heading")}</h2>
            <div className="flex items-center gap-1 px-2 pt-1 desk:px-4 desk:pt-3">
              <button
                type="button"
                aria-expanded={dock === "full"}
                aria-controls="chat-log"
                onClick={() => changeDock(dock === "full" ? "peek" : "full")}
                className="btn-quiet text-small desk:hidden"
              >
                {dock === "full" ? (
                  <CaretDownIcon aria-hidden="true" className="size-icon" />
                ) : (
                  <CaretUpIcon aria-hidden="true" className="size-icon" />
                )}
                {dock === "full" ? t("chat.hideChat") : t("chat.showChat")}
              </button>
              <p aria-hidden="true" className="hidden font-heading text-title font-medium desk:block">
                {t("chat.heading")}
              </p>
              <button type="button" aria-label={t("chat.minimize")} onClick={() => changeDock("minimized", "fab")} className="btn-icon ml-auto">
                <MinusIcon aria-hidden="true" className="size-icon" />
              </button>
            </div>

            {cueText && cuePlace && (
              <p data-cue={cuePlace.id} className="mx-4 mb-1 flex items-center gap-2 rounded-md bg-highlight-bg py-1 pl-3 text-small font-strong text-highlight-text">
                <span className="flex-1">{cueText}</span>
                <Link
                  href={cuePlace.href}
                  aria-label={t("cue.showLabel", { place: t(cuePlace.titleKey) })}
                  onClick={() => {
                    if (dockNow.current === "full") changeDock("peek");
                    setCue(null);
                  }}
                  className="btn-quiet text-highlight-text underline"
                >
                  {t("cue.show")}
                  <GoIcon aria-hidden="true" className="size-icon-sm" />
                </Link>
              </p>
            )}

            <div id="chat-log" ref={logRef} className="chat-log relative min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-2 desk:pt-3">
              <MessageList
                chat={chat.state}
                onRetry={chat.retry}
                onUndo={(id) => void chat.undo(id)}
                onLoadOlder={chat.loadOlder}
                onRetryHistory={() => void chat.loadLatest()}
                scrollRef={logRef}
                welcome={welcome}
              />
            </div>

            <div className="composer-area px-4 pt-2">
              {!online && <p className="mb-2 text-small text-text-muted">{t("chat.offline")}</p>}
              <Composer ref={composerRef} busy={chat.state.busy || !online} onSend={send} />
            </div>
          </section>

          <Dock places={places} currentId={current?.id ?? null} onNavigate={(id) => {
            focusTitleOnArrival.current = id !== current?.id;
            if (dockNow.current === "full") changeDock("peek");
          }} />
        </div>

        {dock === "minimized" && (
          <button
            ref={fabRef}
            type="button"
            onClick={() => changeDock("peek", "composer")}
            aria-label={newReply ? t("chat.openChatNewReply") : t("chat.openChat")}
            className="chat-fab btn btn-primary fixed right-4 z-30 size-fab p-0 shadow-fab"
          >
            <ChatIcon aria-hidden="true" className="size-icon-lg" />
            {newReply && (
              <span aria-hidden="true" className="absolute top-1 right-1 size-dot rounded-full bg-accent-text ring-2 ring-surface-raised" />
            )}
          </button>
        )}
      </div>
    </ConfirmPromptProvider>
    </PlaceMemoryProvider>
    </PlaceRetryProvider>
    </AskLumiProvider>
    </RecipeBoxProvider>
    </MealsProvider>
    </KitchenDataProvider>
    </KitchenActionsProvider>
  );
}
