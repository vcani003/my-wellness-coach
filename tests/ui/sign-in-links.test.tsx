// @vitest-environment jsdom
/**
 * Invite and reset links, and your passphrase (SU1 Rec): the /join and /reset forms, the calm
 * "This link no longer works" card, and Settings → Kitchen links (with Copy / Share) and
 * Settings → Account → Set / Change passphrase.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettingsView } from "@/contracts/settings";
import { AnnouncerProvider } from "@/ui/a11y/Announcer";
import { SetPassphraseForm, type LinkSubmitResult } from "@/ui/auth/SetPassphraseForm";
import { ConfirmPromptProvider } from "@/ui/settings/ConfirmPrompt";
import type { SettingsActions } from "@/ui/settings/model";
import { SettingsScreen } from "@/ui/settings/SettingsScreen";
import { KitchenActionsProvider } from "@/ui/sync/KitchenActionsContext";
import { fakeActions } from "../support/fake-actions";
import { renderWithIntl } from "../support/intl";

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), forward: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/settings" }));

const T0 = "2026-10-14T10:00:00.000Z";
const TOKEN = "a".repeat(43);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const passField = (label = "Passphrase") => screen.getByLabelText(label);

describe("/join/<token>", () => {
  type JoinSubmit = (input: { token: string; displayName: string; passphrase: string }) => Promise<LinkSubmitResult>;
  const join = (submit: ReturnType<typeof vi.fn<JoinSubmit>> = vi.fn<JoinSubmit>(async () => undefined)) => {
    renderWithIntl(<SetPassphraseForm mode="join" token={TOKEN} invitedBy="Vero" submit={submit} />);
    return submit;
  };

  it("says whose kitchen, starts in the name field, and the passphrase field is a new password with Show/Hide", async () => {
    join();
    expect(screen.getByRole("heading", { level: 1, name: "Join Vero's kitchen" })).toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toHaveFocus();
    expect(screen.getByLabelText("Your name")).toHaveAttribute("autocomplete", "username");
    expect(passField()).toHaveAttribute("autocomplete", "new-password");
    expect(passField()).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: "Show passphrase" }));
    expect(passField()).toHaveAttribute("type", "text");
  });

  it("the hint counts down to 12 characters, then says it works, and is never alarming", async () => {
    join();
    expect(passField()).toHaveAccessibleDescription(/At least 12 characters/);
    await userEvent.type(passField(), "olive");
    expect(passField()).toHaveAccessibleDescription(/7 more characters to go\./);
    await userEvent.type(passField(), " lemons");
    expect(passField()).toHaveAccessibleDescription(/That works\. Another word would make it even stronger\./);
    await userEvent.type(passField(), " window sill");
    expect(passField()).toHaveAccessibleDescription(/That's a strong passphrase\./);
    expect(document.body).not.toHaveTextContent(/weak/i);
  });

  it("too short is caught before sending, with focus on the passphrase", async () => {
    const submit = join();
    await userEvent.type(screen.getByLabelText("Your name"), "Sam");
    await userEvent.type(passField(), "short one");
    await userEvent.click(screen.getByRole("button", { name: "Join the kitchen" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Use at least 12 characters.");
    expect(passField()).toHaveFocus();
    expect(passField()).toHaveAttribute("aria-invalid", "true");
    expect(submit).not.toHaveBeenCalled();
  });

  it("sends the name and passphrase; a taken name puts focus back on the name, keeping both", async () => {
    const submit = vi.fn<JoinSubmit>(async () => ({ ok: false, error: { key: "nameTaken" } }));
    join(submit);
    await userEvent.type(screen.getByLabelText("Your name"), "Levi");
    await userEvent.type(passField(), "olive lemon window");
    await userEvent.click(screen.getByRole("button", { name: "Join the kitchen" }));
    expect(submit).toHaveBeenCalledWith({ token: TOKEN, displayName: "Levi", passphrase: "olive lemon window" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Someone already uses that name.");
    await waitFor(() => expect(screen.getByLabelText("Your name")).toHaveFocus());
    expect(screen.getByLabelText("Your name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Your name")).toHaveAccessibleDescription(/already uses that name/);
    expect(passField()).toHaveValue("olive lemon window");
  });

  it("a link that stopped working meanwhile turns into the calm card, focused", async () => {
    join(vi.fn<JoinSubmit>(async () => ({ ok: false, error: { key: "invalidLink" } })));
    await userEvent.type(screen.getByLabelText("Your name"), "Sam");
    await userEvent.type(passField(), "olive lemon window");
    await userEvent.click(screen.getByRole("button", { name: "Join the kitchen" }));
    expect(await screen.findByRole("heading", { level: 1, name: "This link no longer works" })).toBeInTheDocument();
    expect(screen.getByText("Links work once and last 24 hours. Ask Vero for a new link.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/unlock");
    await waitFor(() => expect(document.activeElement).toContainElement(screen.getByRole("heading", { level: 1 })));
  });
});

describe("/reset/<token>", () => {
  it("'Set your passphrase' for the named member, a hidden username for password managers, then acceptReset", async () => {
    const submit = vi.fn(async () => undefined);
    renderWithIntl(<SetPassphraseForm mode="reset" token={TOKEN} forName="Levi" submit={submit} />);
    expect(screen.getByRole("heading", { level: 1, name: "Set your passphrase" })).toBeInTheDocument();
    expect(screen.getByText(/You'll sign in with your name, Levi, and this passphrase\./)).toBeInTheDocument();
    expect(screen.queryByLabelText("Your name")).toBeNull();
    expect(document.querySelector('input[autocomplete="username"]')).toHaveValue("Levi");
    expect(passField("New passphrase")).toHaveFocus();
    expect(passField("New passphrase")).toHaveAttribute("autocomplete", "new-password");
    await userEvent.type(passField("New passphrase"), "olive lemon window");
    await userEvent.click(screen.getByRole("button", { name: "Save and sign in" }));
    expect(submit).toHaveBeenCalledWith({ token: TOKEN, passphrase: "olive lemon window" });
    // Success redirects (server side); the button stays busy meanwhile.
    expect(screen.queryByRole("alert")).toHaveTextContent("");
  });
});

// ─── Settings ──────────────────────────────────────────────────────────────────────────

function veroView(overrides: Partial<SettingsView> = {}): SettingsView {
  return {
    me: { id: "vero", name: "Vero" },
    kitchen: { id: "home", name: "Home", isTest: false, version: 1 },
    members: [
      { id: "vero", name: "Vero", isYou: true, hasPassphrase: false },
      { id: "levi", name: "Levi", isYou: false, hasPassphrase: false },
    ],
    restrictions: [],
    preferences: [],
    accountsFull: false,
    ...overrides,
  };
}

function fakeSettings(overrides: Partial<SettingsActions> = {}): SettingsActions {
  return {
    load: vi.fn(async () => veroView()),
    verify: vi.fn(),
    remove: vi.fn(),
    signOut: vi.fn(async () => {}),
    signOutEverywhere: vi.fn(async () => {}),
    createInvite: vi.fn(async () => ({ ok: true as const, path: `/join/${TOKEN}`, expiresAt: T0 })),
    createResetLink: vi.fn(async () => ({ ok: true as const, path: `/reset/${TOKEN}`, expiresAt: T0 })),
    changePassphrase: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  } as SettingsActions;
}

function show(view: SettingsView, actions = fakeSettings()) {
  renderWithIntl(
    <AnnouncerProvider>
      <KitchenActionsProvider value={fakeActions()}>
        <ConfirmPromptProvider initial={[]} fillComposer={() => {}}>
          <SettingsScreen initial={view} others={[]} actions={actions} />
        </ConfirmPromptProvider>
      </KitchenActionsProvider>
    </AnnouncerProvider>,
  );
  return actions;
}

const kitchenSection = () => screen.getByRole("region", { name: "Kitchen" });
const accountSection = () => screen.getByRole("region", { name: "Account" });

describe("Settings → Kitchen: sign-in links", () => {
  it("a member without a passphrase gets a setup link (a reset link, so the account is kept)", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const actions = show(veroView());
    expect(kitchenSection()).toHaveTextContent("Levi still signs in with an access code.");
    await userEvent.click(within(kitchenSection()).getByRole("button", { name: "Send sign-in setup link to Levi" }));

    const sheet = await screen.findByRole("dialog", { name: "Sign-in setup link for Levi" });
    expect(sheet).toHaveAccessibleDescription(/lets Levi choose a passphrase and keep this account/);
    expect(actions.createResetLink).toHaveBeenCalledTimes(1);
    expect(actions.createResetLink).toHaveBeenCalledWith({ userId: "levi" });
    expect(actions.createInvite).not.toHaveBeenCalled();
    expect(await within(sheet).findByTestId("invite-link")).toHaveTextContent(`${window.location.origin}/reset/${TOKEN}`);
    expect(sheet).toHaveTextContent("Valid for 24 hours, works once.");
    const copy = within(sheet).getByRole("button", { name: "Copy link" });
    await waitFor(() => expect(copy).toHaveFocus());

    await userEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/reset/${TOKEN}`);
    expect(within(sheet).getByRole("status")).toHaveTextContent("Copied.");
    // No Web Share API in this browser: no Share button.
    expect(within(sheet).queryByRole("button", { name: "Share…" })).toBeNull();

    // Closing forgets the link; nothing is kept on the phone.
    await userEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body).not.toHaveTextContent(TOKEN);
    expect(JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage })).not.toContain(TOKEN);
  });

  it("Share uses the system share sheet where it exists; a refused copy says to press and hold", async () => {
    const share = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, share, clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) } });
    show(veroView());
    await userEvent.click(within(kitchenSection()).getByRole("button", { name: "Send sign-in setup link to Levi" }));
    const sheet = await screen.findByRole("dialog");
    await within(sheet).findByTestId("invite-link");
    await userEvent.click(within(sheet).getByRole("button", { name: "Share…" }));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: `${window.location.origin}/reset/${TOKEN}` }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Copy link" }));
    expect(within(sheet).getByRole("status")).toHaveTextContent("Couldn't copy. Press and hold the link to copy it.");
  });

  it("a member who has a passphrase gets a reset link instead", async () => {
    const actions = show(veroView({ members: [veroView().members[0], { id: "levi", name: "Levi", isYou: false, hasPassphrase: true }] }));
    expect(kitchenSection()).not.toHaveTextContent("still signs in with an access code");
    expect(within(kitchenSection()).queryByRole("button", { name: "Send sign-in setup link to Levi" })).toBeNull();
    await userEvent.click(within(kitchenSection()).getByRole("button", { name: "Send passphrase reset link to Levi" }));
    expect(await screen.findByRole("dialog", { name: "Passphrase reset link for Levi" })).toBeInTheDocument();
    expect(actions.createResetLink).toHaveBeenCalledWith({ userId: "levi" });
  });

  it("Invite someone new makes a join link", async () => {
    const actions = show(veroView());
    const invite = within(kitchenSection()).getByRole("button", { name: "Invite someone new" });
    expect(invite).toHaveAccessibleDescription(/isn't in the app yet/);
    await userEvent.click(invite);
    const sheet = await screen.findByRole("dialog", { name: "Invite someone new" });
    expect(await within(sheet).findByTestId("invite-link")).toHaveTextContent(`/join/${TOKEN}`);
    expect(actions.createInvite).toHaveBeenCalledWith({ purpose: "join" });
    expect(actions.createResetLink).not.toHaveBeenCalled();
  });

  it("at the 4-account cap there's no invite button, just the reason", () => {
    show(veroView({ accountsFull: true }));
    expect(within(kitchenSection()).queryByRole("button", { name: "Invite someone new" })).toBeNull();
    expect(kitchenSection()).toHaveTextContent("The app has 4 accounts, the most it allows, so there's no room to invite someone new.");
    // A setup link for an existing member still works at the cap.
    expect(within(kitchenSection()).getByRole("button", { name: "Send sign-in setup link to Levi" })).toBeInTheDocument();
  });

  it("a failure says so plainly with Try again, which makes a new link", async () => {
    const createResetLink = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: { key: "tooMany" } })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true, path: `/reset/${TOKEN}`, expiresAt: T0 });
    show(veroView(), fakeSettings({ createResetLink }));
    await userEvent.click(within(kitchenSection()).getByRole("button", { name: "Send sign-in setup link to Levi" }));
    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("That's a lot of links for one day. Try again tomorrow.");
    await userEvent.click(within(sheet).getByRole("button", { name: "Try again" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("I couldn't make a link just now. Try again.");
    await userEvent.click(within(sheet).getByRole("button", { name: "Try again" }));
    expect(await within(sheet).findByTestId("invite-link")).toBeInTheDocument();
    expect(createResetLink).toHaveBeenCalledTimes(3);
  });

  it("test kitchens can't make links, so they say so instead", () => {
    show(veroView({ kitchen: { id: "t", name: "Test", isTest: true, version: 1 } }));
    expect(within(kitchenSection()).queryByRole("button")).toBeNull();
    expect(kitchenSection()).toHaveTextContent("Sign-in links aren't available in test kitchens.");
  });
});

describe("Settings → Account: your passphrase", () => {
  it("the first time: 'Set your passphrase', checked against your access code; then it reads 'Change passphrase'", async () => {
    const actions = show(veroView(), fakeSettings({ load: vi.fn(async () => null) }));
    const button = within(accountSection()).getByRole("button", { name: "Set your passphrase" });
    expect(button).toHaveAccessibleDescription(/instead of the access code/);
    await userEvent.click(button);
    const sheet = await screen.findByRole("dialog", { name: "Set your passphrase" });
    const code = within(sheet).getByLabelText("Your access code");
    await waitFor(() => expect(code).toHaveFocus());
    expect(code).toHaveAttribute("autocomplete", "current-password");
    expect(within(sheet).getByLabelText("New passphrase")).toHaveAttribute("autocomplete", "new-password");
    expect(sheet).not.toHaveTextContent("other devices will be signed out");

    await userEvent.type(code, "my access code 1");
    await userEvent.type(within(sheet).getByLabelText("New passphrase"), "olive lemon window");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save passphrase" }));
    expect(actions.changePassphrase).toHaveBeenCalledWith({ current: "my access code 1", next: "olive lemon window" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(accountSection()).getByRole("status")).toHaveTextContent("Passphrase saved.");
    expect(within(accountSection()).getByRole("button", { name: "Change passphrase" })).toBeInTheDocument();
  });

  it("changing: a wrong current passphrase keeps the sheet open, focus on the field to fix", async () => {
    const changePassphrase = vi.fn(async () => ({ ok: false as const, error: { key: "wrong" as const } }));
    show(veroView({ members: [{ id: "vero", name: "Vero", isYou: true, hasPassphrase: true }] }), fakeSettings({ changePassphrase }));
    await userEvent.click(within(accountSection()).getByRole("button", { name: "Change passphrase" }));
    const sheet = await screen.findByRole("dialog", { name: "Change passphrase" });
    expect(sheet).toHaveTextContent("Your other devices will be signed out. This one stays signed in.");
    const current = within(sheet).getByLabelText("Current passphrase");
    await userEvent.type(current, "olive lemon windoe");
    await userEvent.type(within(sheet).getByLabelText("New passphrase"), "pear fig walnut honey");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save passphrase" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("That didn't match your current passphrase.");
    await waitFor(() => expect(current).toHaveFocus());
    expect(current).toHaveAttribute("aria-invalid", "true");
    expect(current).toHaveValue("olive lemon windoe");
  });

  it("a too-short new passphrase is caught before sending", async () => {
    const actions = show(veroView());
    await userEvent.click(within(accountSection()).getByRole("button", { name: "Set your passphrase" }));
    const sheet = await screen.findByRole("dialog");
    await userEvent.type(within(sheet).getByLabelText("Your access code"), "my access code 1");
    await userEvent.type(within(sheet).getByLabelText("New passphrase"), "too short");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save passphrase" }));
    expect(within(sheet).getByRole("alert")).toHaveTextContent("Use at least 12 characters.");
    expect(within(sheet).getByLabelText("New passphrase")).toHaveFocus();
    expect(actions.changePassphrase).not.toHaveBeenCalled();
  });
});
