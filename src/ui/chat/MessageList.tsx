"use client";
/**
 * The conversation (ux.md §4): bubbles, the receipt under each reply, errors with Try again.
 * It's a `log` with announcing OFF, so streamed chunks aren't read piecemeal; the one polite
 * live region (Announcer) speaks once per turn instead (frontend.md §6).
 * `data-peek` marks what the phone's Peek state shows: the latest reply (or a pending message).
 */
import { useTranslations } from "next-intl";
import type { AssistantMessage, ChatState, UserMessage } from "./chat-reducer";
import { useFormatMsg } from "./format-msg";
import { Receipt } from "./Receipt";

export function MessageList({
  chat,
  onRetry,
  onUndo,
  onView,
  welcome,
}: {
  chat: ChatState;
  onRetry: (id: string) => void;
  onUndo: (changeSetId: string) => void;
  onView: () => void;
  welcome: React.ReactNode;
}) {
  const t = useTranslations("chat");
  const { messages, busy } = chat;
  const last = messages.at(-1);
  // Peek shows the latest reply; while a message is on its way (or failed), that message.
  const peekId = last?.kind === "assistant" ? last.id : last?.id;
  const pendingReply = busy && (last?.kind === "user" || (last?.kind === "assistant" && last.status === "pending" && !last.text));

  return (
    <div role="log" aria-live="off" aria-label={t("messagesLabel")} className="flex flex-col gap-3">
      {messages.length === 0 && <div data-peek="true">{welcome}</div>}
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
        <p data-peek="true" className="flex items-center gap-1 text-small text-text-muted">
          {t("writing")}
          <span aria-hidden="true" className="flex gap-0.5">
            <span className="typing-dot size-1 rounded-full bg-text-muted" />
            <span className="typing-dot size-1 rounded-full bg-text-muted" />
            <span className="typing-dot size-1 rounded-full bg-text-muted" />
          </span>
        </p>
      )}
    </div>
  );
}

function UserBubble({ message, peek, onRetry }: { message: UserMessage; peek: boolean; onRetry: (id: string) => void }) {
  const t = useTranslations("chat");
  return (
    <div data-peek={peek || message.status === "failed"} data-message={message.id} className="flex flex-col items-end gap-1">
      <p className="max-w-[85%] rounded-lg rounded-br-sm bg-accent-soft px-4 py-2 text-body whitespace-pre-wrap">
        <span className="sr-only">{t("you")}: </span>
        {message.text}
      </p>
      {message.status === "failed" && (
        <p className="flex items-center gap-2 text-small text-error-text">
          {t("notSent")}
          <button
            type="button"
            onClick={() => onRetry(message.id)}
            className="min-h-tap rounded-button px-2 font-strong text-accent-text"
          >
            {t("tryAgain")}
          </button>
        </p>
      )}
    </div>
  );
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
  onView: () => void;
}) {
  const t = useTranslations("chat");
  const formatMsg = useFormatMsg();
  if (message.status === "pending" && !message.text && !message.receipt) return null;
  return (
    <div data-peek={peek} data-message={message.id} className="flex flex-col items-start">
      {message.text && (
        <p className="max-w-[90%] rounded-lg rounded-bl-sm bg-surface-default px-4 py-2 text-body whitespace-pre-wrap">
          <span className="sr-only">{t("assistant")}: </span>
          {message.text}
        </p>
      )}
      {message.receipt && (
        <div className="w-full max-w-[90%]">
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
            <button type="button" onClick={onRetry} className="min-h-tap rounded-button px-2 font-strong text-accent-text">
              {t("tryAgain")}
            </button>
          )}
        </p>
      )}
    </div>
  );
}
