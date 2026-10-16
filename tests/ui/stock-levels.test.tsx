// @vitest-environment jsdom
/**
 * Stock levels on the Kitchen place (0045 KOS4, 0055): the labels (Plenty / Some left / Running
 * low; unknown shows nothing), the row's ⋯ "How much is left?" menu, the "What changed" receipt
 * with Undo under the row, the Out ghost, the Low/Out "Add rice to my list" offer (SL3), failures,
 * and the control being off while offline.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/app/actions";
import type { ApplyResult } from "@/contracts/apply-result";
import type { StockLevel } from "@/contracts/common";
import type { BatchRow, ItemRow, KitchenState, ShoppingItemRow } from "@/contracts/kitchen-state";
import { AnnouncerProvider } from "@/ui/a11y/Announcer";
import type { SyncSnapshot } from "@/ui/sync/kitchen-sync";
import { KitchenActionsProvider, type KitchenActions } from "@/ui/sync/KitchenActionsContext";
import { KitchenDataProvider } from "@/ui/sync/KitchenDataContext";
import { KitchenWidget } from "@/ui/widgets/kitchen/KitchenWidget";
import { fakeActions } from "../support/fake-actions";
import { renderWithIntl } from "../support/intl";
import { item, kitchen, said, T0, VERO } from "../support/kitchen-rows";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const NOW = new Date("2026-10-17T12:00:00.000Z");
const CODE: Record<StockLevel, string> = { plenty: "ITEM_PLENTY", some: "ITEM_SOME", low: "ITEM_LOW", out: "ITEM_OUT" };

const rice = (extra: Partial<ItemRow> = {}) => item("rice", "rice", { location: said("pantry" as const), ...extra });
const listRow = (name: string): ShoppingItemRow => ({
  id: `s-${name}`,
  name: said(name),
  standardName: name,
  source: "chat",
  createdAt: T0,
  createdBy: VERO,
  updatedAt: T0,
  updatedBy: VERO,
});

/** The backend's answer to a level: the new state and one receipt line. */
function levelResult(state: KitchenState, level: StockLevel, id = "rice"): ApplyResult {
  const items =
    level === "out"
      ? state.items.filter((i) => i.id !== id)
      : state.items.map((i) => (i.id === id ? { ...i, stock: said(level as Exclude<StockLevel, "out">) } : i));
  const next = { ...state, version: state.version + 1, items };
  return {
    changeSetId: `cs-${level}`,
    newVersion: next.version,
    undoable: true,
    applied: [
      {
        opId: "op",
        summary: { code: CODE[level], params: { name: id }, text: "" },
        refs: [{ kind: "item", id, change: level === "out" ? "removed" : "updated" }],
        // Low and Out carry the "Add X to my list" offer as data (SL3, 0054 SS4).
        ...(level === "low" || level === "out" ? { listOffers: [{ itemId: id, name: id, standardName: id, level }] } : {}),
      },
    ],
    rejected: [],
    state: next,
  };
}
const ok = (result: ApplyResult): ActionResult => ({ ok: true, result });

/** The Kitchen place on a live state, which the fake actions' `showOwn` updates (like the app). */
function Harness({ initial, actions, status = "ok" }: { initial: KitchenState; actions: Partial<KitchenActions>; status?: SyncSnapshot["status"] }) {
  const [state, setState] = useState(initial);
  const value = fakeActions({ ...actions, showOwn: (r) => setState(r.state) });
  return (
    <AnnouncerProvider>
      <KitchenActionsProvider value={value}>
        <KitchenDataProvider value={{ me: VERO, snapshot: { state, status, syncedAt: NOW.getTime() }, marks: {}, remoteIds: new Set(), now: NOW }}>
          <KitchenWidget onRetry={() => {}} />
        </KitchenDataProvider>
      </KitchenActionsProvider>
    </AnnouncerProvider>
  );
}
function show(initial: KitchenState, actions: Partial<KitchenActions> = {}, status?: SyncSnapshot["status"]) {
  return renderWithIntl(<Harness initial={initial} actions={actions} status={status} />);
}

const row = (id: string) => document.querySelector<HTMLElement>(`[data-entity-id="${id}"]`)!;
const more = (name = "Rice") => screen.getByRole("button", { name: `More for ${name}` });
async function choose(level: string, name = "Rice") {
  await userEvent.click(more(name));
  await userEvent.click(await screen.findByRole("menuitemradio", { name: level }));
}

describe("Stock level labels", () => {
  it("shows Plenty, Some left and Running low with the meter, and nothing when the level is unknown", () => {
    show(
      kitchen([
        item("1", "rice", { stock: said("plenty" as const) }),
        item("2", "oats", { stock: said("some" as const) }),
        item("3", "flour", { stock: said("low" as const) }),
        item("4", "salt"),
      ]),
    );
    expect(within(row("1")).getByText("Plenty")).toHaveAttribute("data-stock", "plenty");
    expect(within(row("2")).getByText("Some left")).toHaveAttribute("data-stock", "some");
    expect(within(row("3")).getByText("Running low")).toHaveAttribute("data-stock", "low");
    expect(row("4").querySelector("[data-stock]")).toBeNull();
    // Words carry the meaning (the meter is hidden), and the allergy colour is never used.
    for (const id of ["1", "2", "3"]) {
      const label = row(id).querySelector("[data-stock]")!;
      expect(label.querySelector(".level-meter")).toHaveAttribute("aria-hidden", "true");
      expect(label.className).not.toMatch(/allergy/);
    }
  });

  it("labels each batch in the batch list", async () => {
    const b = (id: string, stock?: "plenty" | "low"): BatchRow => ({ id, addedAt: T0, createdAt: T0, createdBy: VERO, updatedAt: T0, updatedBy: VERO, ...(stock ? { stock: said(stock) } : {}) });
    show(kitchen([rice({ batches: [b("b1", "low"), b("b2", "plenty")] })]));
    await userEvent.click(screen.getByRole("button", { name: /^Rice/ }));
    const list = screen.getByRole("list", { name: "Rice: batches, oldest first" });
    const [older, newer] = within(list).getAllByRole("listitem");
    expect(within(older).getByText("Running low")).toBeInTheDocument();
    expect(within(newer).getByText("Plenty")).toBeInTheDocument();
  });
});

describe("Setting a level from the row's ⋯ menu", () => {
  it("offers Plenty · Some left · Running low · Out as radio items, the current one checked", async () => {
    show(kitchen([rice({ stock: said("some" as const) })]));
    await userEvent.click(more());
    const group = await screen.findByRole("group", { name: "How much is left?" });
    const items = within(group).getAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent)).toEqual(["Plenty", "Some left", "Running low", "Out"]);
    expect(within(group).getByRole("menuitemradio", { name: "Some left" })).toHaveAttribute("aria-checked", "true");
    expect(within(group).getByRole("menuitemradio", { name: "Plenty" })).toHaveAttribute("aria-checked", "false");
  });

  it("works from the keyboard and sets the whole item: receipt under the row, focus on it, Undo named for the change", async () => {
    const initial = kitchen([rice()]);
    const setStockLevel = vi.fn(async (_id: string, level: StockLevel) => ok(levelResult(initial, level)));
    show(initial, { setStockLevel });
    more().focus();
    await userEvent.keyboard("{Enter}");
    await screen.findByRole("group", { name: "How much is left?" });
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(setStockLevel).toHaveBeenCalledTimes(1));
    // Without a batch: the whole item (0055).
    expect(setStockLevel.mock.calls[0]).toEqual(["rice", expect.any(String)]);
    const receipt = await within(row("rice")).findByRole("region", { name: "What changed" });
    expect(receipt).toHaveTextContent(/Rice: (plenty|some left)/);
    await waitFor(() => expect(row("rice").querySelector("[data-level-note]")).toHaveFocus());
    expect(within(receipt).getByRole("button", { name: /^Undo: Rice: / })).toBeInTheDocument();
  });

  it("Running low shows the label, the receipt and 'Add rice to my list', which adds it once tapped", async () => {
    const initial = kitchen([rice()]);
    const addToList = vi.fn(async () => ok({ ...levelResult(initial, "low"), changeSetId: "cs-list", state: { ...levelResult(initial, "low").state, shoppingList: [listRow("rice")] } }));
    show(initial, { setStockLevel: async (_id, level) => ok(levelResult(initial, level)), addToList });
    await choose("Running low");
    const receipt = await within(row("rice")).findByRole("region", { name: "What changed" });
    expect(receipt).toHaveTextContent("Rice: running low");
    expect(within(row("rice")).getByText("Running low", { selector: "[data-stock]" })).toBeInTheDocument();

    await userEvent.click(within(receipt).getByRole("button", { name: "Add rice to my list" }));
    expect(addToList).toHaveBeenCalledWith("stock-offer", [{ name: "rice" }]);
    expect(await within(receipt).findByText("Rice is on your list.")).toHaveFocus();
    expect(within(receipt).queryByRole("button", { name: "Add rice to my list" })).not.toBeInTheDocument();
  });

  it("Plenty and Some never offer the list; Low doesn't when it's already on the list", async () => {
    const initial = kitchen([rice()]);
    show(initial, { setStockLevel: async (_id, level) => ok(levelResult(initial, level)) });
    await choose("Plenty");
    await within(row("rice")).findByRole("region", { name: "What changed" });
    expect(screen.queryByRole("button", { name: /to my list/ })).not.toBeInTheDocument();
    cleanup();

    const onList = { ...kitchen([rice()]), shoppingList: [listRow("rice")] };
    show(onList, { setStockLevel: async (_id, level) => ok(levelResult(onList, level)) });
    await choose("Running low");
    await within(row("rice")).findByRole("region", { name: "What changed" });
    expect(screen.queryByRole("button", { name: /to my list/ })).not.toBeInTheDocument();
  });

  it("choosing the level it already has changes nothing", async () => {
    const setStockLevel = vi.fn();
    show(kitchen([rice({ stock: said("low" as const) })]), { setStockLevel });
    await choose("Running low");
    expect(setStockLevel).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "What changed" })).not.toBeInTheDocument();
  });

  it("Out keeps the row in place as Out (no menu) with the receipt; Undo brings it back", async () => {
    const initial = kitchen([rice(), item("salt", "salt", { location: said("pantry" as const) })]);
    const out = levelResult(initial, "out");
    const undo = vi.fn(async () => ok({ ...out, changeSetId: "cs-undo", state: { ...initial, version: 3 } }));
    show(initial, { setStockLevel: async () => ok(out), undo });
    await choose("Out");

    const ghost = await waitFor(() => {
      const r = row("rice");
      expect(r).toHaveAttribute("data-change", "gone");
      return r;
    });
    expect(within(ghost).getByText("Out", { selector: "[data-stock]" })).toBeInTheDocument();
    expect(within(ghost).queryByRole("button", { name: "More for Rice" })).not.toBeInTheDocument();
    const receipt = within(ghost).getByRole("region", { name: "What changed" });
    expect(receipt).toHaveTextContent("Rice: out");
    // Out offers the list too (SL3).
    expect(within(receipt).getByRole("button", { name: "Add rice to my list" })).toBeInTheDocument();

    await userEvent.click(within(receipt).getByRole("button", { name: "Undo: Rice: out" }));
    expect(undo).toHaveBeenCalledWith("cs-out");
    await waitFor(() => expect(row("rice")).not.toHaveAttribute("data-change", "gone"));
    expect(within(row("rice")).getByText("Undone")).toBeInTheDocument();
    expect(more()).toBeInTheDocument();
    expect(within(row("rice")).queryByRole("button", { name: "Add rice to my list" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("announcer")).toHaveTextContent("Undone: Rice: out"));
    expect(row("rice").querySelector("[data-level-note]")).toHaveFocus();
  });

  it("a refused Undo says so in place", async () => {
    const initial = kitchen([rice()]);
    show(initial, { setStockLevel: async (_id, level) => ok(levelResult(initial, level)) });
    await choose("Some left");
    const receipt = await within(row("rice")).findByRole("region", { name: "What changed" });
    await userEvent.click(within(receipt).getByRole("button", { name: /^Undo/ }));
    expect(await within(receipt).findByText("Can't undo this now. Tell me what to fix.")).toBeInTheDocument();
  });

  it("a failed save says nothing changed and keeps the row as it was (0018)", async () => {
    show(kitchen([rice()]), { setStockLevel: async () => Promise.reject(new Error("network")) });
    await choose("Running low");
    expect(await screen.findByText("I couldn't save that, so nothing changed. Try again.")).toBeInTheDocument();
    expect(row("rice").querySelector("[data-stock]")).toBeNull();
  });
});

describe("Offline", () => {
  it("turns ⋯ off while the kitchen is stale (offline), with the place's offline line", () => {
    show(kitchen([rice()]), {}, "stale");
    expect(more()).toBeDisabled();
    expect(screen.getByText(/^Offline · showing your kitchen as of/)).toBeInTheDocument();
  });

  it("turns ⋯ off when the phone has no connection", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    show(kitchen([rice()]));
    expect(more()).toBeDisabled();
  });
});
