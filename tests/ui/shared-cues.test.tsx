// @vitest-environment jsdom
/**
 * Shared-kitchen cues (ux.md §6): "Since your last visit" and the live removal cue.
 * Tester run 2026-10-14 household, step 5b: when Levi used up the eggs, they vanished from
 * Vero's Kitchen with nothing saying who did it.
 */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangeSetSummary } from "@/contracts/apply-result";
import type { ActorRef, Msg } from "@/contracts/common";
import type { KitchenState } from "@/contracts/kitchen-state";
import type { KitchenSync, RemoteChange } from "@/ui/sync/kitchen-sync";
import { KitchenActionsProvider } from "@/ui/sync/KitchenActionsContext";
import { KitchenDataProvider } from "@/ui/sync/KitchenDataContext";
import { othersChanges, parseChanges, readLastSeen, REMOVAL_CODES, sinceBaseline, writeLastSeen, type CueEntry } from "@/ui/sync/shared-cues";
import { useSharedCues, type SharedCues } from "@/ui/sync/useSharedCues";
import { KitchenWidget } from "@/ui/widgets/kitchen/KitchenWidget";
import { fakeActions } from "../support/fake-actions";
import { IntlWrapper, renderWithIntl } from "../support/intl";
import { item, kitchen, LEVI, VERO } from "../support/kitchen-rows";

afterEach(cleanup);
beforeEach(() => window.localStorage.clear());

const NOW = new Date("2026-10-14T12:00:00.000Z");
const m = (code: string, params: Msg["params"] = {}): Msg => ({ code, params, text: code });
let n = 0;
function cs(actor: ActorRef, summaries: Msg[], extra: Partial<ChangeSetSummary> = {}): ChangeSetSummary {
  n += 1;
  return { changeSetId: `cs${n}`, version: n, actor, via: "chat", at: NOW.toISOString(), summaries, undone: false, ...extra };
}
const entry = (actor: ActorRef, summary: Msg, version = 1): CueEntry => ({ changeSetId: `e${version}`, version, actor, summary });

describe("othersChanges", () => {
  it("keeps the other members' changes, including a former member's, and leaves out mine", () => {
    const changes = [cs(VERO, [m("ITEM_ADDED", { name: "milk" })]), cs(LEVI, [m("ITEM_OUT", { name: "eggs" })]), cs({ id: "x", missing: true, former: true }, [m("ITEM_REMOVED", { name: "rice" })])];
    expect(othersChanges(changes, VERO.id).map((e) => e.summary.code)).toEqual(["ITEM_OUT", "ITEM_REMOVED"]);
  });

  it("leaves out undone change sets, the Undo itself, quiet summaries and system changes", () => {
    const changes = [
      cs(LEVI, [m("ITEM_ADDED", { name: "milk" })], { undone: true }),
      cs(LEVI, [m("UNDONE")]),
      cs(LEVI, [m("ITEM_BATCH_KEPT", { name: "eggs" })]),
      cs(LEVI, [m("ITEM_ADDED", { name: "bread" })], { via: "system" }),
      cs(LEVI, [m("ITEM_LOW", { name: "yogurt" })]),
    ];
    expect(othersChanges(changes, VERO.id).map((e) => e.summary.params.name)).toEqual(["yogurt"]);
  });

  it("filters by version range and by code", () => {
    const a = cs(LEVI, [m("ITEM_ADDED", { name: "a" })]);
    const b = cs(LEVI, [m("ITEM_OUT", { name: "b" })]);
    const c = cs(LEVI, [m("ITEM_OUT", { name: "c" })]);
    expect(othersChanges([a, b, c], VERO.id, { since: a.version, through: b.version }).map((e) => e.summary.params.name)).toEqual(["b"]);
    expect(othersChanges([a, b, c], VERO.id, { only: REMOVAL_CODES }).map((e) => e.summary.params.name)).toEqual(["b", "c"]);
  });
});

describe("parseChanges and the stored version", () => {
  it("drops a malformed change set and rejects a malformed body (0018)", () => {
    const good = cs(LEVI, [m("ITEM_OUT", { name: "eggs" })]);
    expect(parseChanges({ changes: [good, { nope: 1 }] })).toEqual([good]);
    expect(parseChanges("oops")).toBeNull();
  });

  it("works without storage: reads nothing and writing doesn't throw", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } as unknown as Storage;
    expect(readLastSeen("k1", "vero", broken)).toBeNull();
    expect(() => writeLastSeen("k1", "vero", 3, broken)).not.toThrow();
  });

  it("is per kitchen and per person on this device", () => {
    writeLastSeen("k1", "vero", 4);
    expect(readLastSeen("k1", "vero")).toBe(4);
    expect(readLastSeen("k1", "levi")).toBeNull();
    expect(readLastSeen("k2", "vero")).toBeNull();
  });

  it("asks only when there's something newer than what this device last showed", () => {
    expect(sinceBaseline(null, 5)).toBeNull(); // first visit
    expect(sinceBaseline(5, 5)).toBeNull();
    expect(sinceBaseline(9, 5)).toBeNull(); // the kitchen was reset
    expect(sinceBaseline(3, 5)).toBe(3);
  });
});

function showWidget(cues: SharedCues, state: KitchenState = kitchen([item("1", "milk")], 3)) {
  renderWithIntl(
    <KitchenActionsProvider value={fakeActions()}>
      <KitchenDataProvider value={{ me: VERO, snapshot: { state, status: "ok", syncedAt: NOW.getTime() }, marks: {}, remoteIds: new Set(), now: NOW, cues }}>
        <KitchenWidget onRetry={() => {}} />
      </KitchenDataProvider>
    </KitchenActionsProvider>,
  );
}
const cuesOf = (since: CueEntry[], live: CueEntry[] = [], dismissSince = vi.fn()): SharedCues => ({ since, live, dismissSince });

describe("Since your last visit (in the Kitchen widget)", () => {
  it("one line naming the person and what they did, including what they used up", () => {
    showWidget(cuesOf([entry(LEVI, m("ITEM_ADDED", { name: "milk" })), entry(LEVI, m("ITEM_OUT", { name: "eggs" }), 2)]));
    const line = screen.getByRole("region", { name: "Since your last visit" });
    expect(line).toHaveTextContent("Since your last visit: Levi added milk and used up the eggs.");
    expect(within(line).queryByRole("button", { name: "See all" })).not.toBeInTheDocument();
  });

  it("names a former member, and folds repeats", () => {
    const former = { id: "x", missing: true as const, former: true as const };
    showWidget(cuesOf([entry(former, m("ITEM_REMOVED", { name: "rice" })), entry(former, m("ITEM_REMOVED", { name: "rice" }), 2)]));
    expect(screen.getByRole("region", { name: "Since your last visit" })).toHaveTextContent("A former member removed the rice.");
  });

  it("past three things: 'and N more changes', with See all for the full list", async () => {
    const names = ["milk", "bread", "rice", "tofu", "basil"];
    showWidget(cuesOf(names.map((name, i) => entry(LEVI, m("ITEM_ADDED", { name }), i + 1))));
    const line = screen.getByRole("region", { name: "Since your last visit" });
    expect(line).toHaveTextContent("Levi added milk, added bread, added rice, and 2 more changes.");
    const seeAll = within(line).getByRole("button", { name: "See all" });
    expect(seeAll).toHaveAttribute("aria-expanded", "false");
    expect(within(line).queryByRole("list")).not.toBeInTheDocument();
    await userEvent.click(seeAll);
    expect(within(line).getByRole("button", { name: "Hide the list" })).toHaveAttribute("aria-expanded", "true");
    expect(within(within(line).getByRole("list", { name: "Changes since your last visit" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(
      names.map((name) => `Levi added ${name}`),
    );
  });

  it("Dismiss hides it and puts focus on the Kitchen, not nowhere", async () => {
    const dismissSince = vi.fn();
    showWidget(cuesOf([entry(LEVI, m("ITEM_OUT", { name: "eggs" }))], [], dismissSince));
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(dismissSince).toHaveBeenCalledOnce();
    expect(document.activeElement).toHaveTextContent("Milk");
  });

  it("nothing to say → no line", () => {
    showWidget(cuesOf([]));
    expect(screen.queryByRole("region", { name: "Since your last visit" })).not.toBeInTheDocument();
  });

  it("the live removal cue is one quiet line, separate from Since your last visit", () => {
    showWidget(cuesOf([], [entry(LEVI, m("ITEM_OUT", { name: "eggs" }))]));
    expect(screen.getByText("Levi used up the eggs.")).toHaveAttribute("data-live-removal");
    expect(screen.queryByRole("region", { name: "Since your last visit" })).not.toBeInTheDocument();
  });
});

describe("useSharedCues", () => {
  function fakeSync(changes: ChangeSetSummary[] | null) {
    const changesSince = vi.fn(async () => changes);
    return { sync: { changesSince } as unknown as KitchenSync, changesSince };
  }
  const wrapper = ({ children }: { children: ReactNode }) => <IntlWrapper>{children}</IntlWrapper>;

  it("first visit on this device: no line, and the version is remembered", async () => {
    const { sync, changesSince } = fakeSync([]);
    const { result } = renderHook(() => useSharedCues({ kitchenId: "k1", meId: VERO.id, sync, version: 4 }), { wrapper });
    expect(result.current.cues.since).toEqual([]);
    expect(changesSince).not.toHaveBeenCalled();
    expect(readLastSeen("k1", VERO.id)).toBe(4);
  });

  it("next visit: the other members' changes since then, up to what's on screen; Dismiss clears it", async () => {
    writeLastSeen("k1", VERO.id, 1);
    const changes = [
      cs(LEVI, [m("ITEM_OUT", { name: "eggs" })], { version: 2 }),
      cs(VERO, [m("ITEM_ADDED", { name: "milk" })], { version: 3 }),
      cs(LEVI, [m("ITEM_ADDED", { name: "late" })], { version: 9 }), // after this screen's state
    ];
    const { sync, changesSince } = fakeSync(changes);
    const { result, rerender } = renderHook((p: { version: number }) => useSharedCues({ kitchenId: "k1", meId: VERO.id, sync, version: p.version }), {
      wrapper,
      initialProps: { version: 3 },
    });
    await waitFor(() => expect(result.current.cues.since.map((e) => e.summary.params.name)).toEqual(["eggs"]));
    expect(changesSince).toHaveBeenCalledWith(1);
    // While the line shows, the stored version stays put, so a reload brings it back.
    rerender({ version: 5 });
    expect(readLastSeen("k1", VERO.id)).toBe(1);
    expect(changesSince).toHaveBeenCalledTimes(1);
    // Dismiss: gone, and the stored version catches up and then follows the screen.
    act(() => result.current.cues.dismissSince());
    expect(result.current.cues.since).toEqual([]);
    expect(readLastSeen("k1", VERO.id)).toBe(5);
    rerender({ version: 6 });
    expect(readLastSeen("k1", VERO.id)).toBe(6);
  });

  it("nothing from anyone else since then: no line, and the stored version follows the screen", async () => {
    writeLastSeen("k1", VERO.id, 1);
    const { sync, changesSince } = fakeSync([cs(VERO, [m("ITEM_ADDED", { name: "milk" })], { version: 2 })]);
    renderHook(() => useSharedCues({ kitchenId: "k1", meId: VERO.id, sync, version: 2 }), { wrapper });
    await waitFor(() => expect(readLastSeen("k1", VERO.id)).toBe(2));
    expect(changesSince).toHaveBeenCalledWith(1);
  });

  it("switching person on the same screen (dev bar) starts over for them, without marking their changes seen", async () => {
    // Regression: the switch re-rendered the same screen as Vero before reloading, which stored
    // Vero's version as the current one, so the reload had nothing to say about Levi's eggs.
    const { sync } = fakeSync([cs(LEVI, [m("ITEM_OUT", { name: "eggs" })], { version: 3 })]);
    const { result, rerender } = renderHook((p: { me: string }) => useSharedCues({ kitchenId: "k1", meId: p.me, sync, version: 3 }), {
      wrapper,
      initialProps: { me: LEVI.id },
    });
    writeLastSeen("k1", VERO.id, 2);
    rerender({ me: VERO.id });
    await waitFor(() => expect(result.current.cues.since.map((e) => e.summary.code)).toEqual(["ITEM_OUT"]));
    expect(readLastSeen("k1", VERO.id)).toBe(2);
  });

  it("if /changes fails there's just no line (0018)", async () => {
    writeLastSeen("k1", VERO.id, 1);
    const { sync, changesSince } = fakeSync(null);
    const { result } = renderHook(() => useSharedCues({ kitchenId: "k1", meId: VERO.id, sync, version: 3 }), { wrapper });
    await waitFor(() => expect(changesSince).toHaveBeenCalled());
    expect(result.current.cues.since).toEqual([]);
  });

  it("live: a sync that took items off the list says who used them up, until your next message", async () => {
    const { sync, changesSince } = fakeSync([cs(LEVI, [m("ITEM_LOW", { name: "milk" }), m("ITEM_OUT", { name: "eggs" })], { version: 6 })]);
    const { result } = renderHook(() => useSharedCues({ kitchenId: "k1", meId: VERO.id, sync, version: 6 }), { wrapper });
    const change: RemoteChange = { ids: ["milk"], actorNames: ["Levi"], removedIds: ["eggs"], fromVersion: 5, toVersion: 6 };
    let said: CueEntry[] | null = null;
    await act(async () => {
      said = await result.current.liveRemovals(change);
    });
    expect(changesSince).toHaveBeenCalledWith(5);
    expect(said!.map((e) => e.summary.code)).toEqual(["ITEM_OUT"]);
    expect(result.current.cues.live.map((e) => e.summary.params.name)).toEqual(["eggs"]);
    act(() => result.current.clearLive());
    expect(result.current.cues.live).toEqual([]);
  });
});
