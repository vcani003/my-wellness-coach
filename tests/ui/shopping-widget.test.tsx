// @vitest-environment jsdom
/**
 * The Shopping list widget after Done shopping (ux.md §10): when nothing is left, "Your list is
 * clear" is said once (in the notice with Undo), not again by the empty state underneath it.
 * Regression: tester run 2026-10-14 saw it twice.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KitchenState, ShoppingItemRow } from "@/contracts/kitchen-state";
import { AnnouncerProvider } from "@/ui/a11y/Announcer";
import { KitchenActionsProvider, type KitchenActions } from "@/ui/sync/KitchenActionsContext";
import { KitchenDataProvider } from "@/ui/sync/KitchenDataContext";
import { ShoppingWidget } from "@/ui/widgets/shopping/ShoppingWidget";
import { fakeActions, saved } from "../support/fake-actions";
import { renderWithIntl } from "../support/intl";
import { kitchen, said, T0, VERO } from "../support/kitchen-rows";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
const NOW = new Date("2026-10-14T12:00:00.000Z");
const audit = { createdAt: T0, createdBy: VERO, updatedAt: T0, updatedBy: VERO };
const listItem = (id: string, name: string): ShoppingItemRow => ({
  id,
  name: said(name),
  standardName: name,
  source: "chat",
  ticked: { by: VERO, at: T0 },
  ...audit,
});
const withList = (shoppingList: ShoppingItemRow[]): KitchenState => ({ ...kitchen([]), kitchenId: "k-shop-widget", shoppingList });

function Harness({ initial, actions }: { initial: KitchenState; actions: Partial<KitchenActions> }) {
  const [state, setState] = useState(initial);
  const value = { ...fakeActions({ ...actions, showOwn: (r) => setState(r.state) }), kitchenId: "k-shop-widget" };
  return (
    <AnnouncerProvider>
      <KitchenActionsProvider value={value}>
        <KitchenDataProvider value={{ me: VERO, snapshot: { state, status: "ok", syncedAt: NOW.getTime() }, marks: {}, remoteIds: new Set(), now: NOW, turn: 1 }}>
          <div data-testid="widget">
            <ShoppingWidget onRetry={() => {}} />
          </div>
        </KitchenDataProvider>
      </KitchenActionsProvider>
    </AnnouncerProvider>
  );
}

describe("Shopping list after Done shopping", () => {
  it("says 'Your list is clear' once when nothing is left", async () => {
    const finishShopping = vi.fn(async () => saved(withList([]), "SHOPPING_DONE"));
    renderWithIntl(<Harness initial={withList([listItem("garlic", "garlic"), listItem("ginger", "ginger")])} actions={{ finishShopping }} />);

    await userEvent.click(screen.getByRole("button", { name: "Done shopping" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add 2 items" }));
    const widget = screen.getByTestId("widget");
    await waitFor(() => expect(widget).toHaveTextContent("Added 2 to your kitchen. Your list is clear."));
    expect(within(widget).getAllByText(/Your list is clear/)).toHaveLength(1);
    expect(within(widget).getByRole("button", { name: /^Undo: added garlic and ginger/ })).toBeInTheDocument();
  });

  it("an empty list with no notice still shows the empty state", () => {
    renderWithIntl(<Harness initial={withList([])} actions={{}} />);
    expect(screen.getByText("Your list is clear. Tell me what you need.")).toBeInTheDocument();
  });
});
