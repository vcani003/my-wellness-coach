// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnnouncerProvider, useAnnounce } from "@/ui/a11y/Announcer";

function Speaker({ onReady }: { onReady: (say: (text: string) => void) => void }) {
  onReady(useAnnounce());
  return null;
}

describe("AnnouncerProvider", () => {
  afterEach(() => vi.useRealTimers());

  it("announces after a short pause", () => {
    vi.useFakeTimers();
    let say: (text: string) => void = () => {};
    const { getByTestId } = render(
      <AnnouncerProvider>
        <Speaker onReady={(s) => (say = s)} />
      </AnnouncerProvider>,
    );
    act(() => say("Added eggs."));
    act(() => vi.advanceTimersByTime(60));
    expect(getByTestId("announcer").textContent).toBe("Added eggs.");
  });

  it("cancels a pending announcement when it unmounts (no update after teardown)", () => {
    vi.useFakeTimers();
    let say: (text: string) => void = () => {};
    const { unmount } = render(
      <AnnouncerProvider>
        <Speaker onReady={(s) => (say = s)} />
      </AnnouncerProvider>,
    );
    act(() => say("Added eggs."));
    unmount();
    // Regression: the 50 ms timer used to survive unmount and call setState with no window.
    expect(vi.getTimerCount()).toBe(0);
  });
});
