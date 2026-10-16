"use client";
/**
 * The conversation (ux.md §4): bubbles, the receipt under each reply, errors with Try again.
 * It's a `log` with announcing OFF, so streamed chunks aren't read piecemeal; the one polite
 * live region (Announcer) speaks once per turn instead (frontend.md §6).
 * `data-peek` marks what the phone's Peek state shows: the latest reply (or a pending message).
 *
 * Lumi (KOS10, 0045) is the face beside each reply: thinking while she writes, one happy hop when
 * a reply lands (the only "pop" outside celebrations, V-KOS1 Rec), then still. Decorative: the
 * reply is labelled "Lumi:" in words for screen readers.
 *
 * Saved chat (P2 a): a loading line or an error with "Try again" while the latest page is out;
 * "Show earlier messages" at the top loads older pages. It's a button, not infinite scroll: what
 * you're reading stays where it is, and focus stays on the button (or, once there's nothing older,
 * moves to the oldest message so reading carries on from there).
 */
import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useAnnounce } from "@/ui/a11y/Announcer";
import { LumiHalo, type LumiState } from "@/ui/lumi/Lumi";
import type { AssistantMessage, ChatState, UserMessage } from "./chat-reducer";
import { useFormatMsg } from "./format-msg";
import { Receipt } from "./Receipt";
import { StaplesAnswerAdd } from "./StaplesAnswerAdd";

export function MessageList({
  chat,
  onRetry,
  onUndo,
  onView,
  onLoadOlder,
  onRetryHistory,
  scrollRef,
  welcome,
}: {
  chat: ChatState;
  onRetry: (id: string) => void;
  onUndo: (changeSetId: string) => void;
  onView?: () => void;
  /** Loads the next older page; resolves to how many messages it added and whether more remain. */
  onLoadOlder: () => Promise<{ added: number; more: boolean }>;
  onRetryHistory: () => void;
  /** The scrolling container, so loading older messages can keep your place. */
  scrollRef: RefObject<HTMLElement | null>;
  welcome: React.ReactNode;
}) {
  const t = useTranslations("chat");
  const announce = useAnnounce();
  const { messages, busy, history } = chat;
  const listRef = useRef<HTMLDivElement>(null);
  const earlierRef = useRef<HTMLButtonElement>(null);
  /** Set while an older page loads: distance from the bottom, and whether the button had focus. */
  const restore = useRef<{ fromBottom: number; hadFocus: boolean } | null>(null);

  const showEarlier = async () => {
    if (history.older === "loading") return;
    const scroller = scrollRef.current;
    restore.current = {
      fromBottom: scroller ? scroller.scrollHeight - scroller.scrollTop : 0,
      hadFocus: document.activeElement === earlierRef.current,
    };
    const { added, more } = await onLoadOlder();
    if (added > 0) announce(more ? t("earlierShown", { count: added }) : `${t("earlierShown", { count: added })} ${t("startOfChat")}`);
  };

  // After an older page renders: put back what you were reading, and keep focus somewhere sensible.
  useLayoutEffect(() => {
    const r = restore.current;
    if (!r || history.older === "loading") return;
    restore.current = null;
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight - r.fromBottom;
    if (r.hadFocus && !earlierRef.current) {
      listRef.current?.querySelector<HTMLElement>("[data-message]")?.focus({ preventScroll: true });
    }
  }, [history.older, messages, scrollRef]);

  const last = messages.at(-1);
  // Peek shows the latest reply; while a message is on its way (or failed), that message.
  const peekId = last?.kind === "assistant" ? last.id : last?.id;
  const pendingReply = busy && (last?.kind === "user" || (last?.kind === "assistant" && last.status === "pending" && !last.text));

  const empty = messages.length === 0;
  const loadingOlder = history.older === "loading";

  return (
    <div ref={listRef} role="log" aria-live="off" aria-label={t("messagesLabel")} className="flex flex-col gap-3">
      {history.status === "ready" && history.nextCursor && (
        <div data-peek="false" className="flex flex-col items-center gap-1">
          <button
            ref={earlierRef}
            type="button"
            onClick={() => void showEarlier()}
            aria-disabled={loadingOlder || undefined}
            className="btn btn-small text-accent-text"
          >
            {loadingOlder ? t("loadingEarlier") : t("showEarlier")}
          </button>
          {history.older === "error" && <p className="text-small text-error-text">{t("earlierError")}</p>}
        </div>
      )}
      {history.status === "loading" && (
        <p data-peek={empty} className="text-small text-text-muted">
          {t("historyLoading")}
        </p>
      )}
      {history.status === "error" && (
        <p data-peek={empty} className="flex flex-wrap items-center gap-2 rounded-md bg-error-bg px-3 py-2 text-small text-error-text">
          {t("historyError")}
          <button type="button" onClick={onRetryHistory} className="btn-quiet">
            {t("tryAgain")}
          </button>
        </p>
      )}
      {empty && history.status === "ready" && <div data-peek="true">{welcome}</div>}
      {messages.map((m) =>
        m.kind === "user" ? (
          <UserBubble key={m.id} message={m} peek={m.id === peekId} onRetry={onRetry} />
        ) : (
          <AssistantBubble
            key={m.id}
            message={m}
            peek={m.id === peekId}
            onRetry={() => onRetry(m.replyTo)}
            onUndo={onUndo}
            onView={onView}
          />
        ),
      )}
      {pendingReply && (
        // Lumi tilts while she writes, in place of the typing dots; with reduced motion she's still.
        <p data-peek="true" className="flex items-center gap-2 text-small text-text-muted">
          <LumiFace state="think" />
          {t("writing")}
        </p>
      )}
    </div>
  );
}

function UserBubble({ message, peek, onRetry }: { message: UserMessage; peek: boolean; onRetry: (id: string) => void }) {
  const t = useTranslations("chat");
  return (
    <div data-peek={peek || message.status === "failed"} data-message={message.id} tabIndex={-1} className="flex flex-col items-end gap-1">
      <p className="bubble-you max-w-[85%] px-4 py-2 text-body font-medium whitespace-pre-wrap">
        <span className="sr-only">{t("you")}: </span>
        {message.text}
      </p>
      {message.status === "failed" && (
        <p className="flex items-center gap-2 text-small text-error-text">
          {t("notSent")}
          <button
            type="button"
            onClick={() => onRetry(message.id)}
            className="btn-quiet"
          >
            {t("tryAgain")}
          </button>
        </p>
      )}
    </div>
  );
}

/** Lumi beside a reply: the small cat in her soft round halo (prototype `.cat-wrap`). */
export function LumiFace({ state = "idle" }: { state?: LumiState }) {
  return <LumiHalo state={state} size="tap" />;
}

/** Happy for a moment when a reply lands, then still. */
function MoodLumi({ fresh }: { fresh: boolean }) {
  const [mood, setMood] = useState<LumiState>(fresh ? "happy" : "idle");
  useEffect(() => {
    if (mood !== "happy") return;
    const timer = setTimeout(() => setMood("idle"), 1400);
    return () => clearTimeout(timer);
  }, [mood]);
  return <LumiFace state={mood} />;
}

function AssistantBubble({
  message,
  peek,
  onRetry,
  onUndo,
  onView,
}: {
  message: AssistantMessage;
  peek: boolean;
  onRetry: () => void;
  onUndo: (changeSetId: string) => void;
  onView?: () => void;
}) {
  const t = useTranslations("chat");
  const formatMsg = useFormatMsg();
  // A reply that finished while you watched gets one happy hop; saved ones are just there.
  const [watched] = useState(message.status === "pending");
  if (message.status === "pending" && !message.text && !message.receipt) return null;
  const writing = message.status === "pending";
  return (
    <div data-peek={peek} data-message={message.id} tabIndex={-1} className="flex items-start gap-2">
      {writing ? <LumiFace state="think" /> : <MoodLumi key={message.status} fresh={watched && message.status === "done"} />}
      <div className="flex min-w-0 flex-1 flex-col items-start">
      {message.text && (
        <p className="bubble-lumi max-w-full px-4 py-2 text-body whitespace-pre-wrap">
          <span className="eyebrow block" aria-hidden="true">{t("assistant")}</span>
          <span className="sr-only">{t("assistant")}: </span>
          {message.text}
        </p>
      )}
      {message.staples && message.status !== "error" && <StaplesAnswerAdd items={message.staples} />}
      {message.receipt && (
        <div className="w-full">
          <Receipt receipt={message.receipt} onUndo={onUndo} onView={onView} />
        </div>
      )}
      {message.status === "interrupted" && (
        <p className="mt-2 text-small text-text-muted">{t("interrupted")}</p>
      )}
      {message.status === "error" && (
        <p className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-error-bg px-3 py-2 text-small text-error-text">
          {message.error && message.error.reason.code !== "SAVE_FAILED"
            ? formatMsg(message.error.reason)
            : t("errorNothingChanged")}
          {message.error?.retryable !== false && (
            <button type="button" onClick={onRetry} className="btn-quiet">
              {t("tryAgain")}
            </button>
          )}
        </p>
      )}
      </div>
    </div>
  );
}
