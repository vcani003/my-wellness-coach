// @vitest-environment jsdom
/**
 * Never crash (0018) in the Kitchen OS shell: each place and each Today card has its own error
 * boundary. One failing shows "Couldn't load this · Retry" in its own spot only; Today's greeting
 * and the other parts keep working. (Replaces the retired workspace's widget-frame test.)
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Place, PlaceRetryProvider } from "@/ui/places/Place";
import { PlaceMemoryProvider, usePlaceMemory } from "@/ui/places/PlaceMemory";
import { KitchenActionsProvider } from "@/ui/sync/KitchenActionsContext";
import { KitchenDataProvider } from "@/ui/sync/KitchenDataContext";
import { fakeActions } from "../support/fake-actions";
import { renderWithIntl } from "../support/intl";
import { kitchen, VERO } from "../support/kitchen-rows";

let kitchenTodayThrows = true;
vi.mock("@/ui/widgets/kitchen/KitchenToday", () => ({
  KitchenToday: () => {
    if (kitchenTodayThrows) throw new Error("render failed");
    return <p>{"kitchen card back"}</p>;
  },
}));

afterEach(cleanup);
const NOW = new Date("2026-10-17T09:00:00.000Z");

function show(id: string, onRetry = vi.fn()) {
  renderWithIntl(
    <PlaceRetryProvider value={onRetry}>
      <KitchenActionsProvider value={fakeActions()}>
        <KitchenDataProvider
          value={{ me: VERO, snapshot: { state: kitchen([]), status: "ok", syncedAt: NOW.getTime() }, marks: {}, remoteIds: new Set(), now: NOW }}
        >
          <Place id={id} />
        </KitchenDataProvider>
      </KitchenActionsProvider>
    </PlaceRetryProvider>,
  );
  return onRetry;
}

describe("a place's frame", () => {
  it("is a region named for the place", () => {
    show("plan");
    expect(screen.getByRole("region", { name: "Meal plan" })).toBeInTheDocument();
  });

  it("a broken Today card fails alone; the greeting stays; Retry refreshes and recovers it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    kitchenTodayThrows = true;
    const onRetry = show("today");
    expect(screen.getByRole("heading", { name: "Good morning, Vero!" })).toBeInTheDocument();
    expect(screen.getByText("Couldn't load this.")).toBeInTheDocument();
    kitchenTodayThrows = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
    expect(screen.getByText("kitchen card back")).toBeInTheDocument();
    error.mockRestore();
  });

  it("an unknown place renders nothing rather than throwing", () => {
    show("fitness");
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});

function Counter() {
  const [n, setN] = usePlaceMemory("test.count", 0);
  return (
    <button type="button" onClick={() => setN((x) => x + 1)}>
      {`count ${n}`}
    </button>
  );
}

describe("place memory (an Undo line survives visiting another place)", () => {
  it("keeps a place's value when it unmounts and comes back, under the shell's provider", async () => {
    const view = renderWithIntl(
      <PlaceMemoryProvider>
        <Counter />
      </PlaceMemoryProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "count 0" }));
    view.rerender(<PlaceMemoryProvider>{null}</PlaceMemoryProvider>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    view.rerender(
      <PlaceMemoryProvider>
        <Counter />
      </PlaceMemoryProvider>,
    );
    expect(screen.getByRole("button", { name: "count 1" })).toBeInTheDocument();
  });

  it("without the provider it's plain useState (starts over)", async () => {
    const view = renderWithIntl(<Counter />);
    await userEvent.click(screen.getByRole("button", { name: "count 0" }));
    view.unmount();
    renderWithIntl(<Counter />);
    expect(screen.getByRole("button", { name: "count 0" })).toBeInTheDocument();
  });
});
