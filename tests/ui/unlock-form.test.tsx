// @vitest-environment jsdom
/** The /unlock form (backend-data.md §7; Clay & Honey restyle): field, Show/Hide, calm error. */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "../support/intl";

const unlock = vi.fn();
vi.mock("@/app/unlock/actions", () => ({ unlock: (...args: unknown[]) => unlock(...args) }));
const { UnlockForm } = await import("@/app/unlock/unlock-form");

afterEach(() => {
  cleanup();
  unlock.mockReset();
});

const field = () => screen.getByLabelText("Access code");

describe("UnlockForm", () => {
  it("focuses a password-manager-friendly field at load", () => {
    renderWithIntl(<UnlockForm />);
    expect(screen.getByRole("heading", { level: 1, name: "Kitchen" })).toBeInTheDocument();
    expect(field()).toHaveFocus();
    expect(field()).toHaveAttribute("type", "password");
    expect(field()).toHaveAttribute("autocomplete", "current-password");
    expect(field()).toHaveAccessibleDescription("You'll stay signed in on this device.");
  });

  it("Show/Hide reveals the code, and its name says what it will do", async () => {
    renderWithIntl(<UnlockForm />);
    await userEvent.type(field(), "olive oil and lemons");
    await userEvent.click(screen.getByRole("button", { name: "Show access code" }));
    expect(field()).toHaveAttribute("type", "text");
    expect(field()).toHaveValue("olive oil and lemons");
    await userEvent.click(screen.getByRole("button", { name: "Hide access code" }));
    expect(field()).toHaveAttribute("type", "password");
  });

  it("a wrong code shows a calm error tied to the field, keeps what was typed, and refocuses", async () => {
    unlock.mockResolvedValue({ error: { key: "wrong" } });
    renderWithIntl(<UnlockForm />);
    await userEvent.type(field(), "olive oil and lemonz");
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code didn't work. Check it and try again.");
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveAccessibleDescription(/That code didn't work/);
    await waitFor(() => expect(field()).toHaveFocus());
    expect(field()).toHaveValue("olive oil and lemonz");
    expect(unlock.mock.calls[0][1].get("code")).toBe("olive oil and lemonz");
  });
});
