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

export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const inset = keyboardInset(window.innerHeight, vv);
        root.style.setProperty("--keyboard-inset", `${inset}px`);
        // The Kitchen OS dock steps aside while the keyboard is up (globals.css).
        if (inset > 0) root.dataset.keyboard = "open";
        else delete root.dataset.keyboard;
      });
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.style.setProperty("--keyboard-inset", "0px");
      delete root.dataset.keyboard;
    };
  }, []);
}
