// @vitest-environment jsdom
/**
 * Phone chat fixes from the 2026-10-17 preview (0059):
 * - PF7: tapping Send keeps focus (and the phone keyboard) in the message box, and the layout
 *   doesn't drop out from under a finger when the keyboard closes mid-tap.
 * - PF3: chat starts Minimized on phone, open on desktop.
 * - PF6: "Stand-in AI · not Claude" shows only when the stand-in answers.
 */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectInterpreterKind } from "@/ai";
import { Composer } from "@/ui/chat/Composer";
import { isStandIn, StandInBadge } from "@/ui/chat/StandInBadge";
import { launchDock } from "@/ui/shell/dock-state";
import { Header } from "@/ui/shell/Header";
import { HOLD_AFTER_TAP_MS, shouldHoldClose, useKeyboardInset } from "@/ui/shell/viewport";
import { renderWithIntl } from "../support/intl";

afterEach(cleanup);

describe("PF7: Send keeps the keyboard up", () => {
  it("pressing Send doesn't take focus from the message box, and the message is sent", async () => {
    const onSend = vi.fn(() => true);
    renderWithIntl(<Composer busy={false} onSend={onSend} />);
    const box = screen.getByRole("textbox", { name: "Message Lumi" });
    await userEvent.type(box, "I bought eggs");
    expect(box).toHaveFocus();
    const send = screen.getByRole("button", { name: "Send" });
    // A tap's mousedown would move focus to the button (and close the phone keyboard).
    expect(fireEvent.mouseDown(send)).toBe(false); // default prevented
    expect(box).toHaveFocus();
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledWith("I bought eggs");
    expect(box).toHaveValue("");
    expect(box).toHaveFocus();
  });

  it("Send is still a real button for keyboards and screen readers", async () => {
    const onSend = vi.fn(() => true);
    renderWithIntl(<Composer busy={false} onSend={onSend} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Message Lumi" }), "hi");
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Send" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledWith("hi");
  });

  it("when the message box isn't focused, Send's mousedown is left alone", () => {
    renderWithIntl(<Composer busy={false} onSend={() => true} />);
    expect(fireEvent.mouseDown(screen.getByRole("button", { name: "Send" }))).toBe(true);
  });

  it("only a keyboard CLOSE waits, and only while a finger is down or just lifted", () => {
    expect(shouldHoldClose(true, 0, true, 1000, 0)).toBe(true);
    expect(shouldHoldClose(true, 0, false, 1000, 1200)).toBe(true);
    expect(shouldHoldClose(true, 0, false, 1300, 1200)).toBe(false);
    expect(shouldHoldClose(false, 300, true, 1000, 0)).toBe(false); // opening never waits
    expect(shouldHoldClose(true, 280, true, 1000, 0)).toBe(false); // still open: just follow it
  });

  describe("useKeyboardInset", () => {
    let vv: EventTarget & { height: number; offsetTop: number; scale: number };
    const root = () => document.documentElement;
    const resize = (height: number) => {
      vv.height = height;
      act(() => {
        vv.dispatchEvent(new Event("resize"));
      });
    };
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });
      vi.stubGlobal("cancelAnimationFrame", () => {});
      vv = Object.assign(new EventTarget(), { height: window.innerHeight, offsetTop: 0, scale: 1 });
      Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
    });

    it("keeps the keyboard-open layout through a tap, then lets it go", () => {
      renderHook(() => useKeyboardInset());
      resize(window.innerHeight - 300);
      expect(root().dataset.keyboard).toBe("open");
      expect(root().style.getPropertyValue("--keyboard-inset")).toBe("300px");

      fireEvent.pointerDown(window);
      resize(window.innerHeight); // the keyboard closes mid-tap
      expect(root().dataset.keyboard).toBe("open");
      expect(root().style.getPropertyValue("--keyboard-inset")).toBe("300px");
      fireEvent.pointerUp(window);
      act(() => {
        vi.advanceTimersByTime(HOLD_AFTER_TAP_MS - 50);
      });
      expect(root().dataset.keyboard).toBe("open"); // the click lands on an unmoved Send
      act(() => {
        vi.advanceTimersByTime(HOLD_AFTER_TAP_MS + 50);
      });
      expect(root().dataset.keyboard).toBeUndefined();
      expect(root().style.getPropertyValue("--keyboard-inset")).toBe("0px");
    });

    it("without a tap, a closing keyboard is followed at once", () => {
      renderHook(() => useKeyboardInset());
      resize(window.innerHeight - 300);
      resize(window.innerHeight);
      expect(root().dataset.keyboard).toBeUndefined();
    });
  });
});

describe("PF3: chat at launch", () => {
  it("is Minimized on phone and open (Peek) on desktop", () => {
    expect(launchDock(false)).toBe("minimized");
    expect(launchDock(true)).toBe("peek");
  });
});

describe("PF6: the stand-in AI says so", () => {
  it("is shown only when the stand-in interpreter is answering", () => {
    expect(isStandIn(selectInterpreterKind({ NODE_ENV: "development" }))).toBe(true);
    expect(isStandIn(selectInterpreterKind({ NODE_ENV: "production", AI_MODE: "fake" }))).toBe(true);
    expect(isStandIn(selectInterpreterKind({ AI_MODE: "real", ANTHROPIC_API_KEY: "k" }))).toBe(false);
    expect(isStandIn(selectInterpreterKind({ AI_MODE: "real" }))).toBe(false);
    expect(isStandIn(selectInterpreterKind({ NODE_ENV: "production" }))).toBe(false);
  });

  it("the label reads as a fact, with an explanation for screen readers", () => {
    renderWithIntl(<StandInBadge />);
    const label = screen.getByText(/Stand-in AI · not Claude/);
    expect(label).toHaveTextContent("Stand-in AI · not Claude. Replies are canned, for testing.");
  });

  const header = (standInAI?: boolean) =>
    renderWithIntl(
      <Header
        title="Today"
        me={{ id: "u1", name: "Ana" }}
        members={[]}
        devActingAs={false}
        sync="ok"
        settingsOpen={false}
        standInAI={standInAI}
      />,
    );

  it("the header carries it (for when chat is minimized) only for the stand-in", () => {
    header(true);
    expect(screen.getByText(/Stand-in AI/)).toBeInTheDocument();
    cleanup();
    header(false);
    expect(screen.queryByText(/Stand-in AI/)).toBeNull();
  });
});
