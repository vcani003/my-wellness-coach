// @vitest-environment jsdom
/**
 * Kitchen See all (K1, CAT1): By place | By type (remembered per device), search (accents
 * ignored, matches marked, no-matches hint), the compact widget's way in, and the category receipts.
 */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemCategory } from "@/contracts/common";
import type { ItemRow, KitchenState } from "@/contracts/kitchen-state";
import { AnnouncerProvider } from "@/ui/a11y/Announcer";
import { Receipt } from "@/ui/chat/Receipt";
import type { Receipt as ReceiptModel } from "@/ui/chat/chat-reducer";
import type { SyncSnapshot } from "@/ui/sync/kitchen-sync";
import { KitchenActionsProvider } from "@/ui/sync/KitchenActionsContext";
import { KitchenDataProvider } from "@/ui/sync/KitchenDataContext";
import { KitchenSeeAll } from "@/ui/widgets/kitchen/KitchenSeeAll";
import { KitchenWidget } from "@/ui/widgets/kitchen/KitchenWidget";
import { groupByCategory, highlightParts } from "@/ui/widgets/kitchen/model";
import { requestSeeAllFocus } from "@/ui/widgets/kitchen/see-all-focus";
import { KITCHEN_VIEW_KEY, resetKitchenViewMemory } from "@/ui/widgets/kitchen/view-pref";
import { fakeActions } from "../support/fake-actions";
import { renderWithIntl } from "../support/intl";
import { item, kitchen, said, VERO } from "../support/kitchen-rows";

const router = { push: vi.fn(), back: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/kitchen" }));

const NOW = new Date("2026-10-17T12:00:00.000Z");
const guess = (value: ItemCategory) => ({ value, basis: "inferred" as const, confidence: "medium" as const });

const ITEMS: ItemRow[] = [
  item("1", "fish sauce", { category: guess("sauces_condiments"), location: said("pantry" as const), updatedAt: "2026-10-17T10:00:00.000Z" }),
  item("2", "nước mắm", { category: guess("sauces_condiments"), location: said("pantry" as const), updatedAt: "2026-10-17T09:00:00.000Z" }),
  item("3", "milk", { category: guess("dairy_eggs"), location: said("fridge" as const) }),
  item("4", "jasmine rice", { category: guess("rice_noodles_grains") }),
  item("5", "eggs", { category: guess("dairy_eggs"), stock: said("out" as const) }),
];

function show(state: KitchenState | null = kitchen(ITEMS), ui = <KitchenSeeAll />) {
  const snapshot: SyncSnapshot = { state, status: state ? "ok" : "loading", syncedAt: NOW.getTime() };
  return renderWithIntl(
    <AnnouncerProvider>
      <KitchenActionsProvider value={fakeActions()}>
        <KitchenDataProvider value={{ me: VERO, snapshot, marks: {}, remoteIds: new Set(), now: NOW }}>{ui}</KitchenDataProvider>
      </KitchenActionsProvider>
    </AnnouncerProvider>,
  );
}

const groupTitles = () => screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
const search = () => screen.getByRole("searchbox", { name: "Search your kitchen" });

beforeEach(() => {
  window.localStorage.clear();
  resetKitchenViewMemory();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("See all: By place | By type", () => {
  it("opens By place, grouped like the Kitchen widget, with the heading focused", () => {
    show();
    expect(screen.getByRole("button", { name: "By place" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "By type" })).toHaveAttribute("aria-pressed", "false");
    expect(groupTitles()).toEqual(["Fridge", "Pantry", "Not sure where"]);
    expect(screen.getByRole("heading", { name: "Your kitchen" })).toHaveFocus();
    // By place doesn't repeat the place on each row.
    expect(screen.queryByText(/· Pantry/)).not.toBeInTheDocument();
  });

  it("By type groups under the category names in the fixed order, empty groups hidden, each row saying where it is", async () => {
    show();
    await userEvent.click(screen.getByRole("button", { name: "By type" }));
    expect(screen.getByRole("button", { name: "By type" })).toHaveAttribute("aria-pressed", "true");
    // Out items (eggs) never show, so Dairy & eggs holds only milk.
    expect(groupTitles()).toEqual(["Dairy & eggs", "Rice, noodles & grains", "Sauces & condiments"]);
    const sauces = screen.getByRole("region", { name: "Sauces & condiments" });
    const rows = within(sauces).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("Fish sauce · Pantry"), expect.stringContaining("Nước mắm · Pantry")]);
    expect(within(screen.getByRole("region", { name: "Rice, noodles & grains" })).getByText(/· Not sure where/)).toBeInTheDocument();
    // Existing details stay on the row.
    expect(rows[0]).toHaveTextContent("added 3 days ago");
  });

  it("remembers the choice on this device", async () => {
    const first = show();
    await userEvent.click(screen.getByRole("button", { name: "By type" }));
    expect(window.localStorage.getItem(KITCHEN_VIEW_KEY)).toBe("type");
    first.unmount();
    show();
    expect(screen.getByRole("button", { name: "By type" })).toHaveAttribute("aria-pressed", "true");
    expect(groupTitles()[0]).toBe("Dairy & eggs");
  });

  it("still switches when storage is blocked (private mode), defaulting to By place", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    show();
    expect(screen.getByRole("button", { name: "By place" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "By type" }));
    expect(screen.getByRole("button", { name: "By type" })).toHaveAttribute("aria-pressed", "true");
  });

  it("an item from an older cached state without a category gets the kitchen's guess", async () => {
    window.localStorage.setItem(KITCHEN_VIEW_KEY, "type");
    show(kitchen([item("1", "hoisin sauce"), item("2", "mystery thing")]));
    expect(groupTitles()).toEqual(["Sauces & condiments", "Other"]);
  });

  it("groupByCategory keeps the CAT1 order and the most recently changed first", () => {
    const groups = groupByCategory(ITEMS);
    expect(groups.map((g) => g.key)).toEqual(["dairy_eggs", "rice_noodles_grains", "sauces_condiments"]);
    expect(groups[2].items.map((i) => i.id)).toEqual(["1", "2"]);
  });
});

describe("See all: search", () => {
  it("filters as you type into one flat list with the place shown, in either view", async () => {
    show();
    await userEvent.type(search(), "rice");
    expect(screen.queryByRole("region", { name: "Pantry" })).not.toBeInTheDocument();
    const results = screen.getByRole("region", { name: "1 match" });
    expect(within(results).getByRole("listitem")).toHaveTextContent("Jasmine rice · Not sure where");
    await userEvent.click(screen.getByRole("button", { name: "By type" }));
    expect(screen.getByRole("region", { name: "1 match" })).toBeInTheDocument();
  });

  it("ignores accents: 'nuoc mam' finds 'nước mắm' and marks the matched words", async () => {
    show();
    await userEvent.type(search(), "nuoc mam");
    const results = screen.getByRole("region", { name: "1 match" });
    expect(within(results).getByRole("listitem")).toHaveTextContent("Nước mắm · Pantry");
    const marks = results.querySelectorAll("mark");
    expect([...marks].map((m) => m.textContent)).toEqual(["Nước", "mắm"]);
  });

  it("'fish' finds fish sauce and nước mắm (through its English name)", async () => {
    show();
    await userEvent.type(search(), "fish");
    const results = screen.getByRole("region", { name: "2 matches" });
    expect(within(results).getAllByRole("listitem").map((r) => r.textContent)).toEqual([
      expect.stringContaining("Fish sauce"),
      expect.stringContaining("Nước mắm"),
    ]);
    expect(results.querySelector("mark")).toHaveTextContent("Fish");
  });

  it("no matches says so, with a hint to ask Kitchen, and is spoken once typing pauses", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    show();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(search(), "tofu");
    expect(screen.getByText("No matches for “tofu”")).toBeInTheDocument();
    expect(screen.getByText("Try another word, or ask Kitchen in chat.")).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(screen.getByTestId("announcer")).toHaveTextContent("No matches for “tofu”");
  });

  it("Clear search empties the field, keeps focus there, and brings the groups back", async () => {
    show();
    await userEvent.type(search(), "milk");
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search()).toHaveValue("");
    expect(search()).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
    expect(groupTitles()).toEqual(["Fridge", "Pantry", "Not sure where"]);
  });

  it("Escape clears the search too", async () => {
    show();
    await userEvent.type(search(), "milk{Escape}");
    expect(search()).toHaveValue("");
  });

  it("highlightParts marks word starts only, accents ignored", () => {
    expect(highlightParts("Nước mắm", "mam")).toEqual([
      { text: "Nước ", match: false },
      { text: "mắm", match: true },
    ]);
    expect(highlightParts("Eggs", "egg")).toEqual([
      { text: "Egg", match: true },
      { text: "s", match: false },
    ]);
    // "ice" is inside "rice", not at a word start.
    expect(highlightParts("Jasmine rice", "ice")).toEqual([{ text: "Jasmine rice", match: false }]);
  });
});

describe("The compact Kitchen widget's way in", () => {
  it("has See all (N) and a search icon; the icon opens See all with the search field focused", () => {
    show(kitchen(ITEMS), <KitchenWidget onRetry={() => {}} />);
    expect(screen.getByRole("link", { name: "See all (4)" })).toHaveAttribute("href", "/kitchen");
    expect(screen.getByRole("link", { name: "Search your kitchen" })).toHaveAttribute("href", "/kitchen");
    cleanup();
    requestSeeAllFocus("search");
    show();
    expect(search()).toHaveFocus();
  });

  // Regression (e2e, 2026-10-14): in development React runs mount effects twice (and again when
  // Next reveals a kept route); the second run used up the request and focused the heading.
  it("the search field still gets focus when the mount effect runs again for the same tap", () => {
    requestSeeAllFocus("search");
    show(kitchen(ITEMS), <StrictMode><KitchenSeeAll /></StrictMode>);
    cleanup();
    show();
    expect(search()).toHaveFocus();
  });

  it("a later visit without the icon starts at the heading again", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    requestSeeAllFocus("search");
    vi.advanceTimersByTime(5000);
    show();
    expect(screen.getByRole("heading", { name: "Your kitchen" })).toHaveFocus();
  });

  it("an empty kitchen has neither", () => {
    show(kitchen([]), <KitchenWidget onRetry={() => {}} />);
    expect(screen.queryByRole("link", { name: /See all/ })).not.toBeInTheDocument();
  });

  it("Back goes home", async () => {
    show();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(router.push).toHaveBeenCalledWith("/");
  });
});

describe("Category receipts (CAT1)", () => {
  const m = (code: string, params: Record<string, string>) => ({ code, params, text: code });
  const receipt = (summary: ReturnType<typeof m>): ReceiptModel => ({
    changeSetId: "cs-1",
    newVersion: 2,
    undoable: true,
    applied: [{ opId: "1", summary, refs: [{ kind: "item", id: "1", change: "updated" }] }],
    rejected: [],
    undo: "idle",
  });

  it("'Fish sauce → Sauces & condiments', named in words for Undo", () => {
    renderWithIntl(
      <Receipt
        receipt={receipt(m("ITEM_CATEGORY", { name: "fish sauce", category: "sauces_condiments", categoryName: "Sauces & condiments" }))}
        onUndo={() => {}}
      />,
    );
    const card = screen.getByRole("region", { name: "What changed" });
    expect(card).toHaveTextContent("Fish sauce → Sauces & condiments");
    expect(screen.getByRole("button", { name: "Undo: Fish sauce now under Sauces & condiments" })).toBeInTheDocument();
  });

  it("the remembered choice", () => {
    renderWithIntl(
      <Receipt
        receipt={receipt(m("CATEGORY_REMEMBERED", { name: "fish sauce", category: "sauces_condiments", categoryName: "Sauces & condiments" }))}
        onUndo={() => {}}
      />,
    );
    expect(screen.getByRole("region", { name: "What changed" })).toHaveTextContent(
      "I'll put fish sauce under Sauces & condiments from now on",
    );
  });
});
