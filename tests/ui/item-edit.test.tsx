// @vitest-environment jsdom
/**
 * Tap an item to edit it (0045 KOS3; 0057, 0036, 0055 KOS4-e): one entry point per row, the edit
 * sheet's fields (Name, Amount, Where, Type, Staple), Save as one `editItem` call, batches, the one
 * Remove confirm, the receipt with Undo under the row, and the states (saving, failed, stale, gone,
 * offline). The level control is covered in stock-levels.test.tsx.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/app/actions";
import type { ApplyResult } from "@/contracts/apply-result";
import type { BatchRow, ItemRow, KitchenState } from "@/contracts/kitchen-state";
import { AnnouncerProvider } from "@/ui/a11y/Announcer";
import type { SyncSnapshot } from "@/ui/sync/kitchen-sync";
import { KitchenActionsProvider, type KitchenActions } from "@/ui/sync/KitchenActionsContext";
import { KitchenDataProvider } from "@/ui/sync/KitchenDataContext";
import { ALL_BATCHES, baselineFor, editPayload, EMPTY_DRAFT, ghostOf, outcomeOf, validate } from "@/ui/widgets/kitchen/item-edit-model";
import { KitchenWidget } from "@/ui/widgets/kitchen/KitchenWidget";
import { fakeActions } from "../support/fake-actions";
import { renderWithIntl } from "../support/intl";
import { item, kitchen, LEVI, said, T0, VERO } from "../support/kitchen-rows";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const NOW = new Date("2026-10-17T12:00:00.000Z");
const OCT2 = "2026-10-02T10:00:00.000Z";

const fishSauce = (extra: Partial<ItemRow> = {}) =>
  item("fs", "fish sauce", { location: said("pantry" as const), category: said("sauces_condiments" as const), quantity: said({ asSaid: "1 bottle" }), ...extra });
const batch = (id: string, extra: Partial<BatchRow> = {}): BatchRow => ({ id, addedAt: T0, createdAt: T0, createdBy: VERO, updatedAt: T0, updatedBy: VERO, ...extra });
const m = (code: string, params: Record<string, string | number> = {}) => ({ code, params, text: code });

/** The backend's answer: the new state and the given receipt lines. */
function applied(state: KitchenState, lines: { code: string; params?: Record<string, string | number> }[], id = "fs"): ApplyResult {
  return {
    changeSetId: `cs-${lines.map((l) => l.code).join("-")}`,
    newVersion: state.version,
    undoable: true,
    applied: lines.map((l, i) => ({ opId: `op${i}`, summary: m(l.code, l.params ?? {}), refs: [{ kind: "item", id, change: "updated" }] })),
    rejected: [],
    state,
  };
}
function rejected(state: KitchenState, code: string): ApplyResult {
  return { changeSetId: "cs-x", newVersion: state.version, undoable: false, applied: [], rejected: [{ opId: "op", reason: m(code) }], state };
}
const ok = (result: ApplyResult): ActionResult => ({ ok: true, result });

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
const show = (initial: KitchenState, actions: Partial<KitchenActions> = {}, status?: SyncSnapshot["status"]) =>
  renderWithIntl(<Harness initial={initial} actions={actions} status={status} />);

const row = (id = "fs") => document.querySelector<HTMLElement>(`[data-entity-id="${id}"]`)!;
const editButton = (name = "fish sauce") => screen.getByRole("button", { name: `Edit ${name}` });
async function open(name = "fish sauce") {
  await userEvent.click(editButton(name));
  return screen.findByRole("dialog", { name: `Edit ${name}` });
}
const field = (sheet: HTMLElement, label: string | RegExp) => within(sheet).getByRole("textbox", { name: label });
const save = (sheet: HTMLElement) => within(sheet).getByRole("button", { name: "Save" });

describe("One way in", () => {
  it("each row's name is one button, 'Edit fish sauce', described by its details; no ⋯ menu any more", () => {
    show(kitchen([fishSauce()]));
    const button = editButton();
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).toHaveAccessibleDescription(/1 bottle/);
    expect(button).toHaveAccessibleDescription(/added 3 days ago/);
    expect(within(row()).getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^More for/ })).toBeNull();
  });

  it("opens from the keyboard with focus in Name; Esc closes and focus goes back to the row", async () => {
    show(kitchen([fishSauce()]));
    editButton().focus();
    await userEvent.keyboard("{Enter}");
    const sheet = await screen.findByRole("dialog", { name: "Edit fish sauce" });
    await waitFor(() => expect(field(sheet, "Name")).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(editButton()).toHaveFocus());
  });
});

describe("The sheet's fields", () => {
  it("starts from the item: name, amount as said, the current place and type marked 'now', the Staple switch", async () => {
    show(kitchen([fishSauce({ stapleId: "fish sauce" })]));
    const sheet = await open();
    expect(field(sheet, "Name")).toHaveValue("fish sauce");
    expect(field(sheet, "Amount (optional)")).toHaveValue("1 bottle");
    expect(field(sheet, "Amount (optional)")).toHaveAccessibleDescription("Leave it empty if you're not sure.");
    const where = within(sheet).getByRole("radiogroup", { name: "Where is it?" });
    const places = within(where).getAllByRole("radio");
    ["Fridge", "Freezer", "Pantry, now", "Counter"].forEach((name, i) => expect(places[i]).toHaveAccessibleName(name));
    expect(within(where).getByRole("radio", { name: "Pantry, now" })).toBeChecked();
    const type = within(sheet).getByRole("radiogroup", { name: "What kind of thing is it?" });
    expect(within(type).getAllByRole("radio")).toHaveLength(12);
    expect(within(type).getByRole("radio", { name: "Sauces & condiments, now" })).toBeChecked();
    expect(within(sheet).getByRole("switch", { name: "Staple" })).toBeChecked();
    expect(save(sheet)).toBeDisabled();
  });

  it("Save is off until something differs, and off again when it's changed back", async () => {
    show(kitchen([fishSauce()]));
    const sheet = await open();
    const name = field(sheet, "Name");
    await userEvent.type(name, "!");
    expect(save(sheet)).toBeEnabled();
    expect(within(sheet).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    await userEvent.type(name, "{Backspace}");
    expect(save(sheet)).toBeDisabled();
    expect(within(sheet).getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("saves name, amount, place and type in ONE editItem call (only what changed), based on the version it opened at", async () => {
    const initial = kitchen([fishSauce()], 7);
    const after = kitchen([fishSauce({ name: said("nước mắm"), quantity: said({ asSaid: "half a bottle" }), location: said("counter" as const), category: said("other" as const) })], 8);
    const editItem = vi.fn(async () =>
      ok(
        applied(after, [
          { code: "ITEM_RENAMED", params: { from: "fish sauce", name: "nước mắm" } },
          { code: "ITEM_UPDATED", params: { name: "nước mắm" } },
          { code: "ITEM_MOVED", params: { name: "nước mắm", location: "counter" } },
          { code: "ITEM_CATEGORY", params: { name: "nước mắm", category: "other", categoryName: "Other" } },
        ]),
      ),
    );
    show(initial, { editItem });
    const sheet = await open();
    await userEvent.clear(field(sheet, "Name"));
    await userEvent.type(field(sheet, "Name"), "nước mắm");
    await userEvent.clear(field(sheet, "Amount (optional)"));
    await userEvent.type(field(sheet, "Amount (optional)"), "half a bottle");
    await userEvent.click(within(sheet).getByRole("radio", { name: "Counter" }));
    await userEvent.click(within(sheet).getByRole("radio", { name: "Other" }));
    await userEvent.click(save(sheet));

    expect(editItem).toHaveBeenCalledTimes(1);
    expect(editItem).toHaveBeenCalledWith("fs", { name: "nước mắm", amount: "half a bottle", place: "counter", category: "other" }, { basedOnVersion: 7 });
    // One receipt, one Undo, under the row (not in chat), focus on Undo, announced.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const receipt = within(row()).getByRole("region", { name: "What changed" });
    expect(within(receipt).getAllByRole("listitem")).toHaveLength(4);
    expect(receipt).toHaveTextContent("Renamed fish sauce → nước mắm");
    const undo = within(receipt).getByRole("button", { name: /^Undo: / });
    await waitFor(() => expect(undo).toHaveFocus());
    expect(within(receipt).getAllByRole("button", { name: /^Undo/ })).toHaveLength(1);
    await waitFor(() => expect(screen.getByTestId("announcer")).toHaveTextContent(/^Done\. Renamed fish sauce to nước mắm/));
    // The row moved to the new Counter group, with its apricot tile.
    const counter = screen.getByRole("region", { name: "Counter" });
    expect(within(counter).getByText("Nước mắm")).toBeInTheDocument();
    expect(counter.querySelector('.place-tile[data-place="counter"]')).not.toBeNull();
  });

  it("an emptied amount is sent as null (unknown, no made-up default); Enter in a field saves", async () => {
    const editItem = vi.fn(async () => ok(applied(kitchen([fishSauce({ quantity: undefined })], 2), [{ code: "ITEM_UPDATED", params: { name: "fish sauce" } }])));
    show(kitchen([fishSauce()]), { editItem });
    const sheet = await open();
    await userEvent.clear(field(sheet, "Amount (optional)"));
    await userEvent.type(field(sheet, "Amount (optional)"), "{Enter}");
    expect(editItem).toHaveBeenCalledWith("fs", { amount: null }, { basedOnVersion: 1 });
  });

  it("an empty name says 'Give it a name.' under the field on Save, focused, and nothing is sent", async () => {
    const editItem = vi.fn();
    show(kitchen([fishSauce()]), { editItem });
    const sheet = await open();
    await userEvent.clear(field(sheet, "Name"));
    expect(within(sheet).queryByText("Give it a name.")).toBeNull(); // not while typing
    await userEvent.click(save(sheet));
    expect(within(sheet).getByText("Give it a name.")).toBeInTheDocument();
    expect(field(sheet, "Name")).toHaveAccessibleDescription("Give it a name.");
    expect(field(sheet, "Name")).toHaveAttribute("aria-invalid", "true");
    expect(field(sheet, "Name")).toHaveFocus();
    expect(editItem).not.toHaveBeenCalled();
  });

  it("too long a name or amount is caught on Save", async () => {
    const editItem = vi.fn();
    show(kitchen([fishSauce()]), { editItem });
    const sheet = await open();
    await userEvent.type(field(sheet, "Name"), "x".repeat(60));
    await userEvent.click(save(sheet));
    expect(within(sheet).getByText("That name's a bit long. Keep it under 60 characters.")).toBeInTheDocument();
    await userEvent.clear(field(sheet, "Name"));
    await userEvent.type(field(sheet, "Name"), "fish sauce");
    await userEvent.type(field(sheet, "Amount (optional)"), "y".repeat(40));
    await userEvent.click(save(sheet));
    expect(within(sheet).getByText("Keep the amount under 40 characters.")).toBeInTheDocument();
    expect(field(sheet, "Amount (optional)")).toHaveFocus();
    expect(editItem).not.toHaveBeenCalled();
  });

  it("the Staple switch acts at once: setItemStaple, its receipt in the sheet, the switch follows", async () => {
    const initial = kitchen([fishSauce()], 3);
    const setItemStaple = vi.fn(async () => ok(applied(kitchen([fishSauce({ stapleId: "fish sauce" })], 4), [{ code: "STAPLE_ADDED", params: { name: "fish sauce" } }])));
    show(initial, { setItemStaple });
    const sheet = await open();
    const staple = within(sheet).getByRole("switch", { name: "Staple" });
    expect(staple).not.toBeChecked();
    expect(staple).toHaveAccessibleDescription("Staples show up in Restock staples on your list.");
    await userEvent.click(staple);
    expect(setItemStaple).toHaveBeenCalledWith("fs", true, { basedOnVersion: 3 });
    await waitFor(() => expect(staple).toBeChecked());
    expect(within(sheet).getByRole("region", { name: "What changed" })).toHaveTextContent("Fish sauce is one of your staples now");
    expect(staple).toHaveFocus();
  });

  it("a change made in the sheet moves its version on, so your own Save isn't refused as stale", async () => {
    const setItemStaple = vi.fn(async () => ok(applied(kitchen([fishSauce({ stapleId: "fish sauce" })], 4), [{ code: "STAPLE_ADDED", params: { name: "fish sauce" } }])));
    const editItem = vi.fn(async () => ok(applied(kitchen([fishSauce({ stapleId: "fish sauce", name: said("fish sauce!") })], 5), [{ code: "ITEM_RENAMED", params: { from: "fish sauce", name: "fish sauce!" } }])));
    show(kitchen([fishSauce()], 3), { setItemStaple, editItem });
    const sheet = await open();
    await userEvent.click(within(sheet).getByRole("switch", { name: "Staple" }));
    await waitFor(() => expect(within(sheet).getByRole("switch", { name: "Staple" })).toBeChecked());
    await userEvent.type(field(sheet, "Name"), "!");
    await userEvent.click(save(sheet));
    expect(editItem).toHaveBeenCalledWith("fs", { name: "fish sauce!" }, { basedOnVersion: 4 });
  });
});

describe("A level picked next to a typed amount (Vero's iPhone: \"it doesn't allow me to save\")", () => {
  const low = () => fishSauce({ stock: said("low" as const) });
  const levelSaved = (version: number) => ok(applied(kitchen([low()], version), [{ code: "ITEM_LOW", params: { name: "fish sauce" } }]));
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  };

  it("Save tapped while Running low is still saving waits for it, then saves the typed amount on the version it moved to", async () => {
    const level = deferred<ActionResult>();
    const setStockLevel = vi.fn(() => level.promise);
    const editItem = vi.fn(async () => ok(applied(kitchen([low()], 5), [{ code: "ITEM_UPDATED", params: { name: "fish sauce" } }])));
    show(kitchen([fishSauce()], 3), { setStockLevel, editItem });
    const sheet = await open();
    await userEvent.clear(field(sheet, "Amount (optional)"));
    await userEvent.type(field(sheet, "Amount (optional)"), "half a bottle");
    await userEvent.click(within(sheet).getByRole("button", { name: "Running low" }));
    expect(setStockLevel).toHaveBeenCalledWith("fs", "low", undefined, 3);
    expect(sheet.querySelector("[data-level-status]")).toHaveTextContent("Saving…");
    // Save is still Save, and the tap isn't lost.
    expect(save(sheet)).toBeEnabled();
    expect(save(sheet)).not.toHaveAttribute("aria-disabled");
    await userEvent.click(save(sheet));
    expect(editItem).not.toHaveBeenCalled();
    level.resolve(levelSaved(4));
    await waitFor(() => expect(editItem).toHaveBeenCalledWith("fs", { amount: "half a bottle" }, { basedOnVersion: 4 }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("with nothing typed, Running low says 'Saved' by the question and Done is the one button (no greyed-out Save)", async () => {
    const setStockLevel = vi.fn(async () => levelSaved(4));
    show(kitchen([fishSauce()], 3), { setStockLevel });
    const sheet = await open();
    expect(save(sheet)).toBeDisabled();
    await userEvent.click(within(sheet).getByRole("button", { name: "Running low" }));
    await waitFor(() => expect(sheet.querySelector("[data-level-status]")).toHaveTextContent("Saved"));
    expect(within(sheet).getByRole("button", { name: "Running low" })).toHaveAttribute("aria-pressed", "true");
    expect(field(sheet, "Amount (optional)")).toHaveValue("1 bottle");
    expect(within(sheet).queryByRole("button", { name: "Save" })).toBeNull();
    // Typing something brings Save back; the level stays saved.
    await userEvent.type(field(sheet, "Name"), "!");
    expect(save(sheet)).toBeEnabled();
    expect(within(sheet).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    await userEvent.clear(field(sheet, "Name"));
    await userEvent.type(field(sheet, "Name"), "fish sauce");
    await userEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("if that level change fails, the waiting Save sends nothing, says so, and keeps the typing", async () => {
    const level = deferred<ActionResult>();
    const setStockLevel = vi.fn(() => level.promise);
    const editItem = vi.fn();
    show(kitchen([fishSauce()], 3), { setStockLevel, editItem });
    const sheet = await open();
    await userEvent.clear(field(sheet, "Amount (optional)"));
    await userEvent.type(field(sheet, "Amount (optional)"), "half a bottle");
    await userEvent.click(within(sheet).getByRole("button", { name: "Running low" }));
    await userEvent.click(save(sheet));
    level.resolve({ ok: false, reason: m("SAVE_FAILED"), retryable: true });
    await waitFor(() => expect(within(sheet).getByRole("alert")).toHaveTextContent("I couldn't save that, so nothing changed."));
    expect(editItem).not.toHaveBeenCalled();
    expect(field(sheet, "Amount (optional)")).toHaveValue("half a bottle");
    expect(sheet.querySelector("[data-level-status]")).toBeNull();
    expect(save(sheet)).toBeEnabled();
  });
});

describe("Several batches (KOS4-e, 0036)", () => {
  const twoBatches = () =>
    kitchen([
      fishSauce({
        quantity: undefined,
        batches: [
          batch("b1", { addedAt: OCT2, location: said("pantry" as const), quantity: said({ asSaid: "1 bottle" }) }),
          batch("b2", { createdBy: LEVI, location: said("fridge" as const), quantity: said({ asSaid: "a small one" }) }),
        ],
      }),
    ]);

  it("with All batches, the amount is the oldest batch's (IA4) and no batch is sent", async () => {
    const editItem = vi.fn(async () => ok(applied(twoBatches(), [{ code: "ITEM_UPDATED", params: { name: "fish sauce" } }])));
    show(twoBatches(), { editItem });
    const sheet = await open();
    expect(within(sheet).getByRole("radio", { name: "All 2 batches" })).toBeChecked();
    const amount = field(sheet, "Amount of the oldest batch (optional)");
    expect(amount).toHaveValue("1 bottle");
    await userEvent.clear(amount);
    await userEvent.type(amount, "2 bottles");
    await userEvent.click(save(sheet));
    expect(editItem).toHaveBeenCalledWith("fs", { amount: "2 bottles" }, { basedOnVersion: 1 });
  });

  it("picking a batch shows its amount and place, and Save sends that batch", async () => {
    const editItem = vi.fn(async () => ok(applied(twoBatches(), [{ code: "ITEM_MOVED", params: { name: "fish sauce", location: "pantry" } }])));
    show(twoBatches(), { editItem });
    const sheet = await open();
    await userEvent.click(within(sheet).getByRole("radio", { name: /^Added Oct 14/ }));
    expect(field(sheet, "Amount (optional)")).toHaveValue("a small one");
    expect(within(sheet).getByRole("radio", { name: "Fridge, now" })).toBeChecked();
    await userEvent.click(within(sheet).getByRole("radio", { name: "Pantry" }));
    await userEvent.click(save(sheet));
    expect(editItem).toHaveBeenCalledWith("fs", { place: "pantry" }, { basedOnVersion: 1, batchId: "b2" });
  });
});

describe("Remove (asks once)", () => {
  it("asks 'Remove fish sauce? It'll stay in history.' with focus on Cancel; Cancel goes back to the sheet", async () => {
    const removeItem = vi.fn();
    show(kitchen([fishSauce()]), { removeItem });
    const sheet = await open();
    await userEvent.click(within(sheet).getByRole("button", { name: "Remove (added by mistake)" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Remove fish sauce?" });
    expect(confirm).toHaveAccessibleDescription("It'll stay in history.");
    await waitFor(() => expect(within(confirm).getByRole("button", { name: "Cancel" })).toHaveFocus());
    await userEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("dialog", { name: "Edit fish sauce" })).toBeInTheDocument();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it("Remove → the row stays, faded, 'Removed', with the receipt and focus on Undo; Undo brings it back", async () => {
    const initial = kitchen([fishSauce()]);
    const gone = { ...applied(kitchen([], 2), [{ code: "ITEM_REMOVED", params: { name: "fish sauce" } }]) };
    gone.applied[0].refs = [{ kind: "item", id: "fs", change: "removed" }];
    const removeItem = vi.fn(async () => ok(gone));
    const undo = vi.fn(async () => ok(applied(kitchen([fishSauce()], 3), [{ code: "UNDONE" }])));
    show(initial, { removeItem, undo });
    const sheet = await open();
    await userEvent.click(within(sheet).getByRole("button", { name: "Remove (added by mistake)" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove" }));
    expect(removeItem).toHaveBeenCalledWith("fs", { basedOnVersion: 1 });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(row()).toHaveAttribute("data-change", "gone");
    expect(within(row()).getByText("Removed")).toBeInTheDocument();
    expect(within(row()).queryByRole("button", { name: "Edit fish sauce" })).toBeNull();
    const undoButton = within(row()).getByRole("button", { name: "Undo: Removed fish sauce" });
    await waitFor(() => expect(undoButton).toHaveFocus());

    await userEvent.click(undoButton);
    expect(undo).toHaveBeenCalledWith("cs-ITEM_REMOVED");
    await waitFor(() => expect(row()).not.toHaveAttribute("data-change", "gone"));
    expect(editButton()).toBeInTheDocument();
    expect(within(row()).getByText("Undone")).toBeInTheDocument();
  });
});

describe("States", () => {
  it("saving: 'Saving…' on that row only (and on Save); other rows still read normally", async () => {
    let finish: (r: ActionResult) => void = () => {};
    const editItem = vi.fn(() => new Promise<ActionResult>((resolve) => (finish = resolve)));
    const salt = item("salt", "salt", { location: said("pantry" as const) });
    show(kitchen([fishSauce(), salt]), { editItem });
    const sheet = await open();
    await userEvent.type(field(sheet, "Name"), "!");
    await userEvent.click(save(sheet));
    expect(within(sheet).getByRole("button", { name: "Saving…" })).toHaveAttribute("aria-disabled", "true");
    expect(row().querySelector("[data-row-saving]")).toHaveTextContent("Saving…");
    expect(row("salt").querySelector("[data-row-saving]")).toBeNull();
    finish(ok(applied(kitchen([fishSauce({ name: said("fish sauce!") }), salt], 2), [{ code: "ITEM_RENAMED", params: { from: "fish sauce", name: "fish sauce!" } }])));
    await waitFor(() => expect(row().querySelector("[data-row-saving]")).toBeNull());
  });

  it("failed: the sheet stays open with what was typed and says nothing changed; Save tries again", async () => {
    const editItem = vi
      .fn<KitchenActions["editItem"]>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(ok(applied(kitchen([fishSauce({ name: said("nam pla") })], 2), [{ code: "ITEM_RENAMED", params: { from: "fish sauce", name: "nam pla" } }])));
    show(kitchen([fishSauce()]), { editItem });
    const sheet = await open();
    await userEvent.clear(field(sheet, "Name"));
    await userEvent.type(field(sheet, "Name"), "nam pla");
    await userEvent.click(save(sheet));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("I couldn't save that, so nothing changed.");
    expect(field(sheet, "Name")).toHaveValue("nam pla");
    expect(row()).toHaveTextContent("Fish sauce");
    await userEvent.click(save(sheet));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(editItem).toHaveBeenCalledTimes(2);
  });

  it("a refused answer (ok: false) is a failure too, and the sheet keeps the typing", async () => {
    show(kitchen([fishSauce()]), { editItem: async () => ({ ok: false, reason: m("SAVE_FAILED"), retryable: true }) });
    const sheet = await open();
    await userEvent.type(field(sheet, "Name"), "!");
    await userEvent.click(save(sheet));
    expect(await within(sheet).findByRole("alert")).toBeInTheDocument();
    expect(field(sheet, "Name")).toHaveValue("fish sauce!");
  });

  it("stale: Levi changed it since the sheet opened → nothing saved, the sheet closes, the row shows the latest and says who", async () => {
    const latest = kitchen([fishSauce({ quantity: said({ asSaid: "2 bottles" }), updatedBy: LEVI, updatedAt: NOW.toISOString() })], 5);
    show(kitchen([fishSauce()]), { editItem: async () => ok(rejected(latest, "STALE_TARGET")) });
    const sheet = await open();
    await userEvent.type(field(sheet, "Name"), "!");
    await userEvent.click(save(sheet));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const note = row().querySelector<HTMLElement>("[data-item-note='stale']")!;
    expect(note).toHaveTextContent("Levi just changed fish sauce, so nothing changed. Here's the latest.");
    await waitFor(() => expect(note).toHaveFocus());
    expect(row()).toHaveTextContent("2 bottles");
    expect(row()).toHaveTextContent("Fish sauce");
  });

  it("gone: someone removed it meanwhile → 'Fish sauce isn't in the kitchen any more.' on the faded row", async () => {
    show(kitchen([fishSauce()]), { editItem: async () => ok(rejected(kitchen([], 4), "UNKNOWN_ITEM")) });
    const sheet = await open();
    await userEvent.type(field(sheet, "Name"), "!");
    await userEvent.click(save(sheet));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(row()).toHaveAttribute("data-change", "gone");
    const note = row().querySelector<HTMLElement>("[data-item-note='gone']")!;
    expect(note).toHaveTextContent("Fish sauce isn't in the kitchen any more.");
    await waitFor(() => expect(note).toHaveFocus());
  });

  it("stale on an item that's since been removed reads as gone", async () => {
    show(kitchen([fishSauce()]), { removeItem: async () => ok(rejected(kitchen([], 4), "STALE_TARGET")) });
    const sheet = await open();
    await userEvent.click(within(sheet).getByRole("button", { name: "Remove (added by mistake)" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(row().querySelector("[data-item-note='gone']")).toHaveTextContent("Fish sauce isn't in the kitchen any more."));
  });

  it("ALREADY_OUT reads as gone too", async () => {
    show(kitchen([fishSauce()]), { setItemStaple: async () => ok(rejected(kitchen([], 4), "ALREADY_OUT")) });
    const sheet = await open();
    await userEvent.click(within(sheet).getByRole("switch", { name: "Staple" }));
    await waitFor(() => expect(row().querySelector("[data-item-note='gone']")).toBeInTheDocument());
  });

  it("nothing changed on the server: the sheet just closes, no receipt", async () => {
    const empty: ApplyResult = { changeSetId: "cs-0", newVersion: 1, undoable: false, applied: [], rejected: [], state: kitchen([fishSauce()]) };
    show(kitchen([fishSauce()]), { editItem: async () => ok(empty) });
    const sheet = await open();
    await userEvent.click(within(sheet).getByRole("radio", { name: "Fridge" }));
    await userEvent.click(save(sheet));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("region", { name: "What changed" })).toBeNull();
  });

  it("offline: the sheet opens to read, says why, and every change is off (0044)", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    show(kitchen([fishSauce()]));
    const sheet = await open();
    expect(within(sheet).getByText("You're offline. Changes need a connection.")).toBeInTheDocument();
    expect(field(sheet, "Name")).toBeDisabled();
    expect(within(sheet).getByRole("switch", { name: "Staple" })).toHaveAttribute("aria-disabled", "true");
    expect(within(sheet).getByRole("button", { name: "Remove (added by mistake)" })).toBeDisabled();
    expect(save(sheet)).toBeDisabled();
    await waitFor(() => expect(within(sheet).getByRole("heading", { name: "Edit fish sauce" })).toHaveFocus());
  });
});

describe("Counter (0030 IA1)", () => {
  it("is its own group after Pantry, with its own tile", () => {
    show(kitchen([fishSauce(), item("ban", "bananas", { location: said("counter" as const) }), item("milk", "milk", { location: said("fridge" as const) })]));
    const titles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(["Fridge", "Pantry", "Counter"]);
    const counter = screen.getByRole("region", { name: "Counter" });
    expect(counter.querySelector('[data-place="counter"]')).not.toBeNull();
  });
});

describe("item-edit-model", () => {
  const fs = fishSauce();
  it("editPayload sends only what differs, trimmed; untouched fields follow the baseline", () => {
    const base = baselineFor(fs, ALL_BATCHES);
    expect(editPayload(EMPTY_DRAFT, base)).toEqual({});
    expect(editPayload({ ...EMPTY_DRAFT, name: " fish sauce " }, base)).toEqual({});
    expect(editPayload({ ...EMPTY_DRAFT, name: "nam pla ", amount: "", place: "pantry" }, base)).toEqual({ name: "nam pla", amount: null });
  });
  it("validate: required name, name ≤ 60, amount ≤ 40", () => {
    const base = baselineFor(fs, ALL_BATCHES);
    expect(validate({ ...EMPTY_DRAFT, name: "  " }, base)).toEqual({ field: "name", code: "nameRequired" });
    expect(validate({ ...EMPTY_DRAFT, name: "x".repeat(61) }, base)).toEqual({ field: "name", code: "nameTooLong" });
    expect(validate({ ...EMPTY_DRAFT, amount: "x".repeat(41) }, base)).toEqual({ field: "amount", code: "amountTooLong" });
    expect(validate({ ...EMPTY_DRAFT, name: "x".repeat(60) }, base)).toBeNull();
  });
  it("outcomeOf: saved / stale / gone / nothing", () => {
    const st = kitchen([fs]);
    expect(outcomeOf(applied(st, [{ code: "ITEM_MOVED" }]))).toBe("saved");
    expect(outcomeOf(rejected(st, "STALE_TARGET"))).toBe("stale");
    for (const c of ["UNKNOWN_ITEM", "ALREADY_OUT", "UNKNOWN_TARGET"]) expect(outcomeOf(rejected(st, c))).toBe("gone");
    expect(outcomeOf({ ...applied(st, []), applied: [] })).toBe("nothing");
  });
  it("ghostOf: a removed or Out item stays drawn while its note shows; not once it's back", () => {
    const note = (code: string) => ({ itemId: "fs", before: fs, turn: 0, kind: "receipt" as const, key: "k", receipt: { ...applied(kitchen([]), [{ code }]), undo: "idle" as const } });
    expect(ghostOf(note("ITEM_REMOVED"), kitchen([]))?.kind).toBe("removed");
    expect(ghostOf(note("ITEM_OUT"), kitchen([]))?.kind).toBe("out");
    expect(ghostOf(note("ITEM_OUT"), kitchen([fs]))).toBeNull();
    expect(ghostOf({ itemId: "fs", before: fs, turn: 0, kind: "gone", key: "k" }, kitchen([]))?.kind).toBe("gone");
  });
});
