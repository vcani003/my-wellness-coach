/**
 * Conversation state for the chat dock: a pure reducer (old state + action → new state), so
 * every chat behaviour is unit-testable without a browser (frontend.md §3).
 * Chats are private (H2, 0017) and, in this milestone, live only in memory.
 */
import type { AppliedOp, ApplyResult, RejectedOp } from "@/contracts/apply-result";
import type { Msg } from "@/contracts/common";

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
}

export interface AssistantMessage {
  kind: "assistant";
  id: string;
  replyTo: string;
  text: string;
  status: "pending" | "done" | "error" | "interrupted";
  receipt?: Receipt;
  error?: { reason: Msg; retryable: boolean };
}

export type ChatMessage = UserMessage | AssistantMessage;

export interface ChatState {
  messages: ChatMessage[];
  /** A turn is in flight: Send waits so turns stay in order. */
  busy: boolean;
}

export const initialChatState: ChatState = { messages: [], busy: false };

export type ChatAction =
  | { type: "send"; id: string; text: string }
  | { type: "retry"; id: string }
  | { type: "ack"; id: string }
  | { type: "applied"; id: string; result: ApplyResult }
  | { type: "text"; id: string; delta: string }
  | { type: "done"; id: string }
  | { type: "error"; id: string; reason: Msg; retryable: boolean; changed: boolean }
  | { type: "notSent"; id: string }
  | { type: "streamCut"; id: string }
  | { type: "undoStart"; changeSetId: string }
  | { type: "undoDone"; changeSetId: string }
  | { type: "undoRefused"; changeSetId: string; reason: Msg };

export const replyId = (userMessageId: string) => `${userMessageId}:reply`;

export function toReceipt(result: ApplyResult): Receipt {
  return {
    changeSetId: result.changeSetId,
    newVersion: result.newVersion,
    undoable: result.undoable,
    ...(result.undoBlockedReason ? { undoBlockedReason: result.undoBlockedReason } : {}),
    applied: result.applied,
    rejected: result.rejected,
    undo: "idle",
  };
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
      return { busy: true, messages: [...state.messages, { kind: "user", id: action.id, text: action.text, status: "sending" }] };
    case "retry": {
      // Same ID again, so the server can't apply it twice; the old reply (if any) is replaced.
      const rid = replyId(action.id);
      return { busy: true, messages: setUser({ ...state, messages: state.messages.filter((m) => m.id !== rid) }, action.id, "sending") };
    }
    case "ack":
      return { ...state, messages: withReply({ ...state, messages: setUser(state, action.id, "sent") }, action.id, (m) => m) };
    case "applied":
      return { ...state, messages: withReply(state, action.id, (m) => ({ ...m, receipt: toReceipt(action.result) })) };
    case "text":
      return { ...state, messages: withReply(state, action.id, (m) => ({ ...m, text: m.text + action.delta })) };
    case "done":
      return { busy: false, messages: withReply(state, action.id, (m) => ({ ...m, status: "done" })) };
    case "error":
      return {
        busy: false,
        messages: withReply({ ...state, messages: setUser(state, action.id, "sent") }, action.id, (m) => ({
          ...m,
          // If changes were already saved, say so instead of "nothing changed".
          status: action.changed ? "interrupted" : "error",
          error: { reason: action.reason, retryable: action.retryable && !action.changed },
        })),
      };
    case "notSent":
      return { busy: false, messages: setUser(state, action.id, "failed") };
    case "streamCut":
      return {
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
