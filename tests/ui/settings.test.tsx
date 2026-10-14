// @vitest-environment jsdom
/**
 * Settings (ux.md §7; 0015, 0017, 0019 AI7) and the home "please confirm" banner:
 * sections and provenance; Confirm / Edit note / Remove for the owner only (others' allergies are
 * read-only); Sign out everywhere behind a confirm sheet; Delete my data guarded by the typed
 * phrase; "a former member" wherever a deleted person shows (D1).
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorRef } from "@/contracts/common";
import type { SettingsView } from "@/contracts/settings";
import { AnnouncerProvider } from "@/ui/a11y/Announcer";
import { useFormatMsg } from "@/ui/chat/format-msg";
import { actorName } from "@/ui/fallbacks";
import { ConfirmBanner, ConfirmPromptProvider, useConfirmPrompt } from "@/ui/settings/ConfirmPrompt";
import { pendingConfirms, resetDismissedForTests, type MemberRestrictions, type SettingsActions, type SettingsTapResult } from "@/ui/settings/model";
import { SettingsScreen } from "@/ui/settings/SettingsScreen";
import { KitchenActionsProvider, type KitchenActions } from "@/ui/sync/KitchenActionsContext";
import { KitchenDataProvider } from "@/ui/sync/KitchenDataContext";
import { KitchenWidget } from "@/ui/widgets/kitchen/KitchenWidget";
import { fakeActions, saved } from "../support/fake-actions";
import { IntlWrapper, renderWithIntl } from "../support/intl";
import { item, kitchen, LEVI, VERO } from "../support/kitchen-rows";

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), forward: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/settings" }));

const T0 = "2026-10-14T10:00:00.000Z";
const FORMER: ActorRef = { id: "gone", missing: true, former: true };

beforeEach(() => {
  window.sessionStorage.clear();
  resetDismissedForTests();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  router.push.mockReset();
  router.replace.mockReset();
});

/** Levi's settings: Vero added his seafood allergy (unconfirmed); he added his own diet. */
function leviView(overrides: Partial<SettingsView> = {}): SettingsView {
  return {
    me: { id: LEVI.id, name: "Levi" },
    kitchen: { id: "k1", name: "Our kitchen", isTest: false, version: 3 },
    members: [
      { id: VERO.id, name: "Vero", isYou: false },
      { id: LEVI.id, name: "Levi", isYou: true },
    ],
    restrictions: [
      {
        id: "r-seafood",
        kind: "allergy",
        subject: "seafood",
        note: "can eat shellfish if medicine is on hand",
        addedBy: VERO,
        addedAt: T0,
        addedByYou: false,
        verified: false,
      },
      { id: "r-veg", kind: "diet", subject: "vegetarian", addedBy: LEVI, addedAt: T0, addedByYou: true, verified: true, verifiedAt: T0 },
    ],
    preferences: [{ id: "p1", statement: "likes it spicy", savedAt: T0 }],
    ...overrides,
  };
}

/** Vero's settings, plus Levi's allergy read-only. */
function veroView(): SettingsView {
  return {
    ...leviView(),
    me: { id: VERO.id, name: "Vero" },
    members: [
      { id: VERO.id, name: "Vero", isYou: true },
      { id: LEVI.id, name: "Levi", isYou: false },
    ],
    restrictions: [],
    preferences: [],
  };
}
const leviForVero: MemberRestrictions = {
  member: { id: LEVI.id, name: "Levi" },
  restrictions: [{ id: "r-seafood", kind: "allergy", subject: "seafood", note: "can eat shellfish if medicine is on hand", addedBy: VERO, addedByOwner: false, verified: false }],
};

function verifiedResult(view: SettingsView): SettingsTapResult {
  const res = saved(kitchen([], 4), "RESTRICTION_VERIFIED");
  if (!res.ok) throw new Error("unreachable");
  res.result.applied[0].summary = { code: "RESTRICTION_VERIFIED", params: { name: "Levi", kind: "allergy", subject: "seafood" }, text: "" };
  return { ok: true, result: res.result, settings: view };
}

function fakeSettings(overrides: Partial<SettingsActions> = {}): SettingsActions {
  return {
    load: vi.fn(async () => leviView()),
    verify: vi.fn(async () => ({ ok: false as const, reason: { code: "SAVE_FAILED", params: {}, text: "x" }, retryable: true })),
    remove: vi.fn(async () => ({ ok: false as const, reason: { code: "SAVE_FAILED", params: {}, text: "x" }, retryable: true })),
    signOut: vi.fn(async () => {}),
    signOutEverywhere: vi.fn(async () => {}),
    ...overrides,
  };
}

/** Shows the banner's pending count, so a test can see Settings clear it. */
function PendingCount() {
  const { pending } = useConfirmPrompt();
  return <p data-testid="pending">{pending.length}</p>;
}

function show(
  view: SettingsView | null,
  opts: { actions?: SettingsActions; kitchenActions?: KitchenActions; others?: MemberRestrictions[]; fillComposer?: (t: string) => void } = {},
) {
  const actions = opts.actions ?? fakeSettings();
  const kitchenActions = opts.kitchenActions ?? fakeActions();
  renderWithIntl(
    <AnnouncerProvider>
      <KitchenActionsProvider value={kitchenActions}>
        <ConfirmPromptProvider initial={pendingConfirms(view)} fillComposer={opts.fillComposer ?? (() => {})}>
          <PendingCount />
          <SettingsScreen initial={view} others={opts.others ?? []} actions={actions} />
        </ConfirmPromptProvider>
      </KitchenActionsProvider>
    </AnnouncerProvider>,
  );
  return { actions, kitchenActions };
}

const section = (name: string) => screen.getByRole("region", { name });

describe("Settings sections", () => {
  it("shows account, kitchen, allergies with provenance, data and policy links; focus starts at the heading", () => {
    show(leviView());
    expect(screen.getByRole("heading", { level: 2, name: "Settings" })).toHaveFocus();
    expect(within(section("Account")).getByText("Levi")).toBeInTheDocument();
    expect(within(section("Account")).getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(within(section("Account")).getByRole("button", { name: "Sign out everywhere" })).toBeInTheDocument();
    expect(within(section("Kitchen")).getByText("Shared with Vero")).toBeInTheDocument();

    const remember = section("Allergies and preferences");
    const seafood = within(remember).getByText("Seafood").closest("li")!;
    expect(seafood).toHaveTextContent("Allergy");
    expect(seafood).toHaveTextContent("Note: can eat shellfish if medicine is on hand");
    expect(seafood).toHaveTextContent("Added by Vero, needs you to confirm");
    expect(within(seafood).getByRole("button", { name: "Confirm your seafood allergy" })).toBeInTheDocument();
    expect(within(seafood).getByRole("button", { name: "Edit note on your seafood allergy, in chat" })).toBeInTheDocument();
    expect(within(seafood).getByRole("button", { name: "Remove your seafood allergy" })).toBeInTheDocument();
    // Your own diet: no Confirm (nothing to confirm), still yours to change.
    const veg = within(remember).getByText("Vegetarian").closest("li")!;
    expect(veg).toHaveTextContent("Added by you");
    expect(within(veg).queryByRole("button", { name: /^Confirm/ })).toBeNull();
    expect(within(veg).getByRole("button", { name: "Remove your vegetarian diet" })).toBeInTheDocument();
    expect(within(remember).getByText("likes it spicy")).toBeInTheDocument();

    const data = section("Your data");
    expect(within(data).getByRole("link", { name: "Download my data" })).toHaveAttribute("href", "/api/me/export");
    expect(within(data).getByRole("button", { name: "Delete my data" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  });

  it("a failed load shows Try again, which loads it (0018)", async () => {
    const user = userEvent.setup();
    const { actions } = show(null);
    expect(screen.getByRole("alert")).toHaveTextContent("I couldn't load your settings just now.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(actions.load).toHaveBeenCalled();
    expect(await screen.findByText("Shared with Vero")).toBeInTheDocument();
  });
});

describe("Confirm / Edit note / Remove (AI7: owner only)", () => {
  it("Confirm verifies it, shows the receipt with Undo, and clears the home banner's count", async () => {
    const user = userEvent.setup();
    const confirmed = leviView();
    confirmed.restrictions[0] = { ...confirmed.restrictions[0], verified: true, verifiedAt: T0 };
    const actions = fakeSettings({ verify: vi.fn(async () => verifiedResult(confirmed)) });
    const { kitchenActions } = show(leviView(), { actions });
    expect(screen.getByTestId("pending")).toHaveTextContent("1");

    await user.click(screen.getByRole("button", { name: "Confirm your seafood allergy" }));
    expect(actions.verify).toHaveBeenCalledWith({ tapId: expect.any(String), restrictionId: "r-seafood" });
    expect(await screen.findByText("Confirmed Levi's allergy: seafood")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo: Confirmed Levi's allergy: seafood" })).toBeInTheDocument();
    expect(kitchenActions.showOwn).toHaveBeenCalled();
    expect(screen.getByText("Seafood").closest("li")).toHaveTextContent("Added by Vero · you confirmed it");
    expect(screen.queryByRole("button", { name: "Confirm your seafood allergy" })).toBeNull();
    expect(screen.getByTestId("pending")).toHaveTextContent("0");
  });

  it("a refused Remove says so in place and changes nothing", async () => {
    const user = userEvent.setup();
    show(leviView());
    await user.click(screen.getByRole("button", { name: "Remove your seafood allergy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("I couldn't save that, so nothing changed.");
    expect(screen.getByText("Seafood")).toBeInTheDocument();
  });

  it("Edit note opens the chat with the allergy named (fixed in chat, 0007)", async () => {
    const user = userEvent.setup();
    const fillComposer = vi.fn();
    show(leviView(), { fillComposer });
    await user.click(screen.getByRole("button", { name: "Edit note on your seafood allergy, in chat" }));
    expect(fillComposer).toHaveBeenCalledWith("My seafood allergy: ");
  });

  it("someone else's allergy is read-only: provenance, no buttons", () => {
    show(veroView(), { others: [leviForVero] });
    const remember = section("Allergies and preferences");
    expect(within(remember).getByText("Nothing saved yet.", { exact: false })).toBeInTheDocument();
    const levis = within(remember).getByText("Seafood").closest("li")!;
    expect(levis).toHaveTextContent("Added by you, needs Levi to confirm");
    expect(within(levis).queryAllByRole("button")).toHaveLength(0);
    expect(within(remember).getByText("Only Levi can change these.")).toBeInTheDocument();
  });
});

describe("Sign out and Delete my data", () => {
  it("Sign out everywhere asks first (focus on Cancel), then signs out", async () => {
    const user = userEvent.setup();
    const { actions } = show(leviView());
    await user.click(screen.getByRole("button", { name: "Sign out everywhere" }));
    const sheet = await screen.findByRole("dialog", { name: "Sign out everywhere?" });
    await waitFor(() => expect(within(sheet).getByRole("button", { name: "Cancel" })).toHaveFocus());
    await user.click(within(sheet).getByRole("button", { name: "Sign out everywhere" }));
    expect(actions.signOutEverywhere).toHaveBeenCalledTimes(1);
  });

  it("Cancel closes the sheet without signing out", async () => {
    const user = userEvent.setup();
    const { actions } = show(leviView());
    await user.click(screen.getByRole("button", { name: "Sign out everywhere" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(actions.signOutEverywhere).not.toHaveBeenCalled();
  });

  it("Delete is guarded by the typed phrase; a failure keeps the sheet open and says nothing was deleted", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    show(leviView());
    await user.click(screen.getByRole("button", { name: "Delete my data" }));
    const sheet = await screen.findByRole("dialog", { name: "Delete your data?" });
    expect(sheet).toHaveTextContent('credited to "a former member"');
    expect(sheet).toHaveTextContent("The kitchen itself stays until its last member leaves.");
    const field = within(sheet).getByLabelText('To confirm, type "delete my data"');
    await waitFor(() => expect(field).toHaveFocus());
    const confirm = within(sheet).getByRole("button", { name: "Delete my data" });

    expect(confirm).toHaveAttribute("aria-disabled", "true");
    await user.click(confirm);
    await user.type(field, "delete my dat");
    await user.click(confirm);
    expect(fetchMock).not.toHaveBeenCalled();

    await user.clear(field);
    await user.type(field, "  Delete My Data ");
    expect(confirm).not.toHaveAttribute("aria-disabled");
    await user.click(confirm);
    expect(fetchMock).toHaveBeenCalledWith("/api/me/delete", expect.objectContaining({ method: "POST", body: JSON.stringify({ confirm: "delete my data" }) }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("so nothing was deleted");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("a deleted account goes to /unlock; the last member is told the kitchen goes too", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    show(leviView({ members: [{ id: LEVI.id, name: "Levi", isYou: true }] }));
    await user.click(screen.getByRole("button", { name: "Delete my data" }));
    const sheet = await screen.findByRole("dialog", { name: "Delete your data?" });
    expect(sheet).toHaveTextContent("You're the kitchen's only member, so the kitchen is deleted too.");
    await user.type(within(sheet).getByRole("textbox"), "delete my data{Enter}");
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/unlock"));
  });
});

describe("the home banner (AI7)", () => {
  function banner(pending: ReturnType<typeof pendingConfirms>) {
    renderWithIntl(
      <ConfirmPromptProvider initial={pending} fillComposer={() => {}}>
        <ConfirmBanner />
      </ConfirmPromptProvider>,
    );
  }

  it("asks calmly and links to Settings; Not now hides it for the session", async () => {
    const user = userEvent.setup();
    banner(pendingConfirms(leviView()));
    const region = screen.getByRole("region", { name: "Please confirm" });
    expect(region).toHaveTextContent("Vero added your seafood allergy. Confirm or change it?");
    expect(within(region).getByRole("link", { name: "Confirm or change it?" })).toHaveAttribute("href", "/settings#settings-remember");
    await user.click(within(region).getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("region", { name: "Please confirm" })).toBeNull();
    expect(JSON.parse(window.sessionStorage.getItem("settings.confirmDismissed")!)).toEqual(["r-seafood"]);

    // Same session, another mount: still hidden.
    cleanup();
    banner(pendingConfirms(leviView()));
    expect(screen.queryByRole("region", { name: "Please confirm" })).toBeNull();
  });

  it("shows nothing when there's nothing to confirm, and counts several", () => {
    banner([]);
    expect(screen.queryByRole("region")).toBeNull();
    cleanup();
    banner([
      { id: "a", kind: "allergy", subject: "seafood", addedBy: VERO },
      { id: "b", kind: "diet", subject: "vegan", addedBy: FORMER },
    ]);
    expect(screen.getByRole("region", { name: "Please confirm" })).toHaveTextContent("Vero and a former member added 2 things to your profile.");
  });
});

describe('"a former member" (D1)', () => {
  it("actorName: a former member, an unknown person, a named one", () => {
    const t = (key: string) => ({ "fallback.formerMember": "a former member", "fallback.someone": "Someone" })[key] ?? key;
    expect(actorName(FORMER, t)).toBe("a former member");
    expect(actorName({ id: "x", missing: true }, t)).toBe("Someone");
    expect(actorName(VERO, t)).toBe("Vero");
  });

  it("a Kitchen row last changed by a deleted member says so", () => {
    const now = new Date("2026-10-15T10:00:00.000Z");
    const state = kitchen([item("i1", "eggs", { updatedBy: FORMER, createdBy: FORMER })]);
    renderWithIntl(
      <KitchenActionsProvider value={fakeActions()}>
        <KitchenDataProvider value={{ me: VERO, snapshot: { state, status: "ok", syncedAt: now.getTime() }, marks: {}, remoteIds: new Set(), now }}>
          <KitchenWidget onRetry={() => {}} />
        </KitchenDataProvider>
      </KitchenActionsProvider>,
    );
    expect(screen.getByText("Eggs").closest("li")).toHaveTextContent("A former member · ");
  });

  it("the receipt for a former member's profile change is translated", () => {
    const { result } = renderHook(() => useFormatMsg(), { wrapper: IntlWrapper });
    expect(result.current({ code: "FORMER_MEMBER_PROFILE", params: {}, text: "" })).toBe("Changed a former member's profile");
  });
});
