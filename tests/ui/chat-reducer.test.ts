/** Chat conversation state (frontend.md §3): turns, receipts, errors, retry, undo. */
import { describe, expect, it } from "vitest";
import type { ApplyResult } from "@/contracts/apply-result";
import { chatReducer, initialChatState, latestReply, replyId, type ChatState } from "@/ui/chat/chat-reducer";
import { kitchen } from "../support/kitchen-rows";

const m = (code: string, params: Record<string, string> = {}) => ({ code, params, text: code });
const result = (over: Partial<ApplyResult> = {}): ApplyResult => ({
  changeSetId: "cs-1",
  newVersion: 2,
  undoable: true,
  applied: [{ opId: "1", summary: m("ITEM_ADDED", { name: "eggs" }), refs: [{ kind: "item", id: "i1", change: "added" }] }],
  rejected: [],
  state: kitchen([], 2),
  ...over,
});
const run = (...actions: Parameters<typeof chatReducer>[1][]): ChatState => actions.reduce(chatReducer, initialChatState);

describe("chat reducer", () => {
  it("a full turn: send → ack → applied → text → done", () => {
    const s = run(
      { type: "send", id: "a", text: "I bought eggs" },
      { type: "ack", id: "a" },
      { type: "applied", id: "a", result: result() },
      { type: "text", id: "a", delta: "All set: " },
      { type: "text", id: "a", delta: "added eggs." },
      { type: "done", id: "a" },
    );
    expect(s.busy).toBe(false);
    expect(s.messages[0]).toMatchObject({ kind: "user", status: "sent", text: "I bought eggs" });
    const reply = latestReply(s)!;
    expect(reply).toMatchObject({ id: replyId("a"), text: "All set: added eggs.", status: "done" });
    expect(reply.receipt).toMatchObject({ changeSetId: "cs-1", undo: "idle", undoable: true });
  });

  it("busy while a turn is in flight", () => {
    expect(run({ type: "send", id: "a", text: "x" }).busy).toBe(true);
  });

  it("fails before ack → the message is marked Not sent; retry reuses the same ID", () => {
    let s = run({ type: "send", id: "a", text: "x" }, { type: "notSent", id: "a" });
    expect(s.messages).toEqual([{ kind: "user", id: "a", text: "x", status: "failed" }]);
    s = chatReducer(s, { type: "retry", id: "a" });
    expect(s.messages[0]).toMatchObject({ id: "a", status: "sending" });
    expect(s.busy).toBe(true);
  });

  it("an error with nothing changed is retryable; retry replaces the failed reply", () => {
    let s = run(
      { type: "send", id: "a", text: "x" },
      { type: "ack", id: "a" },
      { type: "error", id: "a", reason: m("SAVE_FAILED"), retryable: true, changed: false },
    );
    expect(latestReply(s)).toMatchObject({ status: "error", error: { retryable: true } });
    s = chatReducer(s, { type: "retry", id: "a" });
    expect(latestReply(s)).toBeUndefined();
  });

  it("an error after changes saved says so (interrupted), and isn't retryable", () => {
    const s = run(
      { type: "send", id: "a", text: "x" },
      { type: "ack", id: "a" },
      { type: "applied", id: "a", result: result() },
      { type: "error", id: "a", reason: m("SAVE_FAILED"), retryable: true, changed: true },
    );
    expect(latestReply(s)).toMatchObject({ status: "interrupted", error: { retryable: false } });
  });

  it("a stream cut after applied → interrupted (changes saved); before applied → error", () => {
    const cutAfter = run({ type: "send", id: "a", text: "x" }, { type: "ack", id: "a" }, { type: "applied", id: "a", result: result() }, { type: "streamCut", id: "a" });
    expect(latestReply(cutAfter)?.status).toBe("interrupted");
    const cutBefore = run({ type: "send", id: "a", text: "x" }, { type: "ack", id: "a" }, { type: "streamCut", id: "a" });
    expect(latestReply(cutBefore)?.status).toBe("error");
  });

  it("undo: pending → done, or refused with a reason; only the matching receipt changes", () => {
    const base = run(
      { type: "send", id: "a", text: "x" },
      { type: "applied", id: "a", result: result() },
      { type: "done", id: "a" },
      { type: "send", id: "b", text: "y" },
      { type: "applied", id: "b", result: result({ changeSetId: "cs-2" }) },
      { type: "done", id: "b" },
    );
    const pending = chatReducer(base, { type: "undoStart", changeSetId: "cs-1" });
    const receipts = (s: ChatState) => s.messages.flatMap((x) => (x.kind === "assistant" && x.receipt ? [x.receipt.undo] : []));
    expect(receipts(pending)).toEqual(["pending", "idle"]);
    expect(receipts(chatReducer(pending, { type: "undoDone", changeSetId: "cs-1" }))).toEqual(["done", "idle"]);
    const refused = chatReducer(pending, { type: "undoRefused", changeSetId: "cs-1", reason: m("UNDO_CONFLICT") });
    expect(receipts(refused)).toEqual(["refused", "idle"]);
  });
});
