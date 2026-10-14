"use client";
/**
 * Sends a message and follows its turn stream (frontend.md §3): plain fetch + NDJSON, each event
 * checked against the shared schema. Errors become states in the conversation, never crashes:
 * - fails before `ack` → "Not sent · Try again";
 * - `error` → "I couldn't save that, so nothing changed. Try again";
 * - stream cut after `applied` → "Reply interrupted. Your changes were saved."
 * Retrying reuses the message's ID, so the server can never apply it twice.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ApplyResult } from "@/contracts/apply-result";
import type { Msg } from "@/contracts/common";
import { undoChange } from "@/app/actions";
import { chatReducer, initialChatState, type ChatState } from "./chat-reducer";
import { readTurnStream } from "./stream";

export interface TurnCallbacks {
  /** Your change saved: update the widgets before the reply arrives. */
  onApplied(result: ApplyResult): void;
  /** The turn finished (or failed): announce it once. */
  onTurnEnd(turn: { reply: string; result: ApplyResult | null; error: Msg | null; changed: boolean }): void;
  onUndone(result: ApplyResult): void;
  onUndoRefused(reason: Msg): void;
}

/** The last few finished turns, oldest first, for the interpreter's context (max 10). */
function recentHistory(state: ChatState, excludeId: string) {
  return state.messages
    .filter((m) => m.id !== excludeId && (m.kind === "user" ? m.status === "sent" : m.status === "done" && m.text))
    .slice(-10)
    .map((m) => ({ role: m.kind, text: m.text.slice(0, 4000) }));
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `m-${Date.now()}-${Math.random()}`);

export function useChat(opts: { kitchenId: string; getVersion: () => number; callbacks: TurnCallbacks }) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const stateRef = useRef<ChatState>(state);
  const cb = useRef(opts.callbacks);
  const getVersion = useRef(opts.getVersion);
  useEffect(() => {
    stateRef.current = state;
    cb.current = opts.callbacks;
    getVersion.current = opts.getVersion;
  });
  const { kitchenId } = opts;

  const run = useCallback(
    async (id: string, text: string) => {
      let res: Response;
      try {
        res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/x-ndjson" },
          body: JSON.stringify({ kitchenId, clientMessageId: id, text, history: recentHistory(stateRef.current, id) }),
        });
        if (!res.ok || !res.body) throw new Error(`chat: ${res.status}`);
      } catch {
        dispatch({ type: "notSent", id });
        cb.current.onTurnEnd({ reply: "", result: null, error: null, changed: false });
        return;
      }

      let acked = false;
      let ended = false;
      let reply = "";
      let result: ApplyResult | null = null;
      try {
        for await (const event of readTurnStream(res.body)) {
          switch (event.type) {
            case "ack":
              acked = true;
              dispatch({ type: "ack", id });
              break;
            case "applied":
              result = event.result;
              dispatch({ type: "applied", id, result: event.result });
              cb.current.onApplied(event.result);
              break;
            case "text":
              reply += event.delta;
              dispatch({ type: "text", id, delta: event.delta });
              break;
            case "done":
              ended = true;
              dispatch({ type: "done", id });
              cb.current.onTurnEnd({ reply, result, error: null, changed: Boolean(result) });
              break;
            case "error":
              ended = true;
              dispatch({ type: "error", id, reason: event.reason, retryable: event.retryable, changed: event.changed });
              cb.current.onTurnEnd({ reply, result, error: event.reason, changed: event.changed });
              break;
            default:
              break; // status, notes, ideas…: not used by this milestone's UI
          }
        }
      } catch {
        // connection dropped mid-stream: handled below
      }
      if (ended) return;
      if (!acked) {
        dispatch({ type: "notSent", id });
        cb.current.onTurnEnd({ reply: "", result: null, error: null, changed: false });
        return;
      }
      dispatch({ type: "streamCut", id });
      cb.current.onTurnEnd({ reply, result, error: null, changed: Boolean(result) });
    },
    [kitchenId],
  );

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || stateRef.current.busy) return false;
      const id = newId();
      dispatch({ type: "send", id, text: trimmed });
      void run(id, trimmed);
      return true;
    },
    [run],
  );

  const retry = useCallback(
    (id: string) => {
      const msg = stateRef.current.messages.find((m) => m.kind === "user" && m.id === id);
      if (!msg || msg.kind !== "user" || stateRef.current.busy) return;
      dispatch({ type: "retry", id });
      void run(id, msg.text);
    },
    [run],
  );

  const undo = useCallback(
    async (changeSetId: string) => {
      dispatch({ type: "undoStart", changeSetId });
      try {
        const out = await undoChange({
          kitchenId,
          changeSetId,
          tapId: `undo:${changeSetId}`,
          basedOnVersion: getVersion.current(),
        });
        if (out.ok && out.result.applied.length > 0 && out.result.rejected.length === 0) {
          dispatch({ type: "undoDone", changeSetId });
          cb.current.onUndone(out.result);
        } else {
          const reason = out.ok ? (out.result.rejected[0]?.reason ?? out.result.undoBlockedReason) : out.reason;
          const fallback: Msg = { code: "UNDO_CONFLICT", params: {}, text: "" };
          dispatch({ type: "undoRefused", changeSetId, reason: reason ?? fallback });
          cb.current.onUndoRefused(reason ?? fallback);
          if (out.ok) cb.current.onApplied(out.result);
        }
      } catch {
        const reason: Msg = { code: "SAVE_FAILED", params: {}, text: "" };
        dispatch({ type: "undoRefused", changeSetId, reason });
        cb.current.onUndoRefused(reason);
      }
    },
    [kitchenId],
  );

  return { state, send, retry, undo };
}
