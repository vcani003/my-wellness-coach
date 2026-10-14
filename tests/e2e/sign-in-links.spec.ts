/**
 * Invite links and passphrase sign-in (SU1 Rec), end to end against the second dev server
 * (tests/support/auth-server.ts): the real sign-in gate, and the real Vero and Levi from
 * `db:bootstrap` in a fresh database each run. axe at each step.
 *
 * - **Levi (phone only):** Vero signs in with her access code (the backup mode still works) and
 *   sends Levi a sign-in setup link; Levi opens it in a fresh browser, sets a passphrase, lands in
 *   the shared kitchen, signs out, and signs in with his name and passphrase. The used link then
 *   says calmly that it no longer works. Levi can only be set up once per database, hence one project.
 * - **Someone new (each project, a different name):** "Invite someone new" → join → the shared kitchen.
 * - **An unknown or expired link:** the same calm message (the server doesn't say which).
 * Set SIGNIN_SCREENSHOT=1 to save docs/design/screenshots/join-phone.png and settings-invite-phone.png.
 */
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { expectAccessible } from "../support/axe";
import { AUTH_BASE_URL, AUTH_TEST_ACCESS_CODE } from "../support/auth-server";

test.use({ baseURL: AUTH_BASE_URL });

const settingsLink = (page: Page, name: string) => page.getByRole("link", { name: `Settings, signed in as ${name}` });
const kitchenSettings = (page: Page) => page.getByRole("region", { name: "Kitchen" }).filter({ has: page.getByRole("heading", { level: 3 }) });
const screenshots = (testInfo: TestInfo) => Boolean(process.env.SIGNIN_SCREENSHOT) && testInfo.project.name === "phone";

async function hideDevBadge(page: Page) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

/** A fresh browser with the same device settings as this project (no cookies: a new person). */
async function freshPage(browser: Browser, testInfo: TestInfo): Promise<Page> {
  const use = testInfo.project.use;
  const context = await browser.newContext({
    baseURL: AUTH_BASE_URL,
    viewport: use.viewport,
    deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    userAgent: use.userAgent,
  });
  return context.newPage();
}

/** Vero, with the access code (the backup mode, still working). */
async function veroSignsInWithCode(page: Page) {
  await page.goto("/unlock");
  // The name field takes focus once the page has hydrated.
  await expect(page.getByLabel("Your name")).toBeFocused();
  await page.getByRole("button", { name: "Use an access code instead" }).click();
  const code = page.getByLabel("Access code", { exact: true });
  await expect(code).toBeFocused();
  await code.fill(AUTH_TEST_ACCESS_CODE);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(settingsLink(page, "Vero")).toBeVisible();
}

async function openSettings(page: Page, name: string) {
  await settingsLink(page, name).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { level: 2, name: "Settings" })).toBeVisible();
}

/** Opens a link sheet from Settings → Kitchen and returns the link it shows. */
async function makeLink(page: Page, button: string, sheetName: string, testInfo: TestInfo, screenshot?: string): Promise<string> {
  await kitchenSettings(page).getByRole("button", { name: button }).click();
  const sheet = page.getByRole("dialog", { name: sheetName });
  const link = sheet.getByTestId("invite-link");
  await expect(link).toHaveText(new RegExp(`^${AUTH_BASE_URL}/(join|reset)/[A-Za-z0-9_-]{43}$`));
  await expect(sheet).toContainText("Valid for 24 hours, works once.");
  await expect(sheet.getByRole("button", { name: "Copy link" })).toBeFocused();
  await expectAccessible(page, `link sheet: ${sheetName}`);
  if (screenshot && screenshots(testInfo)) {
    await hideDevBadge(page);
    await page.waitForTimeout(300); // the sheet's entry transition
    await page.screenshot({ path: screenshot });
  }
  const url = (await link.textContent())!.trim();
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toHaveCount(0);
  return url;
}

async function signInWithPassphrase(page: Page, name: string, passphrase: string) {
  const nameField = page.getByLabel("Your name");
  await expect(nameField).toBeFocused();
  await nameField.fill(name);
  await page.getByLabel("Passphrase", { exact: true }).fill(passphrase);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("Levi: a setup link from Vero → his own passphrase → the shared kitchen → sign out → sign in with name and passphrase", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "Levi's account can be set up once per test database");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: AUTH_BASE_URL });
  await veroSignsInWithCode(page);
  await openSettings(page, "Vero");
  await expect(kitchenSettings(page)).toContainText("Levi still signs in with an access code.");
  await expectAccessible(page, "settings: kitchen links");

  // Copy works where the clipboard is allowed.
  await kitchenSettings(page).getByRole("button", { name: "Send sign-in setup link to Levi" }).click();
  const sheet = page.getByRole("dialog", { name: "Sign-in setup link for Levi" });
  await expect(sheet.getByTestId("invite-link")).toBeVisible();
  await sheet.getByRole("button", { name: "Copy link" }).click();
  await expect(sheet.getByRole("status")).toHaveText("Copied.");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  await sheet.getByRole("button", { name: "Done" }).click();
  // Done gives focus back to the button that opened the sheet.
  await expect(kitchenSettings(page).getByRole("button", { name: "Send sign-in setup link to Levi" })).toBeFocused();

  const link = await makeLink(page, "Send sign-in setup link to Levi", "Sign-in setup link for Levi", testInfo, "docs/design/screenshots/settings-invite-phone.png");
  expect(link).not.toBe(copied); // every tap makes a new link
  expect(link).toContain("/reset/");

  // Levi, on his own phone.
  const levi = await freshPage(browser, testInfo);
  await levi.goto(link);
  await expect(levi.getByRole("heading", { level: 1, name: "Set your passphrase" })).toBeVisible();
  await expect(levi.getByText(/Hi Levi\./)).toBeVisible();
  const field = levi.getByLabel("New passphrase");
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("autocomplete", "new-password");
  await expectAccessible(levi, "reset link page");
  await field.fill("short");
  await expect(levi.getByText("7 more characters to go.")).toBeVisible();
  await field.fill("olive lemon window sill");
  await expect(levi.getByText("That's a strong passphrase.")).toBeVisible();
  await levi.getByRole("button", { name: "Save and sign in" }).click();

  // He keeps his account, in the shared kitchen.
  await expect(levi).toHaveURL(/\/$/);
  await expect(settingsLink(levi, "Levi")).toBeVisible();
  await openSettings(levi, "Levi");
  await expect(kitchenSettings(levi)).toContainText("Shared with Vero");
  await expect(levi.getByRole("region", { name: "Account" }).getByRole("button", { name: "Change passphrase" })).toBeVisible();
  await expectAccessible(levi, "Levi's settings");

  await levi.getByRole("region", { name: "Account" }).getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(levi).toHaveURL(/\/unlock$/);

  // A wrong passphrase: one calm, generic message.
  await signInWithPassphrase(levi, "levi", "olive lemon window sil");
  await expect(levi.getByRole("alert").filter({ hasText: "That name and passphrase didn't match." })).toBeVisible();
  await expectAccessible(levi, "unlock: wrong passphrase");
  await levi.getByLabel("Passphrase", { exact: true }).fill("olive lemon window sill");
  await levi.getByRole("button", { name: "Sign in" }).click();
  await expect(levi).toHaveURL(/\/$/);
  await expect(settingsLink(levi, "Levi")).toBeVisible();

  // The link worked once.
  await levi.goto(link);
  await expect(levi.getByRole("heading", { level: 1, name: "This link no longer works" })).toBeVisible();
  await expect(levi.getByText("Links work once and last 24 hours. Ask Vero for a new link.")).toBeVisible();
  await expectAccessible(levi, "used link");
  await levi.context().close();

  // Vero now sees that Levi has a passphrase.
  await page.reload();
  await expect(kitchenSettings(page).getByRole("button", { name: "Send passphrase reset link to Levi" })).toBeVisible();
  await expect(kitchenSettings(page).getByRole("button", { name: "Send sign-in setup link to Levi" })).toHaveCount(0);
});

test("someone new: Invite someone new → join with a name and passphrase → the shared kitchen", async ({ page, browser }, testInfo) => {
  const name = testInfo.project.name === "phone" ? "Sam" : "Ana";
  await veroSignsInWithCode(page);
  await openSettings(page, "Vero");
  const link = await makeLink(page, "Invite someone new", "Invite someone new", testInfo);
  expect(link).toContain("/join/");

  const guest = await freshPage(browser, testInfo);
  await guest.goto(link);
  await expect(guest.getByRole("heading", { level: 1, name: "Join Vero's kitchen" })).toBeVisible();
  const nameField = guest.getByLabel("Your name");
  await expect(nameField).toBeFocused();
  await expectAccessible(guest, "join link page");
  if (screenshots(testInfo)) {
    await hideDevBadge(guest);
    await guest.screenshot({ path: "docs/design/screenshots/join-phone.png" });
  }
  // A taken name keeps the link unused.
  await nameField.fill("Levi");
  await guest.getByLabel("Passphrase", { exact: true }).fill("pear fig walnut honey");
  await guest.getByRole("button", { name: "Join the kitchen" }).click();
  await expect(guest.getByRole("alert").filter({ hasText: "Someone already uses that name." })).toBeVisible();
  await expect(nameField).toBeFocused();
  await expectAccessible(guest, "join: name taken");
  await nameField.fill(name);
  await guest.getByRole("button", { name: "Join the kitchen" }).click();

  await expect(guest).toHaveURL(/\/$/);
  await expect(settingsLink(guest, name)).toBeVisible();
  await openSettings(guest, name);
  await expect(kitchenSettings(guest)).toContainText(/Shared with Vero(,| and) Levi/);

  await guest.goto(link);
  await expect(guest.getByRole("heading", { level: 1, name: "This link no longer works" })).toBeVisible();
  await guest.context().close();
});

test("an unknown or expired link: a calm message and a way to sign in", async ({ page }) => {
  for (const path of [`/join/${"a".repeat(43)}`, `/reset/${"b".repeat(43)}`]) {
    const res = await page.goto(path);
    expect(res?.headers()["referrer-policy"]).toBe("no-referrer");
    await expect(page.getByRole("heading", { level: 1, name: "This link no longer works" })).toBeVisible();
    await expect(page.getByText("Ask Vero for a new link.", { exact: false })).toBeVisible();
    await expectAccessible(page, `unknown link ${path.split("/")[1]}`);
  }
  await page.getByRole("link", { name: "Go to sign in" }).click();
  await expect(page).toHaveURL(/\/unlock$/);
  await expect(page.getByLabel("Your name")).toBeFocused();
});
