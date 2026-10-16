// @vitest-environment jsdom
/**
 * "That would remove 7 things: … Remove them all?" in the chat (0045 KOS16): the `confirm` stream
 * event and saved chat put Yes / No under the reply; they show only while that reply is the last
 * message; each sends its words as a chat message (the same path as typing); off while busy or
 * offline (chat is online only, 0044).
 */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatHistoryMessage, ChatHistoryPage } from "@/contracts/chat-history";
import type { BulkConfirm, StreamEvent } from "@/contracts/stream";
import { AnnouncerProvider } from "@/ui/a11y/Announcer";
import { AskLumiProvider } from "@/ui/chat/AskLumi";
import { chatReducer, fromSaved, initialChatState, replyId } from "@/ui/chat/chat-reducer";
import { MessageList } from "@/ui/chat/MessageList";
import { useChat, type TurnCallbacks } from "@/ui/chat/useChat";
import { renderWithIntl } from "../support/intl";

vi.mock("@/app/actions", () => ({ undoChange: vi.fn() }));

const T = "2026-10-16T10:00:00.000Z";
const CONFIRM: BulkConfirm = { kind: "bulk-remove", count: 6, names: ["milk", "eggs", "bread", "rice", "butter", "cheese"] };
const QUESTION = "That would remove 6 things: milk, eggs, bread, rice, butter, and cheese. Remove them all?";
const asked = (id: string, confirm?: BulkConfirm): ChatHistoryMessage[] => [
  { id: `${id}-u`, clientMessageId: id, role: "user", text: "we're out of milk, eggs, bread, rice, butter and cheese", createdAt: T, receipt: null },
  { id: `${id}-a`, clientMessageId: id, role: "assistant", text: QUESTION, createdAt: T, receipt: null, ...(confirm ? { confirm } : {}) },
];

const callbacks: TurnCallbacks = { onApplied() {}, onTurnEnd() {}, onUndone() {}, onUndoRefused() {} };

function Harness({ initial, online = true }: { initial: ChatHistoryPage; online?: boolean }) {
  const chat = useChat({ kitchenId: "k1", getVersion: () => 1, callbacks, initialHistory: initial });
  const scroller = useRef<HTMLDivElement>(null);
  return (
    <AnnouncerProvider>
      <AskLumiProvider value={{ ask: chat.send, canAsk: online && !chat.state.busy }}>
        <div ref={scroller}>
          <MessageList
            chat={chat.state}
            onRetry={chat.retry}
            onUndo={() => {}}
            onLoadOlder={chat.loadOlder}
            onRetryHistory={() => {}}
            scrollRef={scroller}
            welcome={<p>Welcome</p>}
          />
        </div>
        <button type="button" onClick={() => chat.send("we're out of milk, eggs, bread, rice, butter and cheese")}>
          test-send
        </button>
      </AskLumiProvider>
    </AnnouncerProvider>
  );
}

const ndjson = (events: StreamEvent[]) =>
  new Response(events.map((e) => JSON.stringify(e)).join("\n") + "\n", { headers: { "content-type": "application/x-ndjson" } });
const turnStream = (id: string, text: string, extra: StreamEvent[] = []): StreamEvent[] => [
  { type: "ack", turnId: "00000000-0000-4000-8000-000000000001", messageId: id },
  { type: "text", delta: text },
  ...extra,
  { type: "done", turnId: "00000000-0000-4000-8000-000000000001", assistantMessageId: "00000000-0000-4000-8000-000000000002" },
];
const sentText = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body)) as { clientMessageId: string; text: string };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const group = () => screen.queryByRole("group", { name: "Remove 6 things?" });

describe("Yes / No under a held bulk removal", () => {
  it("a live `confirm` event shows the buttons; Yes sends its words like a typed yes, then they go", async () => {
    renderWithIntl(<Harness initial={{ messages: [], nextCursor: null }} />);
    fetchMock.mockImplementationOnce(async (_url, init: RequestInit) => {
      const { clientMessageId } = JSON.parse(String(init.body));
      return ndjson(turnStream(clientMessageId, QUESTION, [{ type: "confirm", ...CONFIRM }]));
    });
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "test-send" }));
    });
    expect(await screen.findByRole("group", { name: "Remove 6 things?" })).toBeInTheDocument();
    expect(screen.getByText(QUESTION)).toBeInTheDocument();

    fetchMock.mockImplementationOnce(async (_url, init: RequestInit) => {
      const { clientMessageId } = JSON.parse(String(init.body));
      return ndjson(turnStream(clientMessageId, "Done: removed them."));
    });
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Yes, remove them" }));
    });
    expect(sentText(fetchMock.mock.calls[1]).text).toBe("Yes, remove them");
    await waitFor(() => expect(group()).not.toBeInTheDocument());
    expect(await screen.findByText("Done: removed them.")).toBeInTheDocument();
  });

  it("No sends \"No, keep them\"", async () => {
    renderWithIntl(<Harness initial={{ messages: asked("t1", CONFIRM), nextCursor: null }} />);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "No, keep them" }));
    });
    expect(sentText(fetchMock.mock.calls[0]).text).toBe("No, keep them");
  });

  it("saved chat brings them back while the question is the last message", () => {
    renderWithIntl(<Harness initial={{ messages: asked("t1", CONFIRM), nextCursor: null }} />);
    expect(group()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes, remove them" })).toBeEnabled();
  });

  it("not once something was said after it, and never without a held change", () => {
    const later: ChatHistoryMessage[] = [
      ...asked("t1", CONFIRM),
      { id: "t2-u", clientMessageId: "t2", role: "user", text: "I bought limes", createdAt: T, receipt: null },
      { id: "t2-a", clientMessageId: "t2", role: "assistant", text: "Added limes.", createdAt: T, receipt: null },
    ];
    renderWithIntl(<Harness initial={{ messages: later, nextCursor: null }} />);
    expect(group()).not.toBeInTheDocument();
    cleanup();
    renderWithIntl(<Harness initial={{ messages: asked("t1"), nextCursor: null }} />);
    expect(group()).not.toBeInTheDocument();
  });

  it("off while offline", () => {
    renderWithIntl(<Harness initial={{ messages: asked("t1", CONFIRM), nextCursor: null }} online={false} />);
    expect(screen.getByRole("button", { name: "Yes, remove them" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "No, keep them" })).toBeDisabled();
  });
});

describe("chat reducer", () => {
  it("keeps a live confirm on the reply, and a saved one through fromSaved", () => {
    let s = chatReducer(initialChatState, { type: "send", id: "t1", text: "clear the list" });
    s = chatReducer(s, { type: "confirm", id: "t1", confirm: CONFIRM });
    expect(s.messages.find((m) => m.id === replyId("t1"))).toMatchObject({ kind: "assistant", confirm: CONFIRM });
    expect(fromSaved(asked("t2", CONFIRM)[1])).toMatchObject({ confirm: CONFIRM });
    expect(fromSaved(asked("t2")[1])).not.toHaveProperty("confirm");
  });
});
