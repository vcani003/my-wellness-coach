/**
 * 0059 PF3 and PF6 on the FAKE interpreter, at phone and desktop size:
 * - PF3: on phone the chat starts Minimized (only the chat button) and opens when tapped; on
 *   desktop the chat column is open at launch, as before.
 * - PF6: the stand-in AI says so on screen, in the chat and (while minimized) in the header.
 * Set PF_SCREENSHOTS=1 to save docs/design/screenshots/pf-launch-<project>.png and pf-stand-in-phone.png.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "../support/axe";

const COOKIE = "dev_acting_as";

async function reset(page: Page, baseURL: string) {
  const res = await page.request.post("/api/dev/reset", { headers: { origin: baseURL } });
  expect(res.ok()).toBe(true);
  await page.context().addCookies([{ name: COOKIE, value: "demo-vero", url: baseURL }]);
}

const composer = (page: Page) => page.getByRole("textbox", { name: "Message Lumi" });
const chat = (page: Page) => page.getByRole("region", { name: "Chat" });
const header = (page: Page) => page.getByRole("banner");
const STAND_IN = "Stand-in AI · not Claude";

async function shot(page: Page, name: string) {
  if (process.env.PF_SCREENSHOTS) await page.screenshot({ path: `docs/design/screenshots/${name}` });
}

test("launch: phone starts Minimized and opens on tap; desktop starts open; the stand-in says so", async ({ page, baseURL }, testInfo) => {
  await reset(page, baseURL!);
  const phone = testInfo.project.name === "phone";
  // Read the server-rendered page before any script runs: no flash of an open dock on phone.
  await page.route("**/*.js", (route) => route.abort());
  await page.goto("/");
  if (phone) {
    await expect(page.getByRole("button", { name: "Open chat" })).toBeVisible();
    await expect(composer(page)).toBeHidden();
  } else {
    await expect(composer(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Open chat" })).toBeHidden();
  }
  await page.unroute("**/*.js");
  await page.goto("/");
  await expect(page.locator("#chat")).not.toHaveAttribute("data-dock", "launch");

  if (phone) {
    const fab = page.getByRole("button", { name: "Open chat" });
    await expect(fab).toBeVisible();
    await expect(composer(page)).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Places" })).toBeVisible();
    // Minimized: the header carries the stand-in label.
    await expect(header(page).getByText(STAND_IN)).toBeVisible();
    await expectAccessible(page, "phone launch, minimized");
    await shot(page, "pf-launch-phone.png");
    await fab.click();
    await expect(composer(page)).toBeFocused();
    await expect(header(page).getByText(STAND_IN)).toBeHidden();
  } else {
    await expect(composer(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Open chat" })).toBeHidden();
    await shot(page, "pf-launch-desktop.png");
  }
  // Open (Peek on phone, the column on desktop): the chat carries it.
  await expect(chat(page).getByText(STAND_IN)).toBeVisible();
  await expect(chat(page).getByText(STAND_IN)).toContainText("Replies are canned, for testing.");
  await expectAccessible(page, "chat open, stand-in label");
  if (phone) await shot(page, "pf-stand-in-phone.png"); // desktop's launch shot already shows it

  // Minimize again: still said, now in the header.
  await page.getByRole("button", { name: "Minimize chat" }).click();
  await expect(header(page).getByText(STAND_IN)).toBeVisible();
});
