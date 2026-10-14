"use client";
/**
 * Sends a message and follows its turn stream (frontend.md §3): plain fetch + NDJSON, each event
 * checked against the shared schema. Errors become states in the conversation, never crashes:
 * - fails before `ack` → "Not sent · Try again";
 * - `error` → "I couldn't save that, so nothing changed. Try again";
 * - stream cut after `applied` → "Reply interrupted. Your changes were saved."
 * Retrying reuses the message's ID, so the server can never apply it twice.
 *
 * Saved chat (P2 a): the page hands over the latest page it read on the server; if that read
 * failed, the hook fetches it. "Show earlier messages" fetches older pages. The server builds the
 * interpreter's context from saved chat, so turns no longer send `history`.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import { z } from "zod";
import type { ApplyResult } from "@/contracts/apply-result";
import { ChatHistoryMessage, type ChatHistoryPage } from "@/contracts/chat-history";
import type { Msg } from "@/contracts/common";
import type { StreamEvent } from "@/contracts/stream";
import { undoChange } from "@/app/actions";
import { chatReducer, initialChatState, type ChatState } from "./chat-reducer";
import { readTurnStream } from "./stream";

/** Messages per history page (the server's default, backend-data.md §6). */
export const HISTORY_PAGE_SIZE = 30;

const PageEnvelope = z.object({ messages: z.array(z.unknown()), nextCursor: z.string().nullable() });

/**
 * One page of saved chat. Throws if the page can't be read at all; a single message that fails
 * the contract is dropped and logged instead (0018).
 */
export async function fetchHistoryPage(kitchenId: string, before?: string | null): Promise<ChatHistoryPage> {
  const params = new URLSearchParams({ kitchenId, limit: String(HISTORY_PAGE_SIZE) });
  if (before) params.set("before", before);
  const res = await fetch(`/api/chat/history?${params}`, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`chat history: ${res.status}`);
  const page = PageEnvelope.parse(await res.json());
  const messages = page.messages.flatMap((raw) => {
    const parsed = ChatHistoryMessage.safeParse(raw);
    if (parsed.success) return [parsed.data];
    console.error("chat history: dropped a message", parsed.error.issues);
    return [];
  });
  return { messages, nextCursor: page.nextCursor };
}

/** The reducer's first state: the server's page if it has one, otherwise "loading". */
function startFrom(initial: ChatHistoryPage | null | undefined): ChatState {
  if (!initial) return { ...initialChatState, history: { ...initialChatState.history, status: "loading" } };
  return chatReducer(initialChatState, { type: "historyLoaded", which: "latest", ...initial });
}

export interface TurnCallbacks {
  /** Your change saved: update the widgets before the reply arrives. */
  onApplied(result: ApplyResult): void;
  /** The turn finished (or failed): announce it once. `id` is the message's client ID. */
  onTurnEnd(turn: { id?: string; reply: string; result: ApplyResult | null; error: Msg | null; changed: boolean }): void;
  /** Every stream event, for the widgets that follow it (meal ideas, recipes, "Update your kitchen"). */
  onEvent?(event: StreamEvent, id: string): void;
  onUndone(result: ApplyResult): void;
  onUndoRefused(reason: Msg): void;
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `m-${Date.now()}-${Math.random()}`);

export function useChat(opts: {
  kitchenId: string;
  getVersion: () => number;
  callbacks: TurnCallbacks;
  /** The latest saved page, read on the server; null if that read failed (the hook retries). */
  initialHistory?: ChatHistoryPage | null;
}) {
  const [state, dispatch] = useReducer(chatReducer, opts.initialHistory, startFrom);
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
          body: JSON.stringify({ kitchenId, clientMessageId: id, text }),
        });
        if (!res.ok || !res.body) throw new Error(`chat: ${res.status}`);
      } catch {
        dispatch({ type: "notSent", id });
        cb.current.onTurnEnd({ id, reply: "", result: null, error: null, changed: false });
        return;
      }

      let acked = false;
      let ended = false;
      let reply = "";
      let result: ApplyResult | null = null;
      try {
        for await (const event of readTurnStream(res.body)) {
          try {
            cb.current.onEvent?.(event, id);
          } catch (error) {
            // A widget's trouble with one event never stops the chat (0018).
            console.error("chat: a widget couldn't handle a stream event", { type: event.type, error });
          }
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
              cb.current.onTurnEnd({ id, reply, result, error: null, changed: Boolean(result) });
              break;
            case "error":
              ended = true;
              dispatch({ type: "error", id, reason: event.reason, retryable: event.retryable, changed: event.changed });
              cb.current.onTurnEnd({ id, reply, result, error: event.reason, changed: event.changed });
              break;
            default:
              break; // status, notes, ideas, recipes…: handled by `onEvent`
          }
        }
      } catch {
        // connection dropped mid-stream: handled below
      }
      if (ended) return;
      if (!acked) {
        dispatch({ type: "notSent", id });
        cb.current.onTurnEnd({ id, reply: "", result: null, error: null, changed: false });
        return;
      }
      dispatch({ type: "streamCut", id });
      cb.current.onTurnEnd({ id, reply, result, error: null, changed: Boolean(result) });
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

  /** The latest page (on open when the server couldn't read it, or "Try again"). */
  const loadLatest = useCallback(async () => {
    dispatch({ type: "historyLoading", which: "latest" });
    try {
      const page = await fetchHistoryPage(kitchenId);
      dispatch({ type: "historyLoaded", which: "latest", ...page });
    } catch (error) {
      console.error("chat history: couldn't load", error);
      dispatch({ type: "historyFailed", which: "latest" });
    }
  }, [kitchenId]);

  /** "Show earlier messages": the next older page. Resolves to what it added and whether there's more. */
  const loadOlder = useCallback(async (): Promise<{ added: number; more: boolean }> => {
    const { history } = stateRef.current;
    if (history.older === "loading" || !history.nextCursor) return { added: 0, more: Boolean(history.nextCursor) };
    stateRef.current = { ...stateRef.current, history: { ...history, older: "loading" } };
    dispatch({ type: "historyLoading", which: "older" });
    try {
      const page = await fetchHistoryPage(kitchenId, history.nextCursor);
      dispatch({ type: "historyLoaded", which: "older", ...page });
      return { added: page.messages.length, more: page.nextCursor !== null };
    } catch (error) {
      console.error("chat history: couldn't load older messages", error);
      dispatch({ type: "historyFailed", which: "older" });
      return { added: 0, more: true };
    }
  }, [kitchenId]);

  const needsLatest = useRef(state.history.status === "loading");
  useEffect(() => {
    if (!needsLatest.current) return;
    needsLatest.current = false;
    void loadLatest();
  }, [loadLatest]);

  return { state, send, retry, undo, loadLatest, loadOlder };
}
