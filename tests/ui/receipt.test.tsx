// @vitest-environment jsdom
/** The "What changed" receipt (0007, 0011, 0017). */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Receipt as ReceiptModel } from "@/ui/chat/chat-reducer";
import { Receipt } from "@/ui/chat/Receipt";
import { renderWithIntl } from "../support/intl";

afterEach(cleanup);
const m = (code: string, params: Record<string, string> = {}, text = code) => ({ code, params, text });
const ref = { kind: "item" as const, id: "i1", change: "updated" as const };
const receipt = (over: Partial<ReceiptModel> = {}): ReceiptModel => ({
  changeSetId: "cs-1",
  newVersion: 2,
  undoable: true,
  applied: [{ opId: "1", summary: m("ITEM_MOVED", { name: "chicken thighs", location: "freezer" }), refs: [ref] }],
  rejected: [],
  undo: "idle",
  ...over,
});

describe("Receipt", () => {
  it("lists each change in plain words, with an Undo named for what it undoes", async () => {
    const onUndo = vi.fn();
    renderWithIntl(<Receipt receipt={receipt()} onUndo={onUndo} />);
    const card = screen.getByRole("region", { name: "What changed" });
    expect(card).toHaveTextContent("Chicken thighs → freezer");
    // Screen readers get words, not an arrow.
    expect(card).toHaveTextContent("Chicken thighs moved to the freezer");
    await userEvent.click(screen.getByRole("button", { name: "Undo: Chicken thighs moved to the freezer" }));
    expect(onUndo).toHaveBeenCalledWith("cs-1");
  });

  it("partial rejections are shown in place, muted, next to what did save", () => {
    renderWithIntl(
      <Receipt
        receipt={receipt({
          applied: [{ opId: "1", summary: m("ITEM_ADDED", { name: "eggs" }), refs: [ref] }],
          rejected: [{ opId: "2", reason: m("AMBIGUOUS_ITEM", { name: "chicken" }) }],
        })}
        onUndo={() => {}}
      />,
    );
    expect(screen.getByText("Added eggs")).toBeInTheDocument();
    expect(screen.getByText("Not changed: More than one item matches chicken")).toBeInTheDocument();
  });

  it("after Undo: lines struck through, 'Undone', and no Undo button", () => {
    renderWithIntl(<Receipt receipt={receipt({ undo: "done" })} onUndo={() => {}} />);
    expect(screen.getByText("Undone")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Undo/ })).not.toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveClass("line-through");
  });

  it("a refused Undo explains itself and leaves the lines as they were", () => {
    renderWithIntl(<Receipt receipt={receipt({ undo: "refused", undoReason: m("UNDO_CONFLICT") })} onUndo={() => {}} />);
    expect(screen.getByText("Can't undo this now. Tell me what to fix.")).toBeInTheDocument();
    expect(screen.getByRole("listitem")).not.toHaveClass("line-through");
  });

  it("no Undo when the change isn't undoable (e.g. it was itself an Undo) or nothing saved", () => {
    renderWithIntl(<Receipt receipt={receipt({ undoable: false, applied: [{ opId: "1", summary: m("UNDONE"), refs: [ref] }] })} onUndo={() => {}} />);
    expect(screen.queryByRole("button", { name: /^Undo/ })).not.toBeInTheDocument();
    cleanup();
    renderWithIntl(<Receipt receipt={receipt({ applied: [], rejected: [{ opId: "1", reason: m("ALREADY_OUT", { name: "milk" }) }] })} onUndo={() => {}} />);
    expect(screen.queryByRole("button", { name: /^Undo/ })).not.toBeInTheDocument();
  });

  it("an unknown message code falls back to the English text from the server", () => {
    renderWithIntl(<Receipt receipt={receipt({ applied: [{ opId: "1", summary: m("BRAND_NEW_CODE", {}, "something new"), refs: [ref] }] })} />);
    expect(screen.getByText("Something new")).toBeInTheDocument();
  });
});
