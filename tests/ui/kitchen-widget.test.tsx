// @vitest-environment jsdom
/** The Kitchen widget: groups, labels, highlights, two-person cues and its states (ux.md §3). */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KitchenState } from "@/contracts/kitchen-state";
import type { SyncSnapshot } from "@/ui/sync/kitchen-sync";
import { KitchenDataProvider, type ChangeMark } from "@/ui/sync/KitchenDataContext";
import { KitchenWidget } from "@/ui/widgets/kitchen/KitchenWidget";
import { item, kitchen, LEVI, said, VERO } from "../support/kitchen-rows";
import { renderWithIntl } from "../support/intl";

afterEach(cleanup);
const NOW = new Date("2026-10-17T12:00:00.000Z");

function show(
  state: KitchenState | null,
  opts: { status?: SyncSnapshot["status"]; marks?: Record<string, ChangeMark>; remote?: string[]; onRetry?: () => void } = {},
) {
  const snapshot: SyncSnapshot = { state, status: opts.status ?? (state ? "ok" : "loading"), syncedAt: NOW.getTime() };
  renderWithIntl(
    <KitchenDataProvider value={{ me: VERO, snapshot, marks: opts.marks ?? {}, remoteIds: new Set(opts.remote ?? []), now: NOW }}>
      <KitchenWidget onRetry={opts.onRetry ?? (() => {})} />
    </KitchenDataProvider>,
  );
}

const group = (name: string) => screen.getByRole("region", { name });

describe("KitchenWidget", () => {
  it("groups items Fridge / Freezer / Pantry / Not sure where, in that order, skipping empty groups", () => {
    show(
      kitchen([
        item("1", "eggs"),
        item("2", "chicken thighs", { location: said("freezer") }),
        item("3", "milk", { location: said("fridge") }),
      ]),
    );
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Fridge", "Freezer", "Not sure where"]);
    expect(within(group("Freezer")).getByText("Chicken thighs")).toBeInTheDocument();
    expect(within(group("Not sure where")).getByText("Eggs")).toBeInTheDocument();
  });

  it("shows 'added X days ago', Running low and the amount as said", () => {
    show(
      kitchen([
        item("1", "yogurt", { addedAt: "2026-10-14T09:00:00.000Z", stock: said("low" as const) }),
        item("2", "rice", { addedAt: "2026-10-17T08:00:00.000Z", quantity: said({ asSaid: "2 bags" }) }),
      ]),
    );
    expect(screen.getByText("added 3 days ago")).toBeInTheDocument();
    expect(screen.getByText("Running low")).toBeInTheDocument();
    expect(screen.getByText("added today")).toBeInTheDocument();
    expect(screen.getByText("2 bags")).toBeInTheDocument();
  });

  it("'Out' items are never shown (0011)", () => {
    show(kitchen([item("1", "eggs"), item("2", "milk", { stock: said("out" as const) })]));
    expect(screen.queryByText("Milk")).not.toBeInTheDocument();
  });

  it("marks rows changed by your last message as New / Updated, in text (not colour alone)", () => {
    show(kitchen([item("1", "eggs"), item("2", "spinach")]), { marks: { "1": "new", "2": "updated" } });
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("New");
    expect(rows[0]).toHaveAttribute("data-change", "new");
    expect(rows[1]).toHaveTextContent("Updated");
  });

  it("the other person's changes carry 'Levi · just now'; yours carry no name", () => {
    show(
      kitchen([
        item("1", "milk", { createdBy: LEVI, updatedBy: LEVI, updatedAt: "2026-10-17T11:59:40.000Z" }),
        item("2", "bread", { createdBy: LEVI, updatedBy: LEVI, updatedAt: "2026-10-17T09:00:00.000Z" }),
        item("3", "eggs"),
      ]),
      { remote: ["1"] },
    );
    expect(screen.getByText("Levi · just now")).toBeInTheDocument();
    expect(screen.getByText("Levi · 3 hours ago")).toBeInTheDocument();
    const milk = screen.getByText("Milk").closest("li")!;
    expect(milk).toHaveAttribute("data-change", "remote");
    expect(screen.getByText("Eggs").closest("li")).not.toHaveTextContent("Vero");
  });

  it("a deleted or unknown person shows as 'Someone' and a blank name as 'Unknown item' (0018)", () => {
    show(kitchen([item("1", " ", { updatedBy: { id: "gone", missing: true } })]));
    expect(screen.getByText("Unknown item")).toBeInTheDocument();
    expect(screen.getByText(/^Someone · /)).toBeInTheDocument();
  });

  it("empty state", () => {
    show(kitchen([]));
    expect(screen.getByText("Your kitchen is empty. Tell me what you've got.")).toBeInTheDocument();
  });

  it("loading state on first appearance", () => {
    show(null);
    expect(screen.getByText("Loading your kitchen…")).toBeInTheDocument();
  });

  it("error state with Retry", async () => {
    const onRetry = vi.fn();
    show(null, { status: "error", onRetry });
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("stale state keeps the items and says when they're from", () => {
    show(kitchen([item("1", "eggs")]), { status: "stale" });
    expect(screen.getByText(/^Offline · showing your kitchen as of /)).toBeInTheDocument();
    expect(screen.getByText("Eggs")).toBeInTheDocument();
  });
});
