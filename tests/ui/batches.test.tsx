// @vitest-environment jsdom
/**
 * Older and newer batches in the UI (0025): the Kitchen row ("2 batches · oldest 3 days",
 * Defrosted, the batches listed in the item's edit sheet, KOS3) and the receipt's one-tap choice
 * ("You also had eggs from Oct 2: Still have them · Those are gone") with its result and Undo.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/app/actions";
import type { ApplyResult, BatchOffer } from "@/contracts/apply-result";
import type { BatchRow, ItemRow, KitchenState } from "@/contracts/kitchen-state";
import { AnnouncerProvider } from "@/ui/a11y/Announcer";
import type { Receipt as ReceiptModel } from "@/ui/chat/chat-reducer";
import { useFormatMsg } from "@/ui/chat/format-msg";
import { Receipt } from "@/ui/chat/Receipt";
import { KitchenActionsProvider, type KitchenActions } from "@/ui/sync/KitchenActionsContext";
import { KitchenDataProvider } from "@/ui/sync/KitchenDataContext";
import { KitchenWidget } from "@/ui/widgets/kitchen/KitchenWidget";
import { fakeActions } from "../support/fake-actions";
import { item, kitchen, LEVI, said, VERO } from "../support/kitchen-rows";
import { renderWithIntl } from "../support/intl";

afterEach(cleanup);
const NOW = new Date("2026-10-14T12:00:00.000Z");
const OCT2 = "2026-10-02T10:00:00.000Z";
const OCT11 = "2026-10-11T10:00:00.000Z";
const OCT14 = "2026-10-14T10:00:00.000Z";

const batch = (id: string, addedAt: string, extra: Partial<BatchRow> = {}): BatchRow => ({
  id,
  addedAt,
  createdAt: addedAt,
  createdBy: VERO,
  updatedAt: addedAt,
  updatedBy: VERO,
  ...extra,
});
const eggs = (batches: BatchRow[], extra: Partial<ItemRow> = {}) =>
  item("eggs", "eggs", { addedAt: batches[0]?.addedAt ?? OCT14, location: said("fridge" as const), batches, ...extra });

const m = (code: string, params: Record<string, string | number | boolean> = {}) => ({ code, params, text: code });
const offer: BatchOffer = { itemId: "eggs", name: "eggs", newBatchId: "b2", older: [{ batchId: "b1", addedAt: OCT2 }] };
const purchase: ReceiptModel = {
  changeSetId: "cs-buy",
  newVersion: 2,
  undoable: true,
  applied: [
    {
      opId: "1",
      summary: m("ITEM_BATCH_ADDED", { name: "eggs", batches: 2, closedOldest: false, fromList: false }),
      refs: [{ kind: "item", id: "eggs", change: "updated", batchId: "b2" }],
      batchOffers: [offer],
    },
  ],
  rejected: [],
  undo: "idle",
};
const twoBatches = kitchen([eggs([batch("b1", OCT2), batch("b2", OCT14)])], 2);
const result = (state: KitchenState, code: string, params: Record<string, string | number> = {}, undoable = true): ApplyResult => ({
  changeSetId: `cs-${code}`,
  newVersion: state.version,
  undoable,
  applied: [{ opId: "op", summary: m(code, params), refs: [{ kind: "item", id: "eggs", change: "updated" }] }],
  rejected: [],
  state,
});
const ok = (r: ApplyResult): ActionResult => ({ ok: true, result: r });

/** A receipt next to the live kitchen state, which the fake actions' `showOwn` updates. */
function Harness({ initial, actions, receipt = purchase }: { initial: KitchenState; actions: Partial<KitchenActions>; receipt?: ReceiptModel }) {
  const [state, setState] = useState(initial);
  const value = fakeActions({ ...actions, showOwn: (r) => setState(r.state) });
  return (
    <AnnouncerProvider>
      <KitchenActionsProvider value={value}>
        <KitchenDataProvider value={{ me: VERO, snapshot: { state, status: "ok", syncedAt: 0 }, marks: {}, remoteIds: new Set(), now: NOW }}>
          <Receipt receipt={receipt} onUndo={() => {}} />
          <KitchenWidget onRetry={() => {}} />
        </KitchenDataProvider>
      </KitchenActionsProvider>
    </AnnouncerProvider>
  );
}

const announcer = () => screen.getByTestId("announcer");
const choice = () => screen.getByRole("group", { name: "You also had eggs from Oct 2." });

describe("Kitchen row with batches", () => {
  const row = (id: string) => document.querySelector<HTMLElement>(`[data-entity-id="${id}"]`)!;

  it("shows '2 batches · oldest 12 days'; its edit sheet lists the batches, oldest first, to pick from (KOS3, KOS4-e)", async () => {
    const state = kitchen([
      eggs([
        batch("b1", OCT2, { location: said("fridge" as const), stock: said("low" as const) }),
        batch("b2", OCT14, { createdBy: LEVI, quantity: said({ asSaid: "a dozen" }) }),
      ]),
    ]);
    renderWithIntl(<Harness initial={state} actions={{}} receipt={{ ...purchase, applied: [] }} />);
    expect(row("eggs")).toHaveTextContent("2 batches · oldest 12 days");

    await userEvent.click(screen.getByRole("button", { name: "Edit eggs" }));
    const sheet = await screen.findByRole("dialog", { name: "Edit eggs" });
    const which = within(sheet).getByRole("radiogroup", { name: "Which batch?" });
    const [all, older, newer] = within(which).getAllByRole("radio");
    expect(all).toHaveAccessibleName("All 2 batches");
    expect(all).toBeChecked();
    expect(older).toHaveAccessibleName(/^Added Oct 2 · Fridge · Running low · added by you$/);
    expect(newer).toHaveAccessibleName(/^Added Oct 14 · a dozen · added by Levi$/);
  });

  it("a one-batch item says 'added X days ago', and its sheet has no batch choice", async () => {
    renderWithIntl(<Harness initial={kitchen([eggs([batch("b1", OCT11)])])} actions={{}} receipt={{ ...purchase, applied: [] }} />);
    expect(screen.getByText("added 3 days ago")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit eggs" }));
    const sheet = await screen.findByRole("dialog", { name: "Edit eggs" });
    expect(within(sheet).queryByRole("radiogroup", { name: "Which batch?" })).toBeNull();
  });

  it("labels a defrosted batch Defrosted, on the row and in the sheet's batch choice (with its date)", async () => {
    const chicken = item("ch", "chicken thighs", {
      location: said("fridge" as const),
      defrostedOn: said(OCT11),
      batches: [batch("c1", OCT2, { defrostedOn: said(OCT11), frozen: said(false) }), batch("c2", OCT11, { frozen: said(true) })],
    });
    renderWithIntl(<Harness initial={kitchen([chicken])} actions={{}} receipt={{ ...purchase, applied: [] }} />);
    expect(row("ch")).toHaveTextContent("Defrosted");
    await userEvent.click(screen.getByRole("button", { name: "Edit chicken thighs" }));
    const which = within(await screen.findByRole("dialog")).getByRole("radiogroup", { name: "Which batch?" });
    const [, first, second] = within(which).getAllByRole("radio");
    expect(first).toHaveAccessibleName(/Defrosted Oct 11/);
    expect(second).toHaveAccessibleName(/Frozen/);
    expect(second).not.toHaveAccessibleName(/Defrosted/);
  });

  it("an item from an older cached state (no batches) still shows Defrosted from the row", () => {
    const chicken = item("ch", "chicken thighs", { defrostedOn: said(OCT11) });
    renderWithIntl(<Harness initial={kitchen([chicken])} actions={{}} receipt={{ ...purchase, applied: [] }} />);
    expect(screen.getByText("Defrosted")).toBeInTheDocument();
  });
});

describe("Receipt batch choice", () => {
  it("asks once, with buttons named for the batch", () => {
    renderWithIntl(<Harness initial={twoBatches} actions={{}} />);
    expect(screen.getByRole("region", { name: "What changed" })).toHaveTextContent("Added eggs (2 batches)");
    expect(within(choice()).getByRole("button", { name: "Still have them: eggs from Oct 2" })).toBeInTheDocument();
    expect(within(choice()).getByRole("button", { name: "Those are gone: eggs from Oct 2" })).toBeInTheDocument();
  });

  it("Those are gone → closeBatch, the result with Undo (focused, announced); Undo brings the choice back", async () => {
    const oneLeft = kitchen([eggs([batch("b2", OCT14)])], 3);
    const closeBatch = vi.fn(async () => ok(result(oneLeft, "ITEM_BATCH_GONE", { name: "eggs", left: 1 })));
    const undo = vi.fn(async () => ok(result(kitchen([eggs([batch("b1", OCT2), batch("b2", OCT14)])], 4), "UNDONE")));
    renderWithIntl(<Harness initial={twoBatches} actions={{ closeBatch, undo }} />);

    await userEvent.click(screen.getByRole("button", { name: "Those are gone: eggs from Oct 2" }));
    expect(closeBatch).toHaveBeenCalledWith("eggs", ["b1"]);
    const undoButton = await screen.findByRole("button", { name: "Undo: Eggs: those are gone (1 batch left)" });
    await waitFor(() => expect(undoButton).toHaveFocus());
    // One Undo per receipt (tester run 2026-10-14 saw two stacked): it steps back the newest change.
    const card = screen.getByRole("region", { name: "What changed" });
    expect(within(card).getAllByRole("button", { name: /^Undo/ })).toHaveLength(1);
    await waitFor(() => expect(announcer()).toHaveTextContent("Eggs: those are gone (1 batch left)"));
    expect(screen.queryByRole("group", { name: /You also had eggs/ })).toBeNull();
    // The Kitchen row is a plain one-batch row again.
    expect(document.querySelector('[data-entity-id="eggs"]')).not.toHaveTextContent("2 batches");

    await userEvent.click(undoButton);
    expect(undo).toHaveBeenCalledWith("cs-ITEM_BATCH_GONE");
    const gone = await screen.findByRole("button", { name: "Those are gone: eggs from Oct 2" });
    await waitFor(() => expect(gone).toHaveFocus());
    await waitFor(() => expect(announcer()).toHaveTextContent("Undone: Eggs: those are gone (1 batch left)"));
    expect(document.querySelector('[data-entity-id="eggs"]')).toHaveTextContent("2 batches");
    // With the answer stepped back, the same one Undo is for the purchase again.
    expect(within(card).getAllByRole("button", { name: /^Undo/ })).toHaveLength(1);
    expect(within(card).getByRole("button", { name: /^Undo/ })).toHaveAccessibleName("Undo: Added eggs (2 batches)");
  });

  it("a saved receipt (after a reload) shows its answer and the same one Undo, without moving focus (re-run step 28)", async () => {
    const oneLeft = kitchen([eggs([batch("b2", OCT14)])], 3);
    const undo = vi.fn(async () => ok(result(kitchen([eggs([batch("b1", OCT2), batch("b2", OCT14)])], 4), "UNDONE")));
    const saved: ReceiptModel = {
      ...purchase,
      batchAnswers: [
        {
          itemId: "eggs",
          newBatchId: "b2",
          choice: "gone",
          changeSetId: "cs-gone",
          applied: [{ opId: "close-1", summary: m("ITEM_BATCH_GONE", { name: "eggs", left: 1 }), refs: [] }],
          undoable: true,
        },
      ],
    };
    renderWithIntl(<Harness initial={oneLeft} actions={{ undo }} receipt={saved} />);
    const card = screen.getByRole("region", { name: "What changed" });
    expect(card).toHaveTextContent("Eggs: those are gone (1 batch left)");
    const undoButton = within(card).getByRole("button", { name: /^Undo/ });
    expect(undoButton).toHaveAccessibleName("Undo: Eggs: those are gone (1 batch left)");
    expect(within(card).getAllByRole("button", { name: /^Undo/ })).toHaveLength(1);
    expect(undoButton).not.toHaveFocus();

    await userEvent.click(undoButton);
    expect(undo).toHaveBeenCalledWith("cs-gone");
    const gone = await screen.findByRole("button", { name: "Those are gone: eggs from Oct 2" });
    await waitFor(() => expect(gone).toHaveFocus());
    expect(within(card).getByRole("button", { name: /^Undo/ })).toHaveAccessibleName("Undo: Added eggs (2 batches)");
  });

  it("a saved 'Still have them' shows its line, with Undo still for the purchase", () => {
    const kept = kitchen([eggs([batch("b1", OCT2, { keptAt: OCT14 }), batch("b2", OCT14)])], 3);
    const saved: ReceiptModel = {
      ...purchase,
      batchAnswers: [
        { itemId: "eggs", newBatchId: "b2", choice: "keep", changeSetId: "cs-keep", applied: [{ opId: "keep-1", summary: m("ITEM_BATCH_KEPT", { name: "eggs" }), refs: [] }], undoable: false },
      ],
    };
    renderWithIntl(<Harness initial={kept} actions={{}} receipt={saved} />);
    const card = screen.getByRole("region", { name: "What changed" });
    expect(card).toHaveTextContent("Kept the older eggs");
    expect(within(card).getByRole("button", { name: /^Undo/ })).toHaveAccessibleName("Undo: Added eggs (2 batches)");
  });

  it("Still have them → keepOlderBatch; the result is focused, with no Undo (a soft change)", async () => {
    const kept = kitchen([eggs([batch("b1", OCT2, { keptAt: OCT14 }), batch("b2", OCT14)])], 3);
    const keepOlderBatch = vi.fn(async () => ok(result(kept, "ITEM_BATCH_KEPT", { name: "eggs" }, false)));
    renderWithIntl(<Harness initial={twoBatches} actions={{ keepOlderBatch }} />);

    await userEvent.click(screen.getByRole("button", { name: "Still have them: eggs from Oct 2" }));
    expect(keepOlderBatch).toHaveBeenCalledWith("eggs", ["b1"]);
    const line = await screen.findByText("Kept the older eggs", { selector: "p" });
    await waitFor(() => expect(line).toHaveFocus());
    expect(screen.queryByRole("button", { name: /^Undo: Kept/ })).toBeNull();
    expect(document.querySelector('[data-entity-id="eggs"]')).toHaveTextContent("2 batches");
  });

  it("a failed tap says nothing changed and keeps the buttons, focus on the choice", async () => {
    renderWithIntl(<Harness initial={twoBatches} actions={{}} />);
    const gone = screen.getByRole("button", { name: "Those are gone: eggs from Oct 2" });
    await userEvent.click(gone);
    expect(await screen.findByText("I couldn't save that, so nothing changed. Try again.", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Those are gone: eggs from Oct 2" })).toHaveFocus();
  });

  it("is hidden once answered elsewhere, and after the purchase is undone", () => {
    const kept = kitchen([eggs([batch("b1", OCT2, { keptAt: OCT14 }), batch("b2", OCT14)])]);
    const { unmount } = renderWithIntl(<Harness initial={kept} actions={{}} />);
    expect(screen.queryByRole("group", { name: /You also had eggs/ })).toBeNull();
    unmount();

    const closed = kitchen([eggs([batch("b2", OCT14)])]);
    const second = renderWithIntl(<Harness initial={closed} actions={{}} />);
    expect(screen.queryByRole("group", { name: /You also had eggs/ })).toBeNull();
    second.unmount();

    // The purchase undone: the new batch is gone, so there's nothing to compare.
    renderWithIntl(<Harness initial={kitchen([eggs([batch("b1", OCT2)])])} actions={{}} receipt={{ ...purchase, undo: "done" }} />);
    expect(screen.queryByRole("group", { name: /You also had eggs/ })).toBeNull();
  });

  it("names both dates when two older batches are open", () => {
    const three = kitchen([eggs([batch("b0", "2026-09-28T10:00:00.000Z"), batch("b1", OCT2), batch("b2", OCT14)])]);
    const both: ReceiptModel = {
      ...purchase,
      applied: [{ ...purchase.applied[0], batchOffers: [{ ...offer, older: [{ batchId: "b0", addedAt: "2026-09-28T10:00:00.000Z" }, ...offer.older] }] }],
    };
    renderWithIntl(<Harness initial={three} actions={{}} receipt={both} />);
    expect(screen.getByRole("group", { name: "You also had eggs from Sep 28 and Oct 2." })).toBeInTheDocument();
  });
});

describe("batch message codes (en.json)", () => {
  function Line({ code, params }: { code: string; params: Record<string, string | number | boolean> }) {
    const format = useFormatMsg();
    return <p>{format(m(code, params))}</p>;
  }
  it.each([
    ["ITEM_BATCH_ADDED", { name: "eggs", batches: 2, closedOldest: false, fromList: false }, "Added eggs (2 batches)"],
    [
      "ITEM_BATCH_ADDED",
      { name: "eggs", batches: 3, closedOldest: true, fromList: true },
      "Added eggs (3 batches); the oldest batch is closed and took it off the shopping list",
    ],
    // "(1 left)" read as one egg (tester run 2026-10-14): it says batches, pluralised.
    ["ITEM_BATCH_USED_UP", { name: "eggs", left: 1 }, "Eggs: finished a batch (1 batch left)"],
    ["ITEM_BATCH_USED_UP", { name: "eggs", left: 3 }, "Eggs: finished a batch (3 batches left)"],
    ["ITEM_BATCH_GONE", { name: "eggs", left: 1 }, "Eggs: those are gone (1 batch left)"],
    ["ITEM_BATCH_GONE", { name: "eggs", left: 2 }, "Eggs: those are gone (2 batches left)"],
    ["ITEM_BATCH_KEPT", { name: "eggs" }, "Kept the older eggs"],
    ["ITEM_DEFROSTED", { name: "chicken" }, "Chicken: defrosted"],
  ])("%s", (code, params, text) => {
    renderWithIntl(<Line code={code} params={params} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});
