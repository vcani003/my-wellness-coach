// @vitest-environment jsdom
/**
 * To review in the Kitchen widget (ux.md §3, 0013) and "Do later" on the Done-shopping sheet
 * (ux.md §5, §10): the shopping list's card reopens "Add to your kitchen?" with its items chosen;
 * Add runs Done shopping for them and closes the card; Skip closes it; Do later and Esc save the
 * chosen items for later from Done shopping.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KitchenState, ReviewRow, ShoppingItemRow } from "@/contracts/kitchen-state";
import { AnnouncerProvider } from "@/ui/a11y/Announcer";
import { KitchenActionsProvider, type KitchenActions } from "@/ui/sync/KitchenActionsContext";
import { KitchenDataProvider } from "@/ui/sync/KitchenDataContext";
import { KitchenToday } from "@/ui/widgets/kitchen/KitchenToday";
import { KitchenWidget } from "@/ui/widgets/kitchen/KitchenWidget";
import { DoneShoppingSheet } from "@/ui/widgets/shopping/DoneShoppingSheet";
import { fakeActions, saved } from "../support/fake-actions";
import { renderWithIntl } from "../support/intl";
import { kitchen, said, T0, VERO } from "../support/kitchen-rows";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
const NOW = new Date("2026-10-17T12:00:00.000Z");
const audit = { createdAt: T0, createdBy: VERO, updatedAt: T0, updatedBy: VERO };

const listItem = (id: string, name: string, ticked = false): ShoppingItemRow => ({
  id,
  name: said(name),
  standardName: name,
  source: "chat",
  ...(ticked ? { ticked: { by: VERO, at: T0 } } : {}),
  ...audit,
});
const shoppingCard = (ids: [string, string][]): ReviewRow => ({
  id: "r1",
  kind: "add-to-kitchen",
  origin: "shopping-list",
  items: ids.map(([shoppingItemId, name]) => ({ name, shoppingItemId })),
  status: "pending",
  ...audit,
});

function stateWith(extra: Partial<KitchenState>): KitchenState {
  return { ...kitchen([]), ...extra };
}

function show(state: KitchenState, actions: KitchenActions) {
  renderWithIntl(
    <AnnouncerProvider>
      <KitchenActionsProvider value={actions}>
        <KitchenDataProvider value={{ me: VERO, snapshot: { state, status: "ok", syncedAt: NOW.getTime() }, marks: {}, remoteIds: new Set(), now: NOW }}>
          <KitchenWidget onRetry={() => {}} />
        </KitchenDataProvider>
      </KitchenActionsProvider>
    </AnnouncerProvider>,
  );
}

const QUEUED = stateWith({
  shoppingList: [listItem("garlic", "garlic", true), listItem("shallot", "shallot"), listItem("oatmilk", "oatmilk")],
  toReview: [shoppingCard([["garlic", "garlic"], ["shallot", "shallot"]])],
});

describe("To review in the Kitchen widget", () => {
  it("lists the shopping-list card at the top with a count; a meal's card by name", () => {
    const mealCard: ReviewRow = { ...shoppingCard([]), id: "r2", kind: "after-cooking", origin: "meal", meal: { id: "m1", title: "Beef pho" } };
    show({ ...QUEUED, toReview: [...QUEUED.toReview, mealCard] }, fakeActions());
    const section = screen.getByRole("region", { name: "To review" });
    expect(within(section).getByRole("heading")).toHaveTextContent("To review · 2");
    expect(within(section).getByRole("button", { name: "2 items to add · Shopping list" })).toHaveAttribute("aria-haspopup", "dialog");
    expect(within(section).getByText("Update your kitchen · Beef pho")).toBeInTheDocument();
    // To review comes before the items.
    expect(screen.getAllByRole("heading", { level: 3 })[0]).toHaveTextContent("To review");
  });

  it("Today shows the same To review card, with its count", () => {
    renderWithIntl(
      <AnnouncerProvider>
        <KitchenActionsProvider value={fakeActions()}>
          <KitchenDataProvider value={{ me: VERO, snapshot: { state: QUEUED, status: "ok", syncedAt: NOW.getTime() }, marks: {}, remoteIds: new Set(), now: NOW }}>
            <KitchenToday />
          </KitchenDataProvider>
        </KitchenActionsProvider>
      </AnnouncerProvider>,
    );
    const review = screen.getByRole("region", { name: "To review" });
    expect(review).toHaveTextContent("To review · 1");
    expect(within(review).getByRole("button", { name: /Shopping list/ })).toBeInTheDocument();
  });

  it("no card, no section", () => {
    show(stateWith({}), fakeActions());
    expect(screen.queryByRole("region", { name: "To review" })).not.toBeInTheDocument();
  });

  it("tapping the card reopens the sheet with its items chosen; Add ticks what wasn't, then resolves the card with them", async () => {
    const after = stateWith({ shoppingList: [listItem("oatmilk", "oatmilk")] });
    const actions = fakeActions({
      tickShopping: vi.fn(async (id: string) =>
        saved({ ...QUEUED, shoppingList: QUEUED.shoppingList.map((i) => (i.id === id ? listItem(i.id, i.name.value, true) : i)) }),
      ),
      resolveReview: vi.fn(async () => saved(after, "SHOPPING_DONE")),
    });
    show(QUEUED, actions);
    await userEvent.click(screen.getByRole("button", { name: "2 items to add · Shopping list" }));
    const sheet = screen.getByRole("dialog", { name: "Add to your kitchen?" });
    expect(within(sheet).getByRole("checkbox", { name: "Garlic" })).toBeChecked();
    expect(within(sheet).getByRole("checkbox", { name: "Shallot" })).toBeChecked(); // not ticked, but queued
    expect(within(sheet).queryByRole("checkbox", { name: "Oatmilk" })).not.toBeInTheDocument();

    await userEvent.click(within(sheet).getByRole("button", { name: "Add 2 items" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(actions.tickShopping).toHaveBeenCalledExactlyOnceWith("shallot", true);
    expect(actions.resolveReview).toHaveBeenCalledWith("r1", "done", ["garlic", "shallot"]);
    expect(actions.showOwn).toHaveBeenLastCalledWith(expect.objectContaining({ state: after }), { highlight: true });
    // The same words also reach the live region 50 ms later; check the visible notice only.
    expect(
      screen.getByText("Added 2 to your kitchen. 1 thing is still on your list.", { ignore: '[data-testid="announcer"], script, style' }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo: added garlic and shallot to your kitchen" })).toBeInTheDocument();
  });

  it("Add that fails keeps the sheet open with a plain error and nothing resolved", async () => {
    const actions = fakeActions({ tickShopping: vi.fn(async () => saved(QUEUED)) }); // the tick doesn't stick
    show(QUEUED, actions);
    await userEvent.click(screen.getByRole("button", { name: "2 items to add · Shopping list" }));
    await userEvent.click(screen.getByRole("button", { name: "Add 2 items" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't add those to your kitchen, so nothing changed.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(actions.resolveReview).not.toHaveBeenCalled();
  });

  it("Skip closes the card and says so; Do later just closes the sheet", async () => {
    const actions = fakeActions({ resolveReview: vi.fn(async () => saved(stateWith({ shoppingList: QUEUED.shoppingList }), "REVIEW_RESOLVED")) });
    show(QUEUED, actions);
    // Each step waits for the state it needs (no fixed sleeps), so it holds under full-suite load.
    const open = async () => {
      await userEvent.click(await screen.findByRole("button", { name: "2 items to add · Shopping list" }));
      return screen.findByRole("dialog", { name: "Add to your kitchen?" });
    };

    let sheet = await open();
    await userEvent.click(within(sheet).getByRole("button", { name: "Do later" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(actions.resolveReview).not.toHaveBeenCalled();
    expect(actions.queueShoppingForLater).not.toHaveBeenCalled();

    sheet = await open();
    await userEvent.click(within(sheet).getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(actions.resolveReview).toHaveBeenCalledExactlyOnceWith("r1", "skipped");
    // Scoped to the visible notice: the same words reach the live region 50 ms later, and under
    // load that second copy used to make an unscoped getByText find two matches (the flake).
    expect(
      await screen.findByText("Skipped. Your list is as it was.", { ignore: '[data-testid="announcer"], script, style' }),
    ).toBeInTheDocument();
  });
});

describe("Done shopping sheet: Do later", () => {
  const items = [
    { id: "garlic", name: "Garlic", ticked: true },
    { id: "shallot", name: "Shallot", ticked: false },
  ];
  function sheet(onLater: (ids: string[]) => Promise<boolean>) {
    const onClose = vi.fn();
    renderWithIntl(<DoneShoppingSheet open items={items} onClose={onClose} onAdd={async () => true} onLater={onLater} />);
    return onClose;
  }

  it("saves the chosen items for later, then closes", async () => {
    const onLater = vi.fn(async () => true);
    const onClose = sheet(onLater);
    await userEvent.click(screen.getByRole("checkbox", { name: "Shallot" }));
    await userEvent.click(screen.getByRole("button", { name: "Do later" }));
    expect(onLater).toHaveBeenCalledExactlyOnceWith(["garlic", "shallot"]);
    expect(onClose).toHaveBeenCalled();
  });

  it("Esc counts as Do later, so nothing is lost (ux.md §5)", async () => {
    const onLater = vi.fn(async () => true);
    const onClose = sheet(onLater);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(onLater).toHaveBeenCalledExactlyOnceWith(["garlic"]));
    expect(onClose).toHaveBeenCalled();
  });

  it("with nothing chosen it only closes; a failure keeps the sheet open and says so", async () => {
    const onLater = vi.fn(async () => false);
    const onClose = sheet(onLater);
    await userEvent.click(screen.getByRole("button", { name: "Do later" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save that for later, so nothing changed. Try again.");
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Unselect all" }));
    await userEvent.click(screen.getByRole("button", { name: "Do later" }));
    expect(onLater).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });
});
