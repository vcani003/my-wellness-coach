// @vitest-environment jsdom
/**
 * The /unlock form (backend-data.md §7; Clay & Honey restyle; SU1 Rec): name + passphrase by
 * default, "Use an access code instead" as the backup, Show/Hide, calm errors tied to the fields.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "../support/intl";

const unlock = vi.fn();
const signInWithPassphrase = vi.fn();
vi.mock("@/app/unlock/actions", () => ({ unlock: (...args: unknown[]) => unlock(...args) }));
vi.mock("@/app/unlock/passphrase-actions", () => ({ signInWithPassphrase: (...args: unknown[]) => signInWithPassphrase(...args) }));
const { UnlockForm } = await import("@/app/unlock/unlock-form");

afterEach(() => {
  cleanup();
  unlock.mockReset();
  signInWithPassphrase.mockReset();
});

const nameField = () => screen.getByLabelText("Your name");
const passField = () => screen.getByLabelText("Passphrase");
const codeField = () => screen.getByLabelText("Access code");

async function useCode() {
  await userEvent.click(screen.getByRole("button", { name: "Use an access code instead" }));
}

describe("UnlockForm: name + passphrase (default)", () => {
  it("starts in the name field, with password-manager-friendly fields", () => {
    renderWithIntl(<UnlockForm />);
    expect(screen.getByRole("heading", { level: 1, name: "Kitchen" })).toBeInTheDocument();
    expect(screen.getByText("Welcome in. Sign in with your name and passphrase.")).toBeInTheDocument();
    expect(nameField()).toHaveFocus();
    expect(nameField()).toHaveAttribute("autocomplete", "username");
    expect(passField()).toHaveAttribute("type", "password");
    expect(passField()).toHaveAttribute("autocomplete", "current-password");
    expect(passField()).toHaveAccessibleDescription("You'll stay signed in on this device.");
  });

  it("Show/Hide reveals the passphrase, and its name says what it will do", async () => {
    renderWithIntl(<UnlockForm />);
    await userEvent.type(passField(), "olive lemon window");
    await userEvent.click(screen.getByRole("button", { name: "Show passphrase" }));
    expect(passField()).toHaveAttribute("type", "text");
    await userEvent.click(screen.getByRole("button", { name: "Hide passphrase" }));
    expect(passField()).toHaveAttribute("type", "password");
  });

  it("empty fields: a calm error, no request, focus on what's missing", async () => {
    renderWithIntl(<UnlockForm />);
    await userEvent.type(nameField(), "Levi");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter your name and passphrase.");
    expect(passField()).toHaveFocus();
    expect(passField()).toHaveAttribute("aria-invalid", "true");
    expect(nameField()).not.toHaveAttribute("aria-invalid");
    expect(signInWithPassphrase).not.toHaveBeenCalled();
  });

  it("a wrong name or passphrase: one generic message, both kept, focus on the passphrase", async () => {
    signInWithPassphrase.mockResolvedValue({ ok: false, error: { key: "wrong" } });
    renderWithIntl(<UnlockForm />);
    await userEvent.type(nameField(), "Levi");
    await userEvent.type(passField(), "olive lemon windoe");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That name and passphrase didn't match. Check them and try again.");
    expect(signInWithPassphrase).toHaveBeenCalledWith({ name: "Levi", passphrase: "olive lemon windoe" });
    await waitFor(() => expect(passField()).toHaveFocus());
    expect(passField()).toHaveAccessibleDescription(/didn't match/);
    expect(passField()).toHaveValue("olive lemon windoe");
    expect(nameField()).toHaveValue("Levi");
  });

  it("too many tries says how long to wait; an unexpected failure stays calm", async () => {
    signInWithPassphrase.mockResolvedValueOnce({ ok: false, error: { key: "tooMany", minutes: 7 } }).mockRejectedValueOnce(new Error("network"));
    renderWithIntl(<UnlockForm />);
    await userEvent.type(nameField(), "Levi");
    await userEvent.type(passField(), "olive lemon window");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many tries. Please wait 7 min and try again.");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong. Please try again."));
  });
});

describe("UnlockForm: access code (backup)", () => {
  it("switching moves focus to the code field; switching back returns to the name field", async () => {
    renderWithIntl(<UnlockForm />);
    await useCode();
    expect(codeField()).toHaveFocus();
    expect(codeField()).toHaveAttribute("type", "password");
    expect(codeField()).toHaveAttribute("autocomplete", "current-password");
    expect(codeField()).toHaveAccessibleDescription("You'll stay signed in on this device.");
    expect(screen.getByText("Welcome in. Enter your access code to open your kitchen.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Use your name and passphrase instead" }));
    expect(nameField()).toHaveFocus();
  });

  it("Show/Hide reveals the code, and its name says what it will do", async () => {
    renderWithIntl(<UnlockForm />);
    await useCode();
    await userEvent.type(codeField(), "olive oil and lemons");
    await userEvent.click(screen.getByRole("button", { name: "Show access code" }));
    expect(codeField()).toHaveAttribute("type", "text");
    expect(codeField()).toHaveValue("olive oil and lemons");
    await userEvent.click(screen.getByRole("button", { name: "Hide access code" }));
    expect(codeField()).toHaveAttribute("type", "password");
  });

  it("a wrong code shows a calm error tied to the field, keeps what was typed, and refocuses", async () => {
    unlock.mockResolvedValue({ error: { key: "wrong" } });
    renderWithIntl(<UnlockForm />);
    await useCode();
    await userEvent.type(codeField(), "olive oil and lemonz");
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code didn't work. Check it and try again.");
    expect(codeField()).toHaveAttribute("aria-invalid", "true");
    expect(codeField()).toHaveAccessibleDescription(/That code didn't work/);
    await waitFor(() => expect(codeField()).toHaveFocus());
    expect(codeField()).toHaveValue("olive oil and lemonz");
    expect(unlock.mock.calls[0][1].get("code")).toBe("olive oil and lemonz");
  });
});
