/**
 * The /unlock page (backend-data.md §7, Clay & Honey restyle): the field, Show/Hide, an error
 * tied to the field, and axe. Uses the empty-code error so it needs no access codes or database.
 * Set UNLOCK_SCREENSHOT=1 to save docs/design/screenshots/unlock-phone.png (phone project).
 */
import { expect, test } from "@playwright/test";
import { expectAccessible } from "../support/axe";

test("unlock: focused field, Show/Hide, and a calm error for an empty code", async ({ page }, testInfo) => {
  await page.goto("/unlock");
  const field = page.getByLabel("Access code", { exact: true });
  await expect(page.getByRole("heading", { level: 1, name: "Kitchen" })).toBeVisible();
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("type", "password");
  await expect(field).toHaveAttribute("autocomplete", "current-password");
  await expect(page.getByText("You'll stay signed in on this device.")).toBeVisible();
  await expectAccessible(page, "unlock");
  if (process.env.UNLOCK_SCREENSHOT && testInfo.project.name === "phone") {
    await page.addStyleTag({ content: "nextjs-portal { display: none; }" }); // hide the dev-only Next badge
    await page.screenshot({ path: "docs/design/screenshots/unlock-phone.png" });
  }

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
  await expectAccessible(page, "unlock error");
});
