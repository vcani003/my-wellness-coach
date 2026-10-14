/**
 * The /unlock page (backend-data.md §7, Clay & Honey restyle; SU1 Rec): name + passphrase by
 * default and "Use an access code instead", Show/Hide, errors tied to the fields, and axe. Uses
 * the empty-field errors so it needs no accounts (signing in for real is in sign-in-links.spec.ts).
 * Set UNLOCK_SCREENSHOT=1 to save docs/design/screenshots/unlock-phone.png (phone project).
 */
import { expect, test } from "@playwright/test";
import { expectAccessible } from "../support/axe";

test("unlock: name + passphrase first, then the access code backup, each with Show/Hide and a calm error", async ({ page }, testInfo) => {
  await page.goto("/unlock");
  const name = page.getByLabel("Your name");
  const passphrase = page.getByLabel("Passphrase", { exact: true });
  await expect(page.getByRole("heading", { level: 1, name: "Kitchen" })).toBeVisible();
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("autocomplete", "username");
  await expect(passphrase).toHaveAttribute("type", "password");
  await expect(passphrase).toHaveAttribute("autocomplete", "current-password");
  await expect(page.getByText("You'll stay signed in on this device.")).toBeVisible();
  await expectAccessible(page, "unlock: passphrase");
  if (process.env.UNLOCK_SCREENSHOT && testInfo.project.name === "phone") {
    await page.addStyleTag({ content: "nextjs-portal { display: none; }" }); // hide the dev-only Next badge
    await page.screenshot({ path: "docs/design/screenshots/unlock-phone.png" });
  }

  await passphrase.fill("olive lemon window");
  await page.getByRole("button", { name: "Show passphrase" }).click();
  await expect(passphrase).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide passphrase" }).click();
  await expect(passphrase).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Enter your name and passphrase." })).toBeVisible();
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expectAccessible(page, "unlock: passphrase error");

  await page.getByRole("button", { name: "Use an access code instead" }).click();
  const field = page.getByLabel("Access code", { exact: true });
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("type", "password");
  await expect(field).toHaveAttribute("autocomplete", "current-password");

  await field.fill("olive oil and lemons");
  await page.getByRole("button", { name: "Show access code" }).click();
  await expect(field).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide access code" }).click();
  await expect(field).toHaveAttribute("type", "password");

  await field.fill("");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Enter your access code." })).toBeVisible();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription(/Enter your access code\./);
  await expect(field).toBeFocused();
  await expectAccessible(page, "unlock: code error");

  await page.getByRole("button", { name: "Use your name and passphrase instead" }).click();
  await expect(name).toBeFocused();
});
