"use client";
/**
 * The main screen (ux.md §1): the workspace and the chat.
 * - Phone: the workspace fills the screen and the chat is docked at the bottom, in three states:
 *   Peek (latest reply + receipt + composer), Full (whole conversation) and Minimized (a round
 *   chat button bottom-right, with a dot for a new reply; not draggable, UX4).
 * - Desktop (≥ 900 px): chat on the left (1/3), workspace on the right (2/3).
 * Your own change updates the widgets from the ApplyResult before the reply arrives; the other
 * person's changes arrive through `useKitchenSync`.
 */
import { useLocale, useNow, useTranslations } from "next-intl";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ApplyResult } from "@/contracts/apply-result";
import type { KitchenState } from "@/contracts/kitchen-state";
import { AnnouncerProvider, useAnnounce } from "@/ui/a11y/Announcer";
import { Composer, type ComposerHandle } from "@/ui/chat/Composer";
import { useFormatMsg } from "@/ui/chat/format-msg";
import { MessageList } from "@/ui/chat/MessageList";
import { useChat } from "@/ui/chat/useChat";
import { sentenceCase } from "@/ui/fallbacks";
import { CaretDownIcon, CaretUpIcon, ChatIcon, MinusIcon } from "@/ui/primitives/icons";
import { DevBar } from "@/ui/shell/DevBar";
import { DESKTOP_QUERY, useMediaQuery } from "@/ui/shell/useMediaQuery";
import { useKeyboardInset } from "@/ui/shell/viewport";
import { KitchenDataProvider, type ChangeMark } from "@/ui/sync/KitchenDataContext";
import { useKitchenSync } from "@/ui/sync/useKitchenSync";
import { focusFor, initialWorkspace, workspaceReducer } from "@/ui/workspace/layout";
import { registry } from "@/ui/workspace/registry";
import { Workspace } from "@/ui/workspace/Workspace";

export interface KitchenAppProps {
  kitchenId: string;
  me: { id: string; name: string };
  members: { userId: string; displayName: string }[];
  devActingAs: boolean;
  initialState: KitchenState | null;
}

export type DockState = "peek" | "full" | "minimized";

/** "New" for rows your change added, "Updated" for rows it changed (until your next message). */
export function marksFrom(result: ApplyResult): Record<string, ChangeMark> {
  const marks: Record<string, ChangeMark> = {};
  for (const op of result.applied) {
    for (const ref of op.refs) {
      if (ref.kind !== "item" || ref.change === "removed") continue;
      if (marks[ref.id] !== "new") marks[ref.id] = ref.change === "added" ? "new" : "updated";
    }
  }
  return marks;
}

export function KitchenApp(props: KitchenAppProps) {
  return (
    <AnnouncerProvider>
      <KitchenScreen {...props} />
    </AnnouncerProvider>
  );
}

function KitchenScreen({ kitchenId, me, members, devActingAs, initialState }: KitchenAppProps) {
  const t = useTranslations();
  const locale = useLocale();
  const announce = useAnnounce();
  const formatMsg = useFormatMsg();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const now = useNow({ updateInterval: 60_000 });
  useKeyboardInset();

  const { sync, snapshot } = useKitchenSync({ kitchenId, meId: me.id, initial: initialState });
  const [workspace, dispatchWorkspace] = useReducer(workspaceReducer, initialWorkspace);
  const [marks, setMarks] = useState<Record<string, ChangeMark>>({});
  const [remoteIds, setRemoteIds] = useState<ReadonlySet<string>>(() => new Set());
  const [dock, setDock] = useState<DockState>("peek");
  const [newReply, setNewReply] = useState(false);
  const [updatedWhileFull, setUpdatedWhileFull] = useState(false);

  const headerRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const focusAfterDock = useRef<"fab" | "composer" | null>(null);
  const dockNow = useRef(dock);
  useEffect(() => {
    dockNow.current = dock;
  }, [dock]);

  const showWidget = useCallback((id: string) => {
    const el = document.querySelector(`[data-widget="${CSS.escape(id)}"]`);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, []);

  const chat = useChat({
    kitchenId,
    getVersion: () => sync.getSnapshot().state?.version ?? 0,
    callbacks: {
      onApplied(result) {
        sync.applyOwn(result.state);
        setMarks(marksFrom(result));
        const focus = focusFor(
          registry,
          result.applied.flatMap((a) => a.refs),
        );
        dispatchWorkspace({ type: "turnApplied", focus });
        // On a phone the affected widget scrolls into view, unless you're reading Full chat.
        if (focus[0] && dockNow.current !== "full") requestAnimationFrame(() => showWidget(focus[0]));
        if (dockNow.current === "full" && focus.length) setUpdatedWhileFull(true);
      },
      onTurnEnd({ reply, result, error }) {
        const parts = [reply];
        if (error) parts.push(t("chat.errorNothingChanged"));
        else if (result?.applied.some((a) => a.refs.length)) parts.push(t("chat.announceKitchenUpdated"));
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
    const sent = chat.send(text);
    if (sent) {
      // "New" / "Updated" labels last until your next message (ux.md §1).
      setMarks({});
      setRemoteIds(new Set());
      dispatchWorkspace({ type: "messageSent" });
    }
    return sent;
  };

  // The other person's changes: soft highlight + one announcement per sync; never move focus,
  // reorder widgets or change the dock (ux.md §6).
  useEffect(
    () =>
      sync.onRemoteChange(({ ids, actorNames }) => {
        setRemoteIds((prev) => new Set([...prev, ...ids]));
        dispatchWorkspace({ type: "remoteChange" });
        const who = actorNames.length
          ? new Intl.ListFormat(locale, { type: "conjunction" }).format(actorNames)
          : t("fallback.someone");
        announce(t("chat.announceRemote", { name: who }));
      }),
    [sync, announce, t, locale],
  );

  // Keep the newest message in view.
  const lastMessage = chat.state.messages.at(-1);
  const lastLength = lastMessage?.kind === "assistant" ? lastMessage.text.length : 0;
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [chat.state.messages.length, lastLength, chat.state.busy, dock]);

  // Publish the header and dock heights so content is never hidden behind them (WCAG 2.4.11).
  useEffect(() => {
    const root = document.documentElement;
    const header = headerRef.current;
    const dockEl = dockRef.current;
    if (!header || !dockEl) return;
    const update = () => {
      root.style.setProperty("--topbar-height", `${header.offsetHeight}px`);
      const dockHeight = isDesktop ? 0 : dock === "minimized" ? 88 : dockEl.offsetHeight;
      root.style.setProperty("--dock-height", `${dockHeight}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(header);
    ro.observe(dockEl);
    return () => ro.disconnect();
  }, [dock, isDesktop]);

  // Focus follows the dock only when YOU change it: minimize → chat button; open → composer.
  useEffect(() => {
    const target = focusAfterDock.current;
    focusAfterDock.current = null;
    if (target === "fab") fabRef.current?.focus();
    if (target === "composer") composerRef.current?.focus();
  }, [dock]);

  const changeDock = (next: DockState, focus: "fab" | "composer" | null = null) => {
    focusAfterDock.current = focus;
    if (next !== "minimized") setNewReply(false);
    if (next !== "full") setUpdatedWhileFull(false);
    setDock(next);
  };

  const phoneFull = !isDesktop && dock === "full";
  const kitchenUpdatedHint = updatedWhileFull && dock === "full";

  const welcome = (
    <div className="flex flex-col items-start gap-2">
      <p className="max-w-[90%] rounded-lg rounded-bl-sm bg-surface-default px-4 py-2 text-body">
        <span className="sr-only">{t("chat.assistant")}: </span>
        {t("chat.welcome")}
      </p>
      <div role="group" aria-label={t("chat.suggestionsLabel")} className="flex flex-wrap gap-2">
        {(["bought", "froze", "low"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => composerRef.current?.fill(t(`chat.suggestions.${key}`).replace(/…$/, " "))}
            className="min-h-tap rounded-button border border-border-strong bg-surface-raised px-4 text-small font-medium"
          >
            {t(`chat.suggestions.${key}`)}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <KitchenDataProvider value={{ me, snapshot, marks, remoteIds, now }}>
      <div className="app-shell min-h-dvh desk:grid desk:h-dvh desk:grid-cols-[1fr_2fr] desk:grid-rows-[auto_minmax(0,1fr)] desk:overflow-hidden">
        <a href="#workspace" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:bg-surface-raised focus:p-2">
            {t("app.skipToWorkspace")}
          </a>
        <a href="#chat" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:bg-surface-raised focus:p-2">
            {t("app.skipToChat")}
          </a>

        <header ref={headerRef} className="sticky top-0 z-30 bg-surface-default desk:col-span-2 desk:static">
          {devActingAs && <DevBar meId={me.id} members={members} />}
          <div className="flex min-h-tap items-center gap-3 px-4 py-2 desk:px-6">
            <h1 className="text-heading font-strong">{t("app.name")}</h1>
            <span className="ml-auto flex items-center">
              <span
                aria-hidden="true"
                className="flex size-avatar items-center justify-center rounded-full bg-accent-soft text-small font-strong text-accent-text"
              >
                {sentenceCase(me.name, locale).charAt(0)}
              </span>
              <span className="sr-only">{t("app.signedInAs", { name: me.name })}</span>
            </span>
          </div>
        </header>

        <main
          id="workspace"
          tabIndex={-1}
          aria-label={t("workspace.label")}
          inert={phoneFull}
          className="workspace px-4 pt-2 desk:col-start-2 desk:row-start-2 desk:overflow-y-auto desk:px-6 desk:pt-4"
        >
          <Workspace
            registry={registry}
            state={workspace}
            dispatch={dispatchWorkspace}
            data={snapshot.state}
            layout={isDesktop ? "desktop" : "phone"}
            onRetry={() => void sync.refresh()}
          />
        </main>

        <section
          id="chat"
          ref={dockRef}
          tabIndex={-1}
          aria-label={t("chat.label")}
          data-dock={dock}
          className="chat-dock flex flex-col rounded-t-lg bg-surface-raised shadow-dock desk:col-start-1 desk:row-start-2 desk:min-h-0 desk:rounded-none desk:border-r desk:border-border-default desk:shadow-none"
        >
          <h2 className="sr-only">{t("chat.heading")}</h2>
          <div className="flex items-center gap-1 px-2 pt-1 desk:hidden">
            <button
              type="button"
              aria-expanded={dock === "full"}
              aria-controls="chat-log"
              onClick={() => changeDock(dock === "full" ? "peek" : "full")}
              className="flex min-h-tap items-center gap-2 rounded-button px-3 text-small font-strong text-accent-text"
            >
              {dock === "full" ? (
                <CaretDownIcon aria-hidden="true" className="size-icon" />
              ) : (
                <CaretUpIcon aria-hidden="true" className="size-icon" />
              )}
              {dock === "full" ? t("chat.hideChat") : t("chat.showChat")}
            </button>
            {kitchenUpdatedHint && (
              <span className="rounded-button bg-highlight-bg px-2 text-caption font-strong text-highlight-text">
                {t("chat.kitchenUpdated")}
              </span>
            )}
            <button
              type="button"
              aria-label={t("chat.minimize")}
              onClick={() => changeDock("minimized", "fab")}
              className="ml-auto flex size-tap items-center justify-center rounded-full text-text-muted"
            >
              <MinusIcon aria-hidden="true" className="size-icon" />
            </button>
          </div>

          <div id="chat-log" ref={logRef} className="chat-log min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-2 desk:pt-4">
            <MessageList
              chat={chat.state}
              onRetry={chat.retry}
              onUndo={(id) => void chat.undo(id)}
              onView={() => {
                changeDock("peek");
                requestAnimationFrame(() => showWidget(registry[0].id));
              }}
              welcome={welcome}
            />
          </div>

          <div className="composer-area border-t border-border-default px-4 pt-2">
            <Composer ref={composerRef} busy={chat.state.busy} onSend={send} />
          </div>
        </section>

        {dock === "minimized" && (
          <button
            ref={fabRef}
            type="button"
            onClick={() => changeDock("peek", "composer")}
            aria-label={newReply ? t("chat.openChatNewReply") : t("chat.openChat")}
            className="chat-fab fixed right-4 z-30 flex size-fab items-center justify-center rounded-full bg-accent-default text-text-inverse shadow-fab desk:hidden"
          >
            <ChatIcon aria-hidden="true" className="size-5" />
            {newReply && (
              <span
                aria-hidden="true"
                className="absolute top-1 right-1 size-dot rounded-full border-2 border-accent-default bg-highlight-bg"
              />
            )}
          </button>
        )}
      </div>
    </KitchenDataProvider>
  );
}
