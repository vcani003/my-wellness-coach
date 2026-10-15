/**
 * Settings (ux.md §7; 0015, 0017, 0019 AI7) at phone and desktop size, with axe at each step.
 * The demo seed has Vero saving Levi's seafood allergy, so Levi sees the home banner and confirms
 * it in Settings, while Vero sees it read-only. Delete my data is checked up to the request (the
 * endpoint is stubbed, so the shared demo kitchen survives); Sign out everywhere runs for real.
 * Set SETTINGS_SCREENSHOT=1 to save docs/design/screenshots/settings-phone.png.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "../support/axe";

const COOKIE = "dev_acting_as";

async function resetAndActAs(page: Page, baseURL: string, userId: "demo-vero" | "demo-levi") {
  const res = await page.request.post("/api/dev/reset", { headers: { origin: baseURL } });
  expect(res.ok()).toBe(true);
  await page.context().addCookies([{ name: COOKIE, value: userId, url: baseURL }]);
  await page.goto("/");
}

const remember = (page: Page) => page.getByRole("region", { name: "Allergies and preferences" });
const banner = (page: Page) => page.getByRole("region", { name: "Please confirm" });

/** Opens Settings from the header avatar, retrying until the page has hydrated. */
async function openSettings(page: Page, name: string) {
  await page.getByRole("link", { name: `Settings, signed in as ${name}` }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { level: 2, name: "Settings" })).toBeVisible();
}

test("Levi: the home banner → Settings → Confirm (with Undo) → Remove; the chat dock stays", async ({ page, baseURL }, testInfo) => {
  const isPhone = testInfo.project.name === "phone";
  await resetAndActAs(page, baseURL!, "demo-levi");

  await expect(banner(page)).toContainText("Vero added your seafood allergy.");
  await expectAccessible(page, "home with the confirm banner");
  await banner(page).getByRole("link", { name: "Confirm or change it?" }).click();
  await expect(page).toHaveURL(/\/settings#settings-remember$/);
  // Straight to the allergy that needs confirming.
  await expect(page.getByRole("heading", { level: 3, name: "Allergies and preferences" })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Message Lumi" })).toBeVisible();

  await expect(page.getByRole("region", { name: "Kitchen" })).toContainText("Shared with Vero");
  const seafood = remember(page).getByRole("listitem").filter({ hasText: "Seafood" });
  await expect(seafood).toContainText("Added by Vero, needs you to confirm");
  await expect(seafood).toContainText("Note: can eat shellfish if medicine is on hand");
  await expectAccessible(page, "settings");
  if (process.env.SETTINGS_SCREENSHOT && isPhone) {
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.getByRole("button", { name: "Minimize chat" }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: "docs/design/screenshots/settings-phone.png" });
    await page.getByRole("button", { name: /^Open chat/ }).click();
  }

  await seafood.getByRole("button", { name: "Confirm your seafood allergy" }).click();
  await expect(remember(page)).toContainText("Confirmed Levi's allergy: seafood");
  await expect(seafood).toContainText("Added by Vero · you confirmed it");
  await expect(seafood.getByRole("button", { name: "Confirm your seafood allergy" })).toHaveCount(0);
  await expectAccessible(page, "settings after Confirm");

  // Undo puts it back to "needs you to confirm".
  await remember(page).getByRole("button", { name: "Undo: Confirmed Levi's allergy: seafood" }).click();
  await expect(remember(page)).toContainText("Undone.");
  await expect(seafood).toContainText("Added by Vero, needs you to confirm");

  // Remove: gone from Settings, and the banner has nothing left to ask.
  await seafood.getByRole("button", { name: "Remove your seafood allergy" }).click();
  await expect(remember(page)).toContainText("Removed Levi's allergy: seafood");
  await expect(remember(page).getByRole("listitem").filter({ hasText: "Seafood" })).toHaveCount(0);
  await page.getByRole("button", { name: "Back to your kitchen" }).click();
  await expect(page).toHaveURL(/\/$/);
  // Home is Today (0042), where the banner was.
  await expect(page.getByRole("region", { name: "Today" })).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
});

test("Levi: Not now hides the banner for the session", async ({ page, baseURL }) => {
  await resetAndActAs(page, baseURL!, "demo-levi");
  await banner(page).getByRole("button", { name: "Not now" }).click();
  await expect(banner(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Message Lumi" })).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
});

test("Vero: Levi's allergy is read-only; policies open from Settings", async ({ page, baseURL }) => {
  await resetAndActAs(page, baseURL!, "demo-vero");
  await expect(banner(page)).toHaveCount(0);
  await openSettings(page, "Vero");
  const levis = remember(page).getByRole("listitem").filter({ hasText: "Seafood" });
  await expect(levis).toContainText("Added by you, needs Levi to confirm");
  await expect(levis.getByRole("button")).toHaveCount(0);
  await expect(remember(page)).toContainText("Only Levi can change these.");
  await expectAccessible(page, "settings as a non-owner");

  await page.getByRole("link", { name: "Privacy policy" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("needs a real review before the app opens to the public");
  await expect(page.getByRole("heading", { level: 2, name: "AI processing" })).toBeVisible();
  await expectAccessible(page, "privacy policy");
  await page.getByRole("link", { name: "Back to Settings" }).click();
  await page.getByRole("link", { name: "Terms" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Terms" })).toBeVisible();
  await expectAccessible(page, "terms");
});

test("Vero: Delete my data waits for the typed phrase, then sends it and goes to /unlock", async ({ page, baseURL }) => {
  await resetAndActAs(page, baseURL!, "demo-vero");
  const sent: unknown[] = [];
  await page.route("**/api/me/delete", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await openSettings(page, "Vero");
  await page.getByRole("button", { name: "Delete my data" }).click();
  const sheet = page.getByRole("dialog", { name: "Delete your data?" });
  await expect(sheet).toContainText('credited to "a former member"');
  const field = sheet.getByRole("textbox", { name: 'To confirm, type "delete my data"' });
  await expect(field).toBeFocused();
  const confirm = sheet.getByRole("button", { name: "Delete my data" });
  await expect(confirm).toBeDisabled();
  await expectAccessible(page, "delete sheet");

  await field.fill("delete my");
  await confirm.click({ force: true });
  expect(sent).toEqual([]);
  await field.fill("delete my data");
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page).toHaveURL(/\/unlock$/);
  expect(sent).toEqual([{ confirm: "delete my data" }]);
});

test("Vero: Sign out everywhere asks first, then goes to /unlock", async ({ page, baseURL }) => {
  await resetAndActAs(page, baseURL!, "demo-vero");
  await openSettings(page, "Vero");
  await page.getByRole("button", { name: "Sign out everywhere" }).click();
  const sheet = page.getByRole("dialog", { name: "Sign out everywhere?" });
  await expect(sheet.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expectAccessible(page, "sign out everywhere sheet");
  // Regression: Cancel used to leave the sheet's backdrop behind, blocking every tap after it.
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out everywhere" }).click({ timeout: 5_000 });
  await sheet.getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(page).toHaveURL(/\/unlock$/);
  await expect(page.getByLabel("Your name")).toBeVisible();
});
