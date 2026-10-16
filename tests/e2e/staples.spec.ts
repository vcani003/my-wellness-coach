/**
 * Smart staples (0054) on the FAKE interpreter, at phone and desktop size, with axe while the
 * Restock sheet is open: staples said in chat → a chat "running low" receipt offers "Add to my
 * list" for the staple (SS4, KOS4-d) → Restock staples on the List place → Need pre-selected,
 * You have some not (SS3) → Add 3 to my list → one receipt with Undo under the pill, the items on
 * the list under their usual store (SS5), the chat offer gone → Undo takes them all back.
 * Set STAPLES_SCREENSHOTS=1 to save docs/design/screenshots/staples-restock-{phone,desktop}.png.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "../support/axe";

const COOKIE = "dev_acting_as";

async function resetAndActAs(page: Page, baseURL: string) {
  const res = await page.request.post("/api/dev/reset", { headers: { origin: baseURL } });
  expect(res.ok()).toBe(true);
  await page.context().addCookies([{ name: COOKIE, value: "demo-vero", url: baseURL }]);
  await page.goto("/list");
}

const list = (page: Page) => page.getByRole("region", { name: "Shopping list" });
const composer = (page: Page) => page.getByRole("textbox", { name: "Message Lumi" });
const chatReceipt = (page: Page) => page.locator("#chat").getByRole("region", { name: "What changed" }).last();

async function say(page: Page, text: string) {
  await expect(async () => {
    await composer(page).fill(text);
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled({ timeout: 500 });
  }).toPass();
  await composer(page).press("Enter");
}

test("Restock staples: pre-selection, Add to my list with one receipt, Undo", async ({ page, baseURL }, testInfo) => {
  const phone = testInfo.project.name === "phone";
  await resetAndActAs(page, baseURL!);

  // Staples are learned only when said (SS2), with a usual store only when said (SS5).
  await say(page, "fish sauce is a staple from MD Oriental");
  await expect(chatReceipt(page)).toContainText("Fish sauce is one of your staples now (MD Oriental)");
  await say(page, "eggs, garlic and jasmine rice are staples");
  await expect(chatReceipt(page)).toContainText("Jasmine rice is one of your staples now");
  await say(page, "I bought garlic and jasmine rice");
  await expect(chatReceipt(page)).toContainText("Added jasmine rice");

  // A chat Low receipt offers the list for a staple (SS4, KOS4-d); Lumi doesn't ask in words (SS10).
  await say(page, "running low on jasmine rice");
  const lowReceipt = chatReceipt(page);
  await expect(lowReceipt).toContainText("Jasmine rice is one of your staples · Add to my list");
  await expect(lowReceipt.getByRole("button", { name: "Add jasmine rice to my list" })).toBeVisible();

  // Restock on the List place.
  await page.getByRole("button", { name: "Restock staples" }).click();
  // One dialog: its name follows the view ("Restock staples" / "Edit staples").
  const sheet = page.getByRole("dialog");
  await expect(page.getByRole("dialog", { name: "Restock staples" })).toBeVisible();
  const need = sheet.getByRole("group", { name: "Need" });
  await expect(need.getByRole("checkbox")).toHaveCount(3);
  await expect(need.getByRole("checkbox", { name: "Fish sauce, not in yet, add to list" })).toBeChecked();
  await expect(need.getByRole("checkbox", { name: "Eggs, not in yet, add to list" })).toBeChecked();
  await expect(need.getByRole("checkbox", { name: "Jasmine rice, running low, add to list" })).toBeChecked();
  await expect(sheet.getByRole("group", { name: "You have some" }).getByRole("checkbox", { name: /^Garlic,/ })).not.toBeChecked();
  const add = sheet.getByRole("button", { name: "Add 3 to my list" });
  await expect(add).toBeEnabled();
  await expectAccessible(page, "Restock sheet open");
  if (process.env.STAPLES_SCREENSHOTS) {
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.screenshot({ path: `docs/design/screenshots/staples-restock-${phone ? "phone" : "desktop"}.png` });
  }

  // Edit staples is in the same sheet, and back again.
  await sheet.getByRole("button", { name: "Edit staples" }).click();
  await expect(page.getByRole("dialog", { name: "Edit staples" })).toBeVisible();
  await expect(sheet.getByRole("list", { name: "Your staples" })).toContainText("MD Oriental");
  await expectAccessible(page, "Edit staples open");
  if (process.env.STAPLES_SCREENSHOTS && phone) {
    await page.screenshot({ path: "docs/design/screenshots/staples-edit-phone.png" });
  }
  await sheet.getByRole("button", { name: "Back to restock" }).click();

  // One change set: the sheet closes, the receipt with Undo shows under the pill, with focus.
  await sheet.getByRole("button", { name: "Add 3 to my list" }).click();
  await expect(sheet).toHaveCount(0);
  const note = page.locator("[data-restock-note]");
  await expect(note).toBeFocused();
  const receipt = note.getByRole("region", { name: "What changed" });
  await expect(receipt).toContainText("Added fish sauce to the shopping list (MD Oriental)");
  await expect(receipt).toContainText("On your list, Anywhere: eggs, jasmine rice");
  await expect(list(page).getByRole("region", { name: "MD Oriental" })).toContainText("Fish sauce");
  await expect(list(page).getByRole("region", { name: "Anywhere" })).toContainText("Jasmine rice");
  // It's on the list now, so the chat receipt's offer has gone.
  await expect(page.getByRole("button", { name: "Add jasmine rice to my list" })).toHaveCount(0);
  await expectAccessible(page, "After Restock");

  // Undo takes back all three.
  await receipt.getByRole("button", { name: /^Undo: / }).click();
  await expect(receipt).toContainText("Undone");
  await expect(list(page)).toContainText("Your list is clear. Tell me what you need.");
  await expect(page.getByRole("button", { name: "Add jasmine rice to my list" })).toBeVisible();
});
