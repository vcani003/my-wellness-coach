/**
 * Older and newer batches (0025) on the FAKE interpreter, at phone and desktop size, with axe at
 * each checkpoint: "I bought eggs" twice → one Kitchen row "2 batches" and the receipt's choice →
 * "Those are gone" → one batch, with Undo → Undo → two batches and the choice again; the batch
 * list behind the row; "I defrosted the chicken" → Defrosted.
 * Set BATCHES_SCREENSHOT=1 to save docs/design/screenshots/batches-phone.png.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "../support/axe";

const COOKIE = "dev_acting_as";

async function resetAndActAs(page: Page, baseURL: string) {
  const res = await page.request.post("/api/dev/reset", { headers: { origin: baseURL } });
  expect(res.ok()).toBe(true);
  await page.context().addCookies([{ name: COOKIE, value: "demo-vero", url: baseURL }]);
  await page.goto("/");
}

const kitchen = (page: Page) => page.getByRole("region", { name: "Kitchen" }).first();
const composer = (page: Page) => page.getByRole("textbox", { name: "Message Kitchen" });
const lastReceipt = (page: Page) => page.getByRole("region", { name: "What changed" }).last();
const eggsRow = (page: Page) => kitchen(page).getByRole("listitem").filter({ hasText: /^Eggs/ }).first();
const choice = (page: Page) => lastReceipt(page).getByRole("group", { name: /^You also had eggs from / });

/** Types and sends; retries the typing until the page has hydrated (Send turns on). */
async function say(page: Page, text: string) {
  await expect(async () => {
    await composer(page).fill(text);
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled({ timeout: 500 });
  }).toPass();
  await composer(page).press("Enter");
}

test("batches: buy eggs twice → the choice → Those are gone → Undo; defrosted chicken", async ({ page, baseURL }, testInfo) => {
  await resetAndActAs(page, baseURL!);

  await say(page, "I bought eggs");
  await expect(lastReceipt(page)).toContainText("Added eggs");
  await expect(lastReceipt(page).getByRole("group")).toHaveCount(0);

  // The second purchase is a second batch on the same row, and the receipt offers one tap.
  await say(page, "I bought eggs");
  await expect(lastReceipt(page)).toContainText("Added eggs (2 batches)");
  await expect(choice(page)).toBeVisible();
  await expect(page.getByTestId("announcer")).toContainText("You also had eggs from");
  await expect(kitchen(page).getByRole("listitem").filter({ hasText: /^Eggs/ })).toHaveCount(1);
  const toggle = eggsRow(page).getByRole("button", { name: /^Eggs/ });
  await expect(toggle).toContainText("2 batches · oldest added today");
  await expect(composer(page)).toBeFocused();
  await expectAccessible(page, "two batches and the choice");

  // Tapping the row lists the batches, view-only.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const batches = eggsRow(page).getByRole("list", { name: "Eggs: batches, oldest first" });
  await expect(batches.getByRole("listitem")).toHaveCount(2);
  await expect(batches.getByRole("listitem").first()).toContainText("Added by you");
  await expectAccessible(page, "batch list open");
  if (process.env.BATCHES_SCREENSHOT && testInfo.project.name === "phone") {
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.waitForTimeout(300);
    await page.screenshot({ path: "docs/design/screenshots/batches-phone.png" });
  }

  // "Those are gone": one batch left, the result in place with Undo (focused), announced.
  await choice(page).getByRole("button", { name: /^Those are gone: eggs from / }).click();
  const undo = lastReceipt(page).getByRole("button", { name: "Undo: Eggs: those are gone (1 batch left)" });
  await expect(undo).toBeFocused();
  // One Undo per receipt: it steps back the newest change ("Those are gone") first.
  await expect(lastReceipt(page).getByRole("button", { name: /^Undo/ })).toHaveCount(1);
  await expect(page.getByTestId("announcer")).toContainText("Eggs: those are gone (1 batch left)");
  await expect(choice(page)).toHaveCount(0);
  await expect(eggsRow(page)).toContainText("added today");
  await expect(eggsRow(page).getByRole("button", { name: /^Eggs/ })).toHaveCount(0);
  await expectAccessible(page, "after Those are gone");

  // Undo: both batches again, and the choice comes back.
  await undo.click();
  await expect(eggsRow(page).getByRole("button", { name: /^Eggs/ })).toContainText("2 batches");
  await expect(choice(page).getByRole("button", { name: /^Those are gone: eggs from / })).toBeFocused();
  await expect(lastReceipt(page).getByRole("button", { name: /^Undo/ })).toHaveCount(1);
  await expect(lastReceipt(page).getByRole("button", { name: "Undo: Added eggs (2 batches)" })).toBeVisible();

  // "I defrosted the chicken" → Defrosted on its row.
  await say(page, "I bought chicken");
  await say(page, "I froze the chicken");
  await expect(lastReceipt(page)).toContainText("Chicken → freezer");
  await say(page, "I defrosted the chicken");
  await expect(lastReceipt(page)).toContainText("Chicken: defrosted");
  const chicken = kitchen(page).getByRole("listitem").filter({ hasText: /^Chicken/ }).first();
  await expect(chicken).toContainText("Defrosted");
  await expectAccessible(page, "defrosted chicken");
});
