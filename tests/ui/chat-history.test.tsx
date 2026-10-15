// @vitest-environment jsdom
/**
 * Saved chat in the dock (P2 a): the latest page renders with its receipts (Undo only where
 * `undoable`), loading / error / empty states, "Show earlier messages" keeps your place and focus,
 * live turns never duplicate saved ones, and turns no longer send `history`.
 */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatHistoryMessage, ChatHistoryPage, ChatReceipt } from "@/contracts/chat-history";
import { AnnouncerProvider } from "@/ui/a11y/Announcer";
import { chatReducer, initialChatState, replyId } from "@/ui/chat/chat-reducer";
import { MessageList } from "@/ui/chat/MessageList";
import { useChat, type TurnCallbacks } from "@/ui/chat/useChat";
import { renderWithIntl } from "../support/intl";

vi.mock("@/app/actions", () => ({ undoChange: vi.fn() }));

const T = "2026-10-14T10:00:00.000Z";
const m = (code: string, params: Record<string, string>, text: string) => ({ code, params, text });
const receipt = (changeSetId: string, name: string, undoable: boolean, undone = false): ChatReceipt => ({
  changeSetId,
  newVersion: 2,
  undoable,
  applied: [{ opId: "1", summary: m("ITEM_ADDED", { name }, `Added ${name}`), refs: [{ kind: "item", id: name, change: "added" }] }],
  rejected: [],
  undone,
  ...(undone ? { undoneBy: { id: "u-vero", name: "Vero" }, undoneAt: T } : {}),
});
/** One saved turn: the user's message and the reply (with an optional receipt). */
const turn = (id: string, said: string, reply: string, r: ChatReceipt | null = null): ChatHistoryMessage[] => [
  { id: `${id}-u`, clientMessageId: id, role: "user", text: said, createdAt: T, receipt: null },
  { id: `${id}-a`, clientMessageId: id, role: "assistant", text: reply, createdAt: T, receipt: r },
];

const callbacks: TurnCallbacks = { onApplied() {}, onTurnEnd() {}, onUndone() {}, onUndoRefused() {} };

function Harness({ initial }: { initial: ChatHistoryPage | null }) {
  const chat = useChat({ kitchenId: "k1", getVersion: () => 1, callbacks, initialHistory: initial });
  const scroller = useRef<HTMLDivElement>(null);
  return (
    <AnnouncerProvider>
      <div ref={scroller} data-testid="scroller">
        <MessageList
          chat={chat.state}
          onRetry={chat.retry}
          onUndo={(id) => void chat.undo(id)}
          onView={() => {}}
          onLoadOlder={chat.loadOlder}
          onRetryHistory={() => void chat.loadLatest()}
          scrollRef={scroller}
          welcome={<p>Welcome</p>}
        />
      </div>
      <button type="button" onClick={() => chat.send("I bought milk")}>
        test-send
      </button>
    </AnnouncerProvider>
  );
}

/** jsdom has no layout: fake a scroller whose height grows by 100 px per message. */
function fakeLayout() {
  const el = screen.getByTestId("scroller");
  let top = 0;
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => el.querySelectorAll("[data-message]").length * 100 });
  Object.defineProperty(el, "scrollTop", { configurable: true, get: () => top, set: (v: number) => (top = v) });
  return el;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const log = () => screen.getByRole("log", { name: "Conversation" });

describe("saved chat", () => {
  it("renders the saved page with its receipts; Undo only where it's still undoable", () => {
    renderWithIntl(
      <Harness
        initial={{
          messages: [
            ...turn("t1", "I bought eggs", "Added eggs.", receipt("cs-1", "eggs", false)),
            ...turn("t2", "I bought spinach", "Added spinach.", receipt("cs-2", "spinach", true)),
          ],
          nextCursor: null,
        }}
      />,
    );
    expect(within(log()).getByText("I bought eggs")).toBeInTheDocument();
    const receipts = within(log()).getAllByRole("region", { name: "What changed" });
    expect(receipts).toHaveLength(2);
    expect(within(receipts[0]).queryByRole("button", { name: /^Undo/ })).not.toBeInTheDocument();
    expect(within(receipts[1]).getByRole("button", { name: "Undo: Added spinach" })).toBeInTheDocument();
    // The latest reply is what the phone's Peek shows, just like a live one.
    expect(log().querySelector(`[data-message="${replyId("t2")}"]`)).toHaveAttribute("data-peek", "true");
    expect(log().querySelector(`[data-message="${replyId("t1")}"]`)).toHaveAttribute("data-peek", "false");
    expect(screen.queryByText("Welcome")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show earlier messages" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a saved receipt that was undone shows as Undone (struck through, no Undo, no View), like a live Undo", () => {
    renderWithIntl(
      <Harness
        initial={{
          messages: [
            ...turn("t1", "I froze the chicken thighs", "Moved the chicken thighs to the freezer.", receipt("cs-1", "chicken thighs", false, true)),
            ...turn("t2", "I bought spinach", "Added spinach.", receipt("cs-2", "spinach", true)),
          ],
          nextCursor: null,
        }}
      />,
    );
    const [undone, live] = within(log()).getAllByRole("region", { name: "What changed" });
    expect(undone).toHaveTextContent("Undone");
    expect(within(undone).getByText("Added chicken thighs").closest("li")).toHaveClass("line-through");
    expect(within(undone).queryByRole("button")).not.toBeInTheDocument();
    expect(live).not.toHaveTextContent("Undone");
    expect(within(live).getByText("Added spinach").closest("li")).not.toHaveClass("line-through");
  });

  it("no saved chat → the welcome; the server's read failed → loading, then error with Try again", async () => {
    renderWithIntl(<Harness initial={{ messages: [], nextCursor: null }} />);
    expect(screen.getByText("Welcome")).toBeInTheDocument();
    cleanup();

    fetchMock.mockResolvedValueOnce(json({ error: "x" }, 500));
    renderWithIntl(<Harness initial={null} />);
    expect(screen.getByText("Loading your messages…")).toBeInTheDocument();
    expect(await screen.findByText("I couldn't load your earlier messages.")).toBeInTheDocument();
    expect(screen.queryByText("Welcome")).not.toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(json({ messages: turn("t1", "I bought eggs", "Added eggs."), nextCursor: null }));
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await within(log()).findByText("Added eggs.")).toBeInTheDocument();
    expect(screen.queryByText("I couldn't load your earlier messages.")).not.toBeInTheDocument();
  });

  it("a saved message that fails the contract is dropped, not the page", async () => {
    fetchMock.mockResolvedValueOnce(json({ messages: [{ id: "bad" }, ...turn("t1", "I bought eggs", "Added eggs.")], nextCursor: null }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithIntl(<Harness initial={null} />);
    expect(await within(log()).findByText("Added eggs.")).toBeInTheDocument();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("Show earlier messages: loads the next page above, keeps your place and focus, then moves focus when nothing's older", async () => {
    renderWithIntl(<Harness initial={{ messages: turn("t3", "I froze the chicken", "Moved it."), nextCursor: "30" }} />);
    const scroller = fakeLayout();
    scroller.scrollTop = 150; // 50 px from the bottom of 2 messages (200 px)

    fetchMock.mockResolvedValueOnce(json({ messages: turn("t2", "I bought spinach", "Added spinach."), nextCursor: "20" }));
    const earlier = screen.getByRole("button", { name: "Show earlier messages" });
    await userEvent.click(earlier);
    expect(await within(log()).findByText("I bought spinach")).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).toContain("before=30");

    // Older messages go above; what you were reading stays put (still 50 px from the bottom).
    const texts = [...log().querySelectorAll("[data-message]")].map((el) => el.textContent);
    expect(texts[0]).toContain("I bought spinach");
    expect(texts.at(-1)).toContain("Moved it.");
    expect(scroller.scrollTop).toBe(400 - 50);
    expect(earlier).toHaveFocus();
    await waitFor(() => expect(screen.getByTestId("announcer")).toHaveTextContent("2 earlier messages shown."));

    // The last page: the button goes, focus moves to the oldest message instead of the page.
    fetchMock.mockResolvedValueOnce(json({ messages: turn("t1", "I bought eggs", "Added eggs."), nextCursor: null }));
    await userEvent.click(earlier);
    expect(await within(log()).findByText("I bought eggs")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show earlier messages" })).not.toBeInTheDocument();
    expect(log().querySelector("[data-message]")).toHaveFocus();
    expect(log().querySelector("[data-message]")).toHaveTextContent("I bought eggs");
    expect(scroller.scrollTop).toBe(600 - 50);
    await waitFor(() => expect(screen.getByTestId("announcer")).toHaveTextContent("That's the start of your chat."));
  });

  it("an older page that fails says so and keeps the button for another try", async () => {
    renderWithIntl(<Harness initial={{ messages: turn("t3", "I froze the chicken", "Moved it."), nextCursor: "30" }} />);
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await userEvent.click(screen.getByRole("button", { name: "Show earlier messages" }));
    expect(await screen.findByText("Couldn't load earlier messages. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show earlier messages" })).toBeEnabled();
    vi.mocked(console.error).mockRestore();
  });

  it("a live turn appends below the saved chat, and doesn't send `history` any more", async () => {
    renderWithIntl(<Harness initial={{ messages: turn("t1", "I bought eggs", "Added eggs."), nextCursor: null }} />);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "test-send" }));
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/chat");
    expect(JSON.parse(String(init.body))).not.toHaveProperty("history");
    const texts = [...log().querySelectorAll("[data-message]")].map((el) => el.textContent);
    expect(texts.at(-1)).toContain("I bought milk");
  });
});

describe("chat reducer: saved pages", () => {
  const saved = turn("t1", "I bought eggs", "Added eggs.", receipt("cs-1", "eggs", true));

  it("a turn already on screen (sent live) isn't added again from a saved page", () => {
    let s = chatReducer(initialChatState, { type: "send", id: "t1", text: "I bought eggs" });
    s = chatReducer(s, { type: "ack", id: "t1" });
    s = chatReducer(s, { type: "done", id: "t1" });
    s = chatReducer(s, { type: "historyLoaded", which: "latest", messages: [...turn("t0", "Hi", "Hello."), ...saved], nextCursor: null });
    expect(s.messages.map((x) => x.id)).toEqual(["t0", replyId("t0"), "t1", replyId("t1")]);
  });

  it("saved receipts get the live receipt's shape, so Undo works the same", () => {
    const s = chatReducer(initialChatState, { type: "historyLoaded", which: "latest", messages: saved, nextCursor: "5" });
    expect(s.messages[1]).toMatchObject({ kind: "assistant", replyTo: "t1", status: "done", receipt: { changeSetId: "cs-1", undoable: true, undo: "idle" } });
    expect(s.history).toEqual({ status: "ready", nextCursor: "5", older: "idle" });
    const undone = chatReducer(s, { type: "undoDone", changeSetId: "cs-1" });
    expect(undone.messages[1]).toMatchObject({ receipt: { undo: "done" } });
  });

  it("a saved receipt that was undone since loads as undo: done", () => {
    const s = chatReducer(initialChatState, { type: "historyLoaded", which: "latest", messages: turn("t1", "x", "y.", receipt("cs-1", "eggs", false, true)), nextCursor: null });
    expect(s.messages[1]).toMatchObject({ receipt: { changeSetId: "cs-1", undoable: false, undo: "done" } });
  });

  it("a saved receipt keeps its batch-choice answers (re-run step 28)", () => {
    const batchAnswers = [{ itemId: "eggs", newBatchId: "b2", choice: "gone" as const, changeSetId: "cs-gone", applied: [], undoable: true }];
    const s = chatReducer(initialChatState, {
      type: "historyLoaded",
      which: "latest",
      messages: turn("t1", "x", "y.", { ...receipt("cs-1", "eggs", true), batchAnswers }),
      nextCursor: null,
    });
    expect(s.messages[1]).toMatchObject({ receipt: { changeSetId: "cs-1", batchAnswers } });
  });
});
