/**
 * Older and newer batches (0025) on the FAKE interpreter, at phone and desktop size, with axe at
 * each checkpoint: "I bought eggs" twice → one Kitchen row "2 batches" and the receipt's choice →
 * "Those are gone" → one batch, with Undo → Undo → two batches and the choice again; the batches
 * in the row's edit sheet (KOS3); "I defrosted the chicken" → Defrosted.
 * Starts on the Kitchen place (`/kitchen`, 0042), where the rows are.
 * Set BATCHES_SCREENSHOT=1 to save docs/design/screenshots/batches-phone.png.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "../support/axe";
import { openChat } from "../support/places";

const COOKIE = "dev_acting_as";

async function resetAndActAs(page: Page, baseURL: string) {
  const res = await page.request.post("/api/dev/reset", { headers: { origin: baseURL } });
  expect(res.ok()).toBe(true);
  await page.context().addCookies([{ name: COOKIE, value: "demo-vero", url: baseURL }]);
  await page.goto("/kitchen");
  await openChat(page);
}

const kitchen = (page: Page) => page.getByRole("region", { name: "Kitchen" });
const composer = (page: Page) => page.getByRole("textbox", { name: "Message Lumi" });
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
  await expect(eggsRow(page)).toContainText("2 batches · oldest added today");
  await expect(composer(page)).toBeFocused();
  await expectAccessible(page, "two batches and the choice");

  // Tapping the row opens its edit sheet, which lists the batches to pick from (KOS3, KOS4-e).
  await eggsRow(page).getByRole("button", { name: "Edit eggs" }).click();
  const batches = page.getByRole("dialog", { name: "Edit eggs" }).getByRole("radiogroup", { name: "Which batch?" });
  await expect(batches.getByRole("radio")).toHaveCount(3);
  await expect(batches.getByRole("radio").nth(1)).toHaveAccessibleName(/added by you$/);
  await expectAccessible(page, "batch choice open");
  if (process.env.BATCHES_SCREENSHOT && testInfo.project.name === "phone") {
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.waitForTimeout(300);
    await page.screenshot({ path: "docs/design/screenshots/batches-phone.png" });
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // "Those are gone": one batch left, the result in place with Undo (focused), announced.
  await choice(page).getByRole("button", { name: /^Those are gone: eggs from / }).click();
  const undo = lastReceipt(page).getByRole("button", { name: "Undo: Eggs: those are gone (1 batch left)" });
  await expect(undo).toBeFocused();
  // One Undo per receipt: it steps back the newest change ("Those are gone") first.
  await expect(lastReceipt(page).getByRole("button", { name: /^Undo/ })).toHaveCount(1);
  await expect(page.getByTestId("announcer")).toContainText("Eggs: those are gone (1 batch left)");
  await expect(choice(page)).toHaveCount(0);
  await expect(eggsRow(page)).toContainText("added today");
  await expect(eggsRow(page)).not.toContainText("2 batches");
  await expectAccessible(page, "after Those are gone");

  // Undo: both batches again, and the choice comes back.
  await undo.click();
  await expect(eggsRow(page)).toContainText("2 batches");
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

// Tester re-run 2026-10-14, step 28: after a reload the answer was gone from the receipt and its
// one Undo had become the purchase's. It must read exactly as it did live.
test("batches: Those are gone → reload → the line and its Undo are still there → Undo works", async ({ page, baseURL }) => {
  // A saved answer once kept the receipt re-rendering until React gave up (desktop): fail on that.
  const loops: string[] = [];
  page.on("console", (m) => {
    if (m.text().includes("Maximum update depth exceeded")) loops.push(m.text());
  });
  await resetAndActAs(page, baseURL!);
  await say(page, "I bought eggs");
  await expect(lastReceipt(page)).toContainText("Added eggs");
  await say(page, "I bought eggs");
  await choice(page).getByRole("button", { name: /^Those are gone: eggs from / }).click();
  const goneUndo = () => lastReceipt(page).getByRole("button", { name: "Undo: Eggs: those are gone (1 batch left)" });
  await expect(goneUndo()).toBeFocused();

  await page.reload();
  await openChat(page);
  await expect(lastReceipt(page)).toContainText("Added eggs (2 batches)");
  await expect(lastReceipt(page)).toContainText("Eggs: those are gone (1 batch left)");
  await expect(goneUndo()).toBeVisible();
  await expect(lastReceipt(page).getByRole("button", { name: /^Undo/ })).toHaveCount(1);
  await expect(choice(page)).toHaveCount(0);
  await expectAccessible(page, "reloaded answered choice");

  // Undo steps back the answer: two batches and the choice again, then Undo is for the purchase.
  await goneUndo().click();
  await expect(eggsRow(page)).toContainText("2 batches");
  await expect(choice(page).getByRole("button", { name: /^Those are gone: eggs from / })).toBeFocused();
  await expect(lastReceipt(page).getByRole("button", { name: "Undo: Added eggs (2 batches)" })).toBeVisible();
  await expect(lastReceipt(page)).not.toContainText("those are gone");

  // And a reload now shows the open choice, not the undone answer.
  await page.reload();
  await openChat(page);
  await expect(choice(page)).toBeVisible();
  await expect(lastReceipt(page).getByRole("button", { name: "Undo: Added eggs (2 batches)" })).toBeVisible();
  expect(loops).toEqual([]);
});
