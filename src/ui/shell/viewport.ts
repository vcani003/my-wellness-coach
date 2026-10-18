"use client";
/**
 * iPhone keyboard handling, isolated so it can be swapped (frontend.md §5, top risk).
 *
 * Android honours `interactive-widget=resizes-content` (layout.tsx), so the page itself shrinks
 * above the keyboard. iOS Safari doesn't (through 26.x), so we read `visualViewport` and publish
 * the keyboard's height as `--keyboard-inset`; the docked chat sits that far above the bottom.
 * Fallback if this misbehaves on a real iPhone: open Full chat while typing (frontend.md risks).
 */
import { useEffect } from "react";

/** Below this, a difference is browser chrome (toolbars), not a keyboard. */
const MIN_KEYBOARD_PX = 120;

export function keyboardInset(layoutHeight: number, vv: { height: number; offsetTop: number; scale: number }): number {
  if (vv.scale > 1.01) return 0; // pinch-zoomed: not a keyboard
  const inset = Math.round(layoutHeight - vv.height - vv.offsetTop);
  return inset >= MIN_KEYBOARD_PX ? inset : 0;
}

/**
 * How long after a finger lifts the layout keeps its keyboard-open shape (0059 PF7). Tapping Send
 * (or anything in the chat) can close the keyboard; if the chat dropped ~300 px and the dock
 * reappeared at that moment, the tap's click would land on whatever moved under the finger.
 */
export const HOLD_AFTER_TAP_MS = 350;

/**
 * Whether a keyboard-closed reading should wait: only a CLOSE is held, and only while a finger is
 * down or just lifted. Opening is never delayed, so the message box is never covered.
 */
export function shouldHoldClose(open: boolean, nextInset: number, pointerDown: boolean, now: number, holdUntil: number): boolean {
  return open && nextInset === 0 && (pointerDown || now < holdUntil);
}

export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pointerDown = false;
    let holdUntil = 0;
    const apply = () => {
      const inset = keyboardInset(window.innerHeight, vv);
      const open = root.dataset.keyboard === "open";
      const now = performance.now();
      if (shouldHoldClose(open, inset, pointerDown, now, holdUntil)) {
        // Mid-tap: keep the layout still; look again once the tap is over.
        clearTimeout(timer);
        timer = setTimeout(update, pointerDown ? HOLD_AFTER_TAP_MS : holdUntil - now);
        return;
      }
      root.style.setProperty("--keyboard-inset", `${inset}px`);
      // The Kitchen OS dock steps aside while the keyboard is up (globals.css).
      if (inset > 0) root.dataset.keyboard = "open";
      else delete root.dataset.keyboard;
    };
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    };
    const down = () => {
      pointerDown = true;
    };
    const up = () => {
      pointerDown = false;
      holdUntil = performance.now() + HOLD_AFTER_TAP_MS;
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      root.style.setProperty("--keyboard-inset", "0px");
      delete root.dataset.keyboard;
    };
  }, []);
}
