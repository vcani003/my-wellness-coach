/**
 * Conversation state for the chat dock: a pure reducer (old state + action → new state), so
 * every chat behaviour is unit-testable without a browser (frontend.md §3).
 * Chats are private (H2, 0017) and saved on the server (P2 a): the latest page loads on open,
 * older pages on "Show earlier messages", and live turns append as before.
 */
import type { AppliedOp, ApplyResult, RejectedOp } from "@/contracts/apply-result";
import type { BatchAnswer, ChatHistoryMessage, ChatReceipt } from "@/contracts/chat-history";
import type { Msg } from "@/contracts/common";
import type { StaplesAnswer } from "@/contracts/stream";

export interface UserMessage {
  kind: "user";
  /** Client-made ID: also the turn's idempotency key. */
  id: string;
  text: string;
  status: "sending" | "sent" | "failed";
}

export interface Receipt {
  changeSetId: string;
  newVersion: number;
  undoable: boolean;
  undoBlockedReason?: Msg;
  applied: AppliedOp[];
  rejected: RejectedOp[];
  undo: "idle" | "pending" | "done" | "refused";
  undoReason?: Msg;
  /** A saved receipt's batch-choice answers, drawn as they were live (step 28, 2026-10-14 re-run). */
  batchAnswers?: BatchAnswer[];
}

export interface AssistantMessage {
  kind: "assistant";
  id: string;
  replyTo: string;
  text: string;
  status: "pending" | "done" | "error" | "interrupted";
  receipt?: Receipt;
  error?: { reason: Msg; retryable: boolean };
  /**
   * A staples answer's needed staples (0054 SS6), for **Add these to my list** under the reply.
   * Live only: saved chat doesn't keep it (SS9), so a reloaded answer has no button.
   */
  staples?: StaplesAnswer["items"];
}

export type ChatMessage = UserMessage | AssistantMessage;

/** Saved chat: whether the latest page has loaded, and the cursor for older pages. */
export interface ChatHistoryState {
  status: "loading" | "ready" | "error";
  /** Pass as `before` for the next older page; null when there's nothing older. */
  nextCursor: string | null;
  older: "idle" | "loading" | "error";
}

export interface ChatState {
  messages: ChatMessage[];
  /** A turn is in flight: Send waits so turns stay in order. */
  busy: boolean;
  history: ChatHistoryState;
}

export const initialChatState: ChatState = {
  messages: [],
  busy: false,
  history: { status: "ready", nextCursor: null, older: "idle" },
};

export type ChatAction =
  | { type: "send"; id: string; text: string }
  | { type: "retry"; id: string }
  | { type: "ack"; id: string }
  | { type: "applied"; id: string; result: ApplyResult }
  | { type: "text"; id: string; delta: string }
  | { type: "staples"; id: string; items: StaplesAnswer["items"] }
  | { type: "done"; id: string }
  | { type: "error"; id: string; reason: Msg; retryable: boolean; changed: boolean }
  | { type: "notSent"; id: string }
  | { type: "streamCut"; id: string }
  | { type: "undoStart"; changeSetId: string }
  | { type: "undoDone"; changeSetId: string }
  | { type: "undoRefused"; changeSetId: string; reason: Msg }
  | { type: "historyLoading"; which: "latest" | "older" }
  | { type: "historyLoaded"; which: "latest" | "older"; messages: ChatHistoryMessage[]; nextCursor: string | null }
  | { type: "historyFailed"; which: "latest" | "older" };

export const replyId = (userMessageId: string) => `${userMessageId}:reply`;

/**
 * A live ApplyResult or a saved receipt (the same minus `state`) as the receipt card's model. A
 * saved receipt that was undone since comes back as Undone, exactly as after a live Undo, and
 * one whose batch choice was answered comes back with that answer in place.
 */
export function toReceipt(result: ApplyResult | ChatReceipt): Receipt {
  const undone = "undone" in result && result.undone === true;
  return {
    changeSetId: result.changeSetId,
    newVersion: result.newVersion,
    undoable: result.undoable,
    ...(result.undoBlockedReason ? { undoBlockedReason: result.undoBlockedReason } : {}),
    applied: result.applied,
    rejected: result.rejected,
    undo: undone ? "done" : "idle",
    ...("batchAnswers" in result && result.batchAnswers?.length ? { batchAnswers: result.batchAnswers } : {}),
  };
}

/**
 * A saved message as a conversation message. IDs follow the live ones (the user's message is its
 * `clientMessageId`, the reply `replyId(clientMessageId)`), so a turn is never shown twice.
 */
export function fromSaved(m: ChatHistoryMessage): ChatMessage {
  if (m.role === "user") return { kind: "user", id: m.clientMessageId, text: m.text, status: "sent" };
  return {
    kind: "assistant",
    id: replyId(m.clientMessageId),
    replyTo: m.clientMessageId,
    text: m.text,
    status: "done",
    ...(m.receipt ? { receipt: toReceipt(m.receipt) } : {}),
  };
}

/** Saved messages go before everything already shown (they're older); ones already shown are skipped. */
function prependSaved(messages: ChatMessage[], saved: ChatHistoryMessage[]): ChatMessage[] {
  const shown = new Set(messages.map((m) => m.id));
  const older: ChatMessage[] = [];
  for (const m of saved.map(fromSaved)) {
    if (shown.has(m.id)) continue;
    shown.add(m.id);
    older.push(m);
  }
  return [...older, ...messages];
}

function setUser(state: ChatState, id: string, status: UserMessage["status"]): ChatMessage[] {
  return state.messages.map((m) => (m.kind === "user" && m.id === id ? { ...m, status } : m));
}

/** Update the reply to `id`, creating it (pending) if the stream hasn't produced one yet. */
function withReply(state: ChatState, id: string, update: (m: AssistantMessage) => AssistantMessage): ChatMessage[] {
  const rid = replyId(id);
  if (!state.messages.some((m) => m.id === rid)) {
    const fresh: AssistantMessage = { kind: "assistant", id: rid, replyTo: id, text: "", status: "pending" };
    return [...state.messages, update(fresh)];
  }
  return state.messages.map((m) => (m.kind === "assistant" && m.id === rid ? update(m) : m));
}

function withReceipt(state: ChatState, changeSetId: string, update: (r: Receipt) => Receipt): ChatMessage[] {
  return state.messages.map((m) =>
    m.kind === "assistant" && m.receipt?.changeSetId === changeSetId ? { ...m, receipt: update(m.receipt) } : m,
  );
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send":
      return { ...state, busy: true, messages: [...state.messages, { kind: "user", id: action.id, text: action.text, status: "sending" }] };
    case "retry": {
      // Same ID again, so the server can't apply it twice; the old reply (if any) is replaced.
      const rid = replyId(action.id);
      return { ...state, busy: true, messages: setUser({ ...state, messages: state.messages.filter((m) => m.id !== rid) }, action.id, "sending") };
    }
    case "ack":
      return { ...state, messages: withReply({ ...state, messages: setUser(state, action.id, "sent") }, action.id, (m) => m) };
    case "applied":
      return { ...state, messages: withReply(state, action.id, (m) => ({ ...m, receipt: toReceipt(action.result) })) };
    case "text":
      return { ...state, messages: withReply(state, action.id, (m) => ({ ...m, text: m.text + action.delta })) };
    case "staples":
      return action.items.length ? { ...state, messages: withReply(state, action.id, (m) => ({ ...m, staples: action.items })) } : state;
    case "done":
      return { ...state, busy: false, messages: withReply(state, action.id, (m) => ({ ...m, status: "done" })) };
    case "error":
      return {
        ...state,
        busy: false,
        messages: withReply({ ...state, messages: setUser(state, action.id, "sent") }, action.id, (m) => ({
          ...m,
          // If changes were already saved, say so instead of "nothing changed".
          status: action.changed ? "interrupted" : "error",
          error: { reason: action.reason, retryable: action.retryable && !action.changed },
        })),
      };
    case "notSent":
      return { ...state, busy: false, messages: setUser(state, action.id, "failed") };
    case "streamCut":
      return {
        ...state,
        busy: false,
        messages: withReply(state, action.id, (m) =>
          m.receipt ? { ...m, status: "interrupted" } : { ...m, status: "error", error: { reason: { code: "SAVE_FAILED", params: {}, text: "" }, retryable: true } },
        ),
      };
    case "undoStart":
      return { ...state, messages: withReceipt(state, action.changeSetId, (r) => ({ ...r, undo: "pending" })) };
    case "undoDone":
      return { ...state, messages: withReceipt(state, action.changeSetId, (r) => ({ ...r, undo: "done" })) };
    case "undoRefused":
      return {
        ...state,
        messages: withReceipt(state, action.changeSetId, (r) => ({ ...r, undo: "refused", undoReason: action.reason })),
      };
    case "historyLoading":
      return {
        ...state,
        history:
          action.which === "latest"
            ? { ...state.history, status: "loading" }
            : { ...state.history, older: "loading" },
      };
    case "historyLoaded":
      return {
        ...state,
        messages: prependSaved(state.messages, action.messages),
        history: { status: "ready", nextCursor: action.nextCursor, older: "idle" },
      };
    case "historyFailed":
      return {
        ...state,
        history:
          action.which === "latest"
            ? { ...state.history, status: "error" }
            : { ...state.history, older: "error" },
      };
  }
}

/** The latest reply, for the phone's Peek state. */
export function latestReply(state: ChatState): AssistantMessage | undefined {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i];
    if (m.kind === "assistant") return m;
  }
  return undefined;
}
