/**
 * The dated week plan (0045 KOS1, 0058) and "Add this week's missing ingredients" (KOS12) on the
 * FAKE interpreter, at phone and desktop size, with axe at each step and with the sheet open:
 * the stand-in's "sample recipe for chicken curry" (0059 PF10) → Add to plan → the Plan shows it under "No day yet" with an empty week →
 * Pick a day: Tomorrow → it moves into tomorrow's row with the receipt and Undo → Undo puts it
 * back → set it again → the week-needs sheet: Need items pre-selected, Dated only → Add → one
 * receipt with Undo under the pill, the items on the List.
 * Set WEEK_PLAN_SCREENSHOTS=1 to save docs/design/screenshots/week-plan-*.png and week-needs-*.png.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "../support/axe";
import { goTo, openChat } from "../support/places";

const COOKIE = "dev_acting_as";

async function resetAndActAs(page: Page, baseURL: string, path: string) {
  const res = await page.request.post("/api/dev/reset", { headers: { origin: baseURL } });
  expect(res.ok()).toBe(true);
  await page.context().addCookies([{ name: COOKIE, value: "demo-vero", url: baseURL }]);
  await page.goto(path);
  await openChat(page);
}

const composer = (page: Page) => page.getByRole("textbox", { name: "Message Lumi" });
const recipe = (page: Page) => page.getByRole("article");
/** The stand-in's sample (0059 PF10). */
const CURRY = "Sample recipe (stand-in): Chicken curry";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const lastReceipt = (page: Page) => page.getByRole("region", { name: "What changed" }).last();
const week = (page: Page) => page.getByRole("region", { name: "The next 7 days" });

async function say(page: Page, text: string) {
  await expect(async () => {
    await composer(page).fill(text);
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled({ timeout: 500 });
  }).toPass();
  await composer(page).press("Enter");
}

async function shoot(page: Page, file: string) {
  if (!process.env.WEEK_PLAN_SCREENSHOTS) return;
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `docs/design/screenshots/${file}` });
}

test("week plan: set a day → it moves → Undo; then add the week's missing ingredients", async ({ page, baseURL }, testInfo) => {
  const phone = testInfo.project.name === "phone";
  const size = phone ? "phone" : "desktop";
  await resetAndActAs(page, baseURL!, "/meals");

  // The stand-in's sample recipe (0059 PF10; a named dish needs the real AI): its Recipe opens
  // with a Need list; add it to the plan (no day).
  await say(page, "I bought chicken thighs");
  await expect(lastReceipt(page)).toContainText("Added chicken thighs");
  await say(page, "make me a sample recipe for chicken curry");
  await expect(recipe(page).getByRole("heading", { level: 2, name: CURRY })).toBeVisible();
  await recipe(page).getByRole("button", { name: "Add to plan" }).click();
  await expect(recipe(page)).toContainText("In your plan");
  await recipe(page).getByRole("button", { name: "Back" }).click();
  await goTo(page, "Plan");

  // Every existing kitchen is undated: "No day yet" leads, then 7 quiet days, Today first.
  const undated = page.getByRole("region", { name: "No day yet" });
  await expect(undated.getByRole("button", { name: `${CURRY}: open recipe` })).toBeVisible();
  await expect(week(page).getByRole("heading", { level: 3 })).toHaveCount(7);
  await expect(week(page).getByRole("heading", { level: 3 }).first()).toHaveText(/^Today, /);
  await expect(week(page).getByText("Nothing planned")).toHaveCount(7);
  await expectAccessible(page, "week plan, all undated");
  if (phone) await shoot(page, "week-plan-undated-phone.png");

  // Pick a day: Tomorrow → it moves into tomorrow's row, with the receipt and Undo there.
  await page.getByRole("button", { name: `Pick a day for ${CURRY}` }).click();
  await expect(page.getByRole("group", { name: "Which day?" })).toBeVisible();
  await expectAccessible(page, "day menu open");
  await page.getByRole("menuitemradio", { name: /^Tomorrow · / }).click();
  const tomorrow = page.locator("[data-day]").nth(1);
  await expect(tomorrow.getByRole("button", { name: `${CURRY}: open recipe` })).toBeVisible();
  await expect(undated).toHaveCount(0);
  const receipt = tomorrow.getByRole("region", { name: "What changed" });
  await expect(receipt).toContainText(new RegExp(`Moved ${esc(CURRY)} to \\w{3}, \\w{3} \\d{1,2}`));
  await expect(tomorrow.locator("[data-day-note]")).toBeFocused();
  await expectAccessible(page, "after setting a day");

  // Undo puts it back under "No day yet".
  await receipt.getByRole("button", { name: /^Undo/ }).click();
  await expect(page.getByRole("region", { name: "No day yet" }).getByRole("button", { name: `${CURRY}: open recipe` })).toBeVisible();

  // Set it again (Today this time) for the screenshot and the sheet.
  await page.getByRole("button", { name: `Pick a day for ${CURRY}` }).click();
  await page.getByRole("menuitemradio", { name: /^Today · / }).click();
  const today = page.locator("[data-day]").first();
  await expect(today.getByRole("button", { name: `${CURRY}: open recipe` })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`^Day for ${esc(CURRY)}: `) })).toContainText("Today");
  await shoot(page, `week-plan-${size}.png`);

  // KOS12: the sheet, from the server's preview.
  await page.getByRole("button", { name: "Add this week's missing ingredients" }).click();
  const sheet = page.getByRole("dialog", { name: "This week's missing ingredients" });
  await expect(sheet).toBeVisible();
  const missing = sheet.getByRole("group", { name: "Missing" });
  await expect(missing.getByRole("checkbox", { name: new RegExp(`^Coconut milk, for ${esc(CURRY)}`, "i") })).toBeChecked();
  await expect(missing.getByRole("checkbox", { name: new RegExp(`^Curry paste, for ${esc(CURRY)}`, "i") })).toBeChecked();
  const add = sheet.getByRole("button", { name: /^Add \d+ to my list$/ });
  await expect(add).toBeEnabled();
  await expectAccessible(page, "week-needs sheet open");
  await shoot(page, `week-needs-${size}.png`);

  // Dated only: the curry has a day now, so it stays.
  await sheet.getByRole("switch", { name: "Dated only" }).click();
  await expect(sheet).toContainText("From meals planned for the next 7 days.");
  await expect(missing.getByRole("checkbox", { name: /^Coconut milk/i })).toBeChecked();

  // Add: one change set; the sheet closes; the receipt with Undo under the pill takes focus.
  await sheet.getByRole("button", { name: /^Add \d+ to my list$/ }).click();
  await expect(sheet).toHaveCount(0);
  const note = page.locator("[data-week-needs-note]");
  // Focus lands on the receipt and stays there after the sheet's exit (as Restock, 0059 PF13).
  await expect(note).toBeFocused();
  await page.waitForTimeout(400);
  await expect(note).toBeFocused();
  await expect(note.getByRole("button", { name: /^Undo/ })).toBeVisible();
  await expectAccessible(page, "after adding the week's needs");

  await goTo(page, "List");
  const list = page.getByRole("region", { name: "Shopping list" });
  await expect(list).toContainText(/coconut milk/i);
  await expect(list).toContainText(/curry paste/i);
});
