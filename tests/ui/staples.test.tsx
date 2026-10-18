// @vitest-environment jsdom
/**
 * Smart staples UI (0054, plans/smart-staples.md §2):
 * - Restock: the pill on the List place, the sheet's groups and pre-selection (SS3), Add N with
 *   one receipt and Undo, and every state (empty, all stocked, loading, error, add failed,
 *   offline, someone else's change meanwhile);
 * - Edit staples: add, remove with Undo, usual store (SS5);
 * - "You told me these before… Add them · Not now" (SS2, SS8);
 * - "Add X to my list" on Out/Low receipts, chat included (SS4, KOS4-d), with the staple line;
 * - "Add these to my list" under a staples answer (SS6, SS9).
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/app/actions";
import type { AppliedOp, ApplyResult, ListOffer } from "@/contracts/apply-result";
import type { KitchenState, ShoppingItemRow, StapleNeed, StapleRow } from "@/contracts/kitchen-state";
import { AnnouncerProvider } from "@/ui/a11y/Announcer";
import { chatReducer, fromSaved, initialChatState, toReceipt, type ChatState } from "@/ui/chat/chat-reducer";
import { MessageList } from "@/ui/chat/MessageList";
import { Receipt } from "@/ui/chat/Receipt";
import type { SyncSnapshot } from "@/ui/sync/kitchen-sync";
import { KitchenActionsProvider, type KitchenActions } from "@/ui/sync/KitchenActionsContext";
import { KitchenDataProvider } from "@/ui/sync/KitchenDataContext";
import { ListPlace } from "@/ui/widgets/shopping/ShoppingWidget";
import { groupStaples, statusKey } from "@/ui/widgets/shopping/staples-model";
import { fakeActions } from "../support/fake-actions";
import { renderWithIntl } from "../support/intl";
import { item, kitchen, said, T0 } from "../support/kitchen-rows";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const ANA = { id: "ana", name: "Ana" };
const BEN = { id: "ben", name: "Ben" };
const NOW = new Date("2026-10-17T12:00:00.000Z");
const audit = (by = ANA) => ({ createdAt: T0, createdBy: by, updatedAt: T0, updatedBy: by });

function staple(name: string, need: StapleNeed, extra: Partial<StapleRow> = {}): StapleRow {
  return { id: name, name: said(name), standardName: name, need, ...audit(), ...extra };
}
function listRow(name: string, store?: string): ShoppingItemRow {
  return { id: `s-${name}`, name: said(name), standardName: name, source: "staples", ...(store ? { store: said(store) } : {}), ...audit() };
}
const withStaples = (staples: StapleRow[], extra: Partial<KitchenState> = {}): KitchenState => ({ ...kitchen([]), staples, ...extra });

const PANTRY = [
  staple("fish sauce", "out", { store: said("MD Oriental") }),
  staple("jasmine rice", "low", { itemId: "rice", level: "low" }),
  staple("eggs", "missing"),
  staple("garlic", "have", { itemId: "garlic", level: "some" }),
  staple("shallots", "have", { itemId: "shallots", level: "plenty" }),
  staple("rice noodles", "on-list", { shoppingItemId: "s-rice noodles" }),
];

let n = 0;
function result(state: KitchenState, applied: AppliedOp[], undoable = true): ApplyResult {
  return { changeSetId: `cs-${++n}`, newVersion: state.version + 1, undoable, applied, rejected: [], state: { ...state, version: state.version + 1 } };
}
const op = (code: string, params: Record<string, string>, refs: AppliedOp["refs"] = [{ kind: "shopping", id: `x-${params.name}`, change: "added" }]): AppliedOp => ({
  opId: `op-${params.name}-${++n}`,
  summary: { code, params, text: "" },
  refs,
});
const ok = (r: ApplyResult): ActionResult => ({ ok: true, result: r });
const refused = (): ActionResult => ({ ok: false, reason: { code: "SAVE_FAILED", params: {}, text: "" }, retryable: true });

/** The List place on a live state that `showOwn` updates, like the app; `setState` for someone else's change. */
const live: { set: (s: KitchenState) => void } = { set: () => {} };
function Providers({ initial, actions, status = "ok", children }: { initial: KitchenState | null; actions: Partial<KitchenActions>; status?: SyncSnapshot["status"]; children: ReactNode }) {
  const [state, setState] = useState(initial);
  useEffect(() => {
    live.set = setState;
  }, []);
  const value = fakeActions({ ...actions, showOwn: (r) => setState(r.state) });
  return (
    <AnnouncerProvider>
      <KitchenActionsProvider value={value}>
        <KitchenDataProvider value={{ me: ANA, snapshot: { state, status, syncedAt: NOW.getTime() }, marks: {}, remoteIds: new Set(), now: NOW, turn: 1 }}>
          {children}
        </KitchenDataProvider>
      </KitchenActionsProvider>
    </AnnouncerProvider>
  );
}
function showList(initial: KitchenState | null, actions: Partial<KitchenActions> = {}, status?: SyncSnapshot["status"], onRetry = () => {}) {
  return renderWithIntl(
    <Providers initial={initial} actions={actions} status={status}>
      <ListPlace onRetry={onRetry} />
    </Providers>,
  );
}

const pill = () => screen.getByRole("button", { name: "Restock staples" });
async function openSheet() {
  await userEvent.click(pill());
  return screen.findByRole("dialog", { name: /staples/ });
}
const box = (sheet: HTMLElement, name: string) => within(sheet).getByRole("checkbox", { name: new RegExp(`^${name},`, "i") });

describe("the staples model", () => {
  it("groups Need (out, low, missing) · You have some · On your list, with each status word", () => {
    const g = groupStaples(PANTRY);
    expect(g.need.map((s) => s.id)).toEqual(["fish sauce", "jasmine rice", "eggs"]);
    expect(g.have.map((s) => s.id)).toEqual(["garlic", "shallots"]);
    expect(g.onList.map((s) => s.id)).toEqual(["rice noodles"]);
    expect(PANTRY.map(statusKey)).toEqual(["out", "low", "missing", "some", "plenty", "onList"]);
    expect(statusKey(staple("salt", "have"))).toBe("have");
  });
});

describe("Restock staples", () => {
  it("opens the sheet with Need pre-selected, You have some unselected and On your list muted with no box", async () => {
    showList(withStaples(PANTRY));
    const sheet = await openSheet();
    expect(within(sheet).getByRole("heading", { name: "Restock staples" })).toBeInTheDocument();
    expect(within(sheet).getByText("Pick what to add to your list")).toBeInTheDocument();

    const need = within(sheet).getByRole("group", { name: "Need" });
    expect(within(need).getAllByRole("checkbox").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Fish sauce, out, add to list",
      "Jasmine rice, running low, add to list",
      "Eggs, not in yet, add to list",
    ]);
    for (const b of within(need).getAllByRole("checkbox")) expect(b).toBeChecked();

    const have = within(sheet).getByRole("group", { name: "You have some" });
    expect(within(have).getByRole("checkbox", { name: "Garlic, some left, add to list" })).not.toBeChecked();
    expect(within(have).getByRole("checkbox", { name: "Shallots, plenty, add to list" })).not.toBeChecked();

    const onList = within(sheet).getByRole("region", { name: "On your list" });
    expect(onList).toHaveTextContent("Rice noodles");
    expect(within(onList).queryByRole("checkbox")).not.toBeInTheDocument();

    // Running low uses the stock amber; the others are muted. Never the allergy colour.
    expect(within(sheet).getByText("Running low").className).toMatch(/text-warning-text/);
    expect(within(sheet).getByText("Out").className).toMatch(/text-text-muted/);
    expect(sheet.innerHTML).not.toMatch(/allergy/);
    expect(within(sheet).getByRole("button", { name: "Add 3 to my list" })).toBeEnabled();
  });

  it("Add N makes one change: the sheet closes, the receipt with Undo shows under the pill with focus, Undo takes it all back", async () => {
    const initial = withStaples(PANTRY);
    const after = withStaples(PANTRY.map((s) => (s.id === "garlic" || ["fish sauce", "jasmine rice", "eggs"].includes(s.id) ? { ...s, need: "on-list" as const } : s)));
    const restock = result(after, [
      op("SHOPPING_ADDED_STORE", { name: "fish sauce", store: "MD Oriental" }),
      op("SHOPPING_ADDED", { name: "jasmine rice" }),
      op("SHOPPING_ADDED", { name: "eggs" }),
      op("SHOPPING_ADDED", { name: "garlic" }),
    ]);
    const restockStaples = vi.fn(async () => ok(restock));
    const undo = vi.fn(async () => ok(result(initial, [op("UNDONE", { name: "x" })])));
    showList(initial, { restockStaples, undo });
    const sheet = await openSheet();
    // Tick an extra; untick nothing.
    await userEvent.click(box(sheet, "Garlic"));
    await userEvent.click(within(sheet).getByRole("button", { name: "Add 4 to my list" }));

    expect(restockStaples).toHaveBeenCalledWith(["fish sauce", "jasmine rice", "eggs", "garlic"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const note = document.querySelector<HTMLElement>("[data-restock-note]")!;
    const receipt = within(note).getByRole("region", { name: "What changed" });
    expect(receipt).toHaveTextContent("Added fish sauce to the shopping list (MD Oriental)");
    expect(receipt).toHaveTextContent("On your list, Anywhere: jasmine rice, eggs, garlic");
    await waitFor(() => expect(note).toHaveFocus());

    await userEvent.click(within(receipt).getByRole("button", { name: /^Undo: / }));
    expect(undo).toHaveBeenCalledWith(restock.changeSetId);
    expect(await within(receipt).findByText("Undone")).toBeInTheDocument();
  });

  it("all stocked: says so, hides Need, the button is off until you tick an extra", async () => {
    showList(withStaples([staple("garlic", "have"), staple("rice noodles", "on-list")]));
    const sheet = await openSheet();
    expect(within(sheet).getByText("All your staples are stocked.")).toBeInTheDocument();
    expect(within(sheet).queryByRole("group", { name: "Need" })).not.toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Add to my list" })).toBeDisabled();
    await userEvent.click(box(sheet, "Garlic"));
    expect(within(sheet).getByRole("button", { name: "Add 1 to my list" })).toBeEnabled();
  });

  it("add failed: says nothing changed, keeps the sheet and your choices, and Try again sends them again", async () => {
    const restockStaples = vi.fn(async () => refused());
    showList(withStaples(PANTRY), { restockStaples });
    const sheet = await openSheet();
    await userEvent.click(box(sheet, "Eggs"));
    await userEvent.click(within(sheet).getByRole("button", { name: "Add 2 to my list" }));
    const alert = await within(sheet).findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't add those, so nothing changed.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(box(sheet, "Eggs")).not.toBeChecked();
    expect(box(sheet, "Fish sauce")).toBeChecked();
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(restockStaples).toHaveBeenCalledTimes(2);
    expect(restockStaples).toHaveBeenLastCalledWith(["fish sauce", "jasmine rice"]);
  });

  it("someone else's change meanwhile: a staple they put on the list moves to On your list and isn't sent", async () => {
    const restockStaples = vi.fn(async () => refused());
    showList(withStaples(PANTRY), { restockStaples });
    const sheet = await openSheet();
    expect(within(sheet).getByRole("button", { name: "Add 3 to my list" })).toBeInTheDocument();
    live.set(withStaples(PANTRY.map((s) => (s.id === "eggs" ? { ...s, need: "on-list" as const } : s)), { shoppingList: [listRow("eggs")] }));
    const onList = await within(sheet).findByRole("region", { name: "On your list" });
    await waitFor(() => expect(onList).toHaveTextContent("Eggs"));
    await userEvent.click(within(sheet).getByRole("button", { name: "Add 2 to my list" }));
    expect(restockStaples).toHaveBeenCalledWith(["fish sauce", "jasmine rice"]);
  });

  it("loading: placeholder rows in the sheet; error: 'Couldn't load your staples' with Retry, the List unaffected", async () => {
    showList(null);
    let sheet = await openSheet();
    expect(sheet.querySelectorAll("[data-placeholder]")).toHaveLength(3);
    cleanup();

    const onRetry = vi.fn();
    showList(null, {}, "error", onRetry);
    sheet = await openSheet();
    expect(within(sheet).getByText("Couldn't load your staples.")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
    // The List's own error line is still there, untouched.
    expect(screen.getByText("Couldn't load your list.")).toBeInTheDocument();
  });

  it("offline: the pill is off with 'Back online to restock'", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    showList(withStaples(PANTRY));
    expect(pill()).toBeDisabled();
    expect(pill()).toHaveAccessibleDescription("Back online to restock");
  });

  it("a stale (offline) kitchen turns it off too", () => {
    showList(withStaples(PANTRY), {}, "stale");
    expect(pill()).toBeDisabled();
  });
});

describe("Edit staples", () => {
  it("no staples yet: Lumi, the empty line and the Add field; adding one saves it with a receipt and keeps focus in the field", async () => {
    const addStaples = vi.fn(async () => ok(result(withStaples([staple("fish sauce", "missing")]), [op("STAPLE_ADDED", { name: "fish sauce" }, [{ kind: "staple", id: "fish sauce", change: "added" }])])));
    showList(withStaples([]), { addStaples });
    const sheet = await openSheet();
    expect(within(sheet).getByText("No staples yet. Tell me “fish sauce is a staple”, or add one here.")).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /to my list/ })).not.toBeInTheDocument();

    const field = within(sheet).getByRole("textbox", { name: "Add a staple" });
    await userEvent.type(field, "fish sauce{Enter}");
    expect(addStaples).toHaveBeenCalledWith([{ name: "fish sauce" }]);
    const receipt = await within(sheet).findByRole("region", { name: "What changed" });
    expect(receipt).toHaveTextContent("Fish sauce is one of your staples now");
    expect(within(receipt).getByRole("button", { name: /^Undo: / })).toBeInTheDocument();
    expect(field).toHaveValue("");
    expect(field).toHaveFocus();
    expect(within(sheet).getByRole("list", { name: "Your staples" })).toHaveTextContent("Fish sauce");
  });

  it("shows each staple's store (or Anywhere) and who added it; Remove needs no confirmation and has Undo", async () => {
    const initial = withStaples([staple("fish sauce", "out", { store: said("MD Oriental") }), staple("eggs", "missing", audit(BEN))]);
    const removed = result(withStaples([initial.staples[1]]), [op("STAPLE_REMOVED", { name: "fish sauce" }, [{ kind: "staple", id: "fish sauce", change: "removed" }])]);
    const removeStaple = vi.fn(async () => ok(removed));
    const undo = vi.fn(async () => ok(result(initial, [op("UNDONE", { name: "x" })])));
    showList(initial, { removeStaple, undo });
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole("button", { name: "Edit staples" }));
    await waitFor(() => expect(within(sheet).getByRole("heading", { name: "Edit staples" })).toHaveFocus());

    const list = within(sheet).getByRole("list", { name: "Your staples" });
    const [fish, eggs] = within(list).getAllByRole("listitem");
    expect(fish).toHaveTextContent("MD Oriental");
    expect(eggs).toHaveTextContent("Anywhere");
    expect(eggs).toHaveTextContent("added by Ben");
    expect(fish).not.toHaveTextContent("added by");

    await userEvent.click(within(fish).getByRole("button", { name: "More for fish sauce" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove" }));
    expect(removeStaple).toHaveBeenCalledWith("fish sauce");
    const receipt = await within(sheet).findByRole("region", { name: "What changed" });
    expect(receipt).toHaveTextContent("Fish sauce isn't a staple any more");
    await waitFor(() => expect(sheet.querySelector("[data-staples-change]")).toHaveFocus());
    expect(within(list).queryByText("Fish sauce")).not.toBeInTheDocument();

    await userEvent.click(within(receipt).getByRole("button", { name: "Undo: Fish sauce isn't a staple any more" }));
    expect(undo).toHaveBeenCalledWith(removed.changeSetId);
    await waitFor(() => expect(within(list).getByText("Fish sauce")).toBeInTheDocument());
  });

  it("Store… sets a usual store, and Anywhere clears it (SS5)", async () => {
    const initial = withStaples([staple("fish sauce", "out", { store: said("Publix") })]);
    const updateStaple = vi.fn(async (_id: string, store: string | null) =>
      ok(result(withStaples([staple("fish sauce", "out", store ? { store: said(store) } : {})]), [op(store ? "STAPLE_STORE" : "STAPLE_STORE_CLEARED", { name: "fish sauce", ...(store ? { store } : {}) }, [{ kind: "staple", id: "fish sauce", change: "updated" }])])),
    );
    showList(initial, { updateStaple });
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole("button", { name: "Edit staples" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "More for fish sauce" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Store…" }));
    const field = await within(sheet).findByRole("textbox", { name: "Usual store for fish sauce" });
    await waitFor(() => expect(field).toHaveFocus());
    expect(field).toHaveValue("Publix");
    await userEvent.clear(field);
    await userEvent.type(field, "MD Oriental{Enter}");
    expect(updateStaple).toHaveBeenCalledWith("fish sauce", "MD Oriental");
    expect(await within(sheet).findByRole("region", { name: "What changed" })).toHaveTextContent("Fish sauce: usually from MD Oriental");
    expect(within(sheet).getByRole("list", { name: "Your staples" })).toHaveTextContent("MD Oriental");

    await userEvent.click(within(sheet).getByRole("button", { name: "More for fish sauce" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Store…" }));
    await userEvent.click(await within(sheet).findByRole("button", { name: "Anywhere" }));
    expect(updateStaple).toHaveBeenLastCalledWith("fish sauce", null);
  });

  it("a failed edit says nothing changed, in place", async () => {
    showList(withStaples([staple("fish sauce", "out")]), { removeStaple: vi.fn(async () => refused()) });
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole("button", { name: "Edit staples" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "More for fish sauce" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove" }));
    expect(await within(sheet).findByText("I couldn't save that, so nothing changed. Try again.")).toBeInTheDocument();
    expect(within(sheet).getByRole("list", { name: "Your staples" })).toHaveTextContent("Fish sauce");
  });
});

describe("You told me these before (SS2, SS8)", () => {
  const NAMES = { names: ["fish sauce", "jasmine rice", "rice noodles"] };

  it("Add them saves them as staples with a receipt and Undo, and the offer goes away", async () => {
    const loadStaplesOffer = vi.fn(async () => NAMES);
    const after = withStaples(NAMES.names.map((nm) => staple(nm, "missing")));
    const answerStaplesOffer = vi.fn(async () => ok(result(after, NAMES.names.map((nm) => op("STAPLE_ADDED", { name: nm }, [{ kind: "staple", id: nm, change: "added" }])))));
    showList(withStaples([]), { loadStaplesOffer, answerStaplesOffer });
    const sheet = await openSheet();
    const offer = await within(sheet).findByRole("group", { name: "You told me these before: fish sauce, jasmine rice, and rice noodles." });
    await userEvent.click(within(offer).getByRole("button", { name: "Add them" }));
    expect(answerStaplesOffer).toHaveBeenCalledWith(true);
    const receipt = await within(sheet).findByRole("region", { name: "What changed" });
    expect(receipt).toHaveTextContent("Jasmine rice is one of your staples now");
    expect(within(sheet).queryByRole("group", { name: /You told me these before/ })).not.toBeInTheDocument();
    expect(within(sheet).getByRole("list", { name: "Your staples" })).toHaveTextContent("Rice noodles");
  });

  it("Not now changes nothing and it's not offered again, even on the next open", async () => {
    const loadStaplesOffer = vi.fn(async () => NAMES);
    const answerStaplesOffer = vi.fn(async () => ok(result(withStaples([]), [], false)));
    showList(withStaples([]), { loadStaplesOffer, answerStaplesOffer });
    let sheet = await openSheet();
    await userEvent.click(await within(sheet).findByRole("button", { name: "Not now" }));
    expect(answerStaplesOffer).toHaveBeenCalledWith(false);
    await waitFor(() => expect(within(sheet).queryByRole("group", { name: /You told me these before/ })).not.toBeInTheDocument());
    expect(within(sheet).queryByRole("region", { name: "What changed" })).not.toBeInTheDocument();

    await userEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    sheet = await openSheet();
    expect(within(sheet).queryByRole("group", { name: /You told me these before/ })).not.toBeInTheDocument();
    expect(loadStaplesOffer).toHaveBeenCalledTimes(1);
  });
});

// ─── Receipts: "Add X to my list" (SL3, SS4, KOS4-d) ──────────────────────────────────────────

function lowResult(state: KitchenState, offer: Partial<ListOffer> = {}): ApplyResult {
  return result(state, [
    {
      ...op("ITEM_LOW", { name: "fish sauce" }, [{ kind: "item", id: "fs", change: "updated" }]),
      listOffers: [{ itemId: "fs", name: "fish sauce", standardName: "fish sauce", level: "low", ...offer }],
    },
  ]);
}
const lowKitchen = (extra: Partial<KitchenState> = {}) => ({ ...kitchen([item("fs", "fish sauce", { stock: said("low" as const) })]), ...extra });

function showReceipt(r: ApplyResult, actions: Partial<KitchenActions> = {}, state = r.state) {
  return renderWithIntl(
    <Providers initial={state} actions={actions}>
      <Receipt receipt={toReceipt(r)} onUndo={() => {}} />
    </Providers>,
  );
}

describe("Add X to my list on an Out / Low receipt", () => {
  it("offers it on a chat receipt; the tap adds it (stock-offer) and says it's on your list, with focus there", async () => {
    const r = lowResult(lowKitchen());
    const addToList = vi.fn(async () => ok(result(lowKitchen({ shoppingList: [listRow("fish sauce")] }), [op("SHOPPING_ADDED", { name: "fish sauce" })])));
    showReceipt(r, { addToList });
    await userEvent.click(screen.getByRole("button", { name: "Add fish sauce to my list" }));
    expect(addToList).toHaveBeenCalledWith("stock-offer", [{ name: "fish sauce" }]);
    expect(await screen.findByText("Fish sauce is on your list.")).toHaveFocus();
  });

  it("for a staple: 'Fish sauce is one of your staples · Add to my list', under its usual store", async () => {
    const r = lowResult(lowKitchen(), { stapleId: "fish sauce", store: "MD Oriental" });
    const addToList = vi.fn(async () => refused());
    showReceipt(r, { addToList });
    const line = document.querySelector<HTMLElement>("[data-list-offer]")!;
    expect(line).toHaveTextContent("Fish sauce is one of your staples · Add to my list");
    await userEvent.click(within(line).getByRole("button", { name: "Add fish sauce to my list" }));
    expect(addToList).toHaveBeenCalledWith("stock-offer", [{ name: "fish sauce", store: "MD Oriental" }]);
    expect(await within(line).findByText("I couldn't add that to your list. Try again.")).toBeInTheDocument();
  });

  it("is hidden once it's on the list (anyone), or back in stock", () => {
    const r = lowResult(lowKitchen());
    showReceipt(r, {}, lowKitchen({ shoppingList: [listRow("fish sauce")] }));
    expect(screen.queryByRole("button", { name: /to my list/ })).not.toBeInTheDocument();
    cleanup();
    showReceipt(r, {}, kitchen([item("fs", "fish sauce", { stock: said("plenty" as const) })]));
    expect(screen.queryByRole("button", { name: /to my list/ })).not.toBeInTheDocument();
  });

  it("is off while offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    showReceipt(lowResult(lowKitchen()));
    expect(screen.getByRole("button", { name: "Add fish sauce to my list" })).toBeDisabled();
  });

  it("shows on a chat reply's receipt in the conversation", () => {
    const r = lowResult(lowKitchen());
    let chat: ChatState = chatReducer(initialChatState, { type: "send", id: "m1", text: "fish sauce is running low" });
    chat = chatReducer(chat, { type: "applied", id: "m1", result: r });
    chat = chatReducer(chat, { type: "done", id: "m1" });
    renderWithIntl(
      <Providers initial={r.state} actions={{}}>
        <MessageList chat={chat} onRetry={() => {}} onUndo={() => {}} onLoadOlder={async () => ({ added: 0, more: false })} onRetryHistory={() => {}} scrollRef={{ current: null }} welcome={null} />
      </Providers>,
    );
    expect(screen.getByRole("button", { name: "Add fish sauce to my list" })).toBeInTheDocument();
  });
});

// ─── "Add these to my list" under a staples answer (SS6, SS9) ──────────────────────────────────

describe("Add these to my list under a staples answer", () => {
  const ITEMS = [
    { stapleId: "fish sauce", name: "fish sauce", store: "MD Oriental", need: "out" as const },
    { stapleId: "eggs", name: "eggs", need: "missing" as const },
  ];
  function answered(): ChatState {
    let chat = chatReducer(initialChatState, { type: "send", id: "m1", text: "what staples do I need?" });
    chat = chatReducer(chat, { type: "text", id: "m1", delta: "From your staples, you need: fish sauce (out) and eggs (not in the kitchen)." });
    chat = chatReducer(chat, { type: "staples", id: "m1", items: ITEMS });
    return chatReducer(chat, { type: "done", id: "m1" });
  }
  function showChat(chat: ChatState, state: KitchenState, actions: Partial<KitchenActions> = {}) {
    return renderWithIntl(
      <Providers initial={state} actions={actions}>
        <MessageList chat={chat} onRetry={() => {}} onUndo={() => {}} onLoadOlder={async () => ({ added: 0, more: false })} onRetryHistory={() => {}} scrollRef={{ current: null }} welcome={null} />
      </Providers>,
    );
  }

  it("the stream's staples event puts the items on the reply; saved chat never has them (SS9)", () => {
    const reply = answered().messages.find((m) => m.kind === "assistant");
    expect(reply?.kind === "assistant" && reply.staples).toEqual(ITEMS);
    const saved = fromSaved({ role: "assistant", clientMessageId: "m1", text: "From your staples…", at: T0 } as never);
    expect(saved.kind === "assistant" && saved.staples).toBeFalsy();
  });

  it("one tap restocks those staples, then the receipt with Undo replaces the button", async () => {
    const state = withStaples([staple("fish sauce", "out", { store: said("MD Oriental") }), staple("eggs", "missing")]);
    const restock = result(withStaples(state.staples.map((s) => ({ ...s, need: "on-list" as const }))), [
      op("SHOPPING_ADDED_STORE", { name: "fish sauce", store: "MD Oriental" }),
      op("SHOPPING_ADDED", { name: "eggs" }),
    ]);
    const restockStaples = vi.fn(async () => ok(restock));
    const undo = vi.fn(async () => ok(result(state, [op("UNDONE", { name: "x" })])));
    showChat(answered(), state, { restockStaples, undo });
    await userEvent.click(screen.getByRole("button", { name: "Add these to my list: fish sauce and eggs" }));
    expect(restockStaples).toHaveBeenCalledWith(["fish sauce", "eggs"]);
    const box = document.querySelector<HTMLElement>("[data-staples-answer='added']")!;
    await waitFor(() => expect(box).toHaveFocus());
    const receipt = within(box).getByRole("region", { name: "What changed" });
    expect(receipt).toHaveTextContent("Added fish sauce to the shopping list (MD Oriental)");
    expect(screen.queryByRole("button", { name: /^Add these to my list/ })).not.toBeInTheDocument();
    await userEvent.click(within(receipt).getByRole("button", { name: /^Undo: / }));
    expect(undo).toHaveBeenCalledWith(restock.changeSetId);
  });

  it("leaves out a staple that went on the list since, and goes away when none are left", async () => {
    const restockStaples = vi.fn(async () => refused());
    showChat(answered(), withStaples([staple("fish sauce", "on-list"), staple("eggs", "missing")]), { restockStaples });
    await userEvent.click(screen.getByRole("button", { name: "Add these to my list: eggs" }));
    expect(restockStaples).toHaveBeenCalledWith(["eggs"]);
    expect(await screen.findByText("Couldn't add those, so nothing changed. Try again.")).toBeInTheDocument();
    cleanup();
    showChat(answered(), withStaples([staple("fish sauce", "on-list"), staple("eggs", "on-list")]));
    expect(screen.queryByRole("button", { name: /^Add these to my list/ })).not.toBeInTheDocument();
  });

  it("is off while offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    showChat(answered(), withStaples([staple("eggs", "missing")]));
    expect(screen.getByRole("button", { name: /^Add these to my list/ })).toBeDisabled();
  });
});
