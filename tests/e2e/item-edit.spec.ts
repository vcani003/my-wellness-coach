/**
 * Tap an item to edit it (0045 KOS3; 0057, 0036) on the FAKE interpreter, at phone and desktop
 * size, with axe while the sheet and the Remove confirm are open: buy fish sauce → the Kitchen →
 * tap the row → the edit sheet (focus in Name) → rename, new amount, Counter → Save → one "What
 * changed" under the row, focus on its Undo, announced, the row in the Counter group → Undo → as
 * before. Then Remove asks once (focus on Cancel) → Removed, faded, with Undo → Undo.
 * Set ITEM_EDIT_SCREENSHOTS=1 to save docs/design/screenshots/item-edit-{phone,desktop}.png and
 * item-edit-remove-phone.png.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "../support/axe";
import { goTo, openChat } from "../support/places";

const COOKIE = "dev_acting_as";

async function resetAndActAs(page: Page, baseURL: string) {
  const res = await page.request.post("/api/dev/reset", { headers: { origin: baseURL } });
  expect(res.ok()).toBe(true);
  await page.context().addCookies([{ name: COOKIE, value: "demo-vero", url: baseURL }]);
  await page.goto("/");
  await openChat(page);
}

const kitchen = (page: Page) => page.getByRole("region", { name: "Kitchen" });
const composer = (page: Page) => page.getByRole("textbox", { name: "Message Lumi" });
const lastReceipt = (page: Page) => page.getByRole("region", { name: "What changed" }).last();

async function say(page: Page, text: string) {
  await expect(async () => {
    await composer(page).fill(text);
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled({ timeout: 500 });
  }).toPass();
  await composer(page).press("Enter");
}

async function shoot(page: Page, name: string) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `docs/design/screenshots/${name}` });
}

test("Edit an item: rename, amount, Counter → one receipt under the row → Undo; Remove asks once → Undo", async ({ page, baseURL }, testInfo) => {
  const phone = testInfo.project.name === "phone";
  await resetAndActAs(page, baseURL!);

  await say(page, "I bought fish sauce and jasmine rice");
  await expect(lastReceipt(page)).toContainText("Added fish sauce");
  await goTo(page, "Kitchen");
  const row = kitchen(page).locator("li[data-entity-id]").filter({ hasText: /^Fish sauce|^Nước mắm/ });
  await expect(row).toBeVisible();
  const rowId = await row.getAttribute("data-entity-id");
  const sameRow = kitchen(page).locator(`li[data-entity-id="${rowId}"]`);

  // Tap the row: the edit sheet, focus in Name.
  await sameRow.getByRole("button", { name: "Edit fish sauce" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit fish sauce" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("textbox", { name: "Name" })).toBeFocused();
  await expect(sheet.getByRole("button", { name: "Save" })).toBeDisabled();
  await expectAccessible(page, "edit sheet open");
  if (process.env.ITEM_EDIT_SCREENSHOTS) {
    await sheet.getByRole("textbox", { name: "Name" }).blur();
    await shoot(page, `item-edit-${phone ? "phone" : "desktop"}.png`);
  }

  // Rename, an amount, the Counter: one Save, one change set.
  await sheet.getByRole("textbox", { name: "Name" }).fill("nước mắm");
  await sheet.getByRole("textbox", { name: "Amount (optional)" }).fill("half a bottle");
  await sheet.getByRole("radiogroup", { name: "Where is it?" }).getByText("Counter").click();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The receipt under the row (not in chat), one Undo, focused, announced; the row now on the Counter.
  const receipt = sameRow.getByRole("region", { name: "What changed" });
  await expect(receipt).toContainText("Renamed fish sauce → nước mắm");
  await expect(receipt).toContainText("counter");
  await expect(receipt.getByRole("button", { name: /^Undo/ })).toHaveCount(1);
  await expect(receipt.getByRole("button", { name: /^Undo/ })).toBeFocused();
  await expect(page.getByTestId("announcer")).toContainText("Done. Renamed fish sauce to nước mắm");
  await expect(kitchen(page).getByRole("region", { name: "Counter" }).getByRole("button", { name: "Edit nước mắm" })).toBeVisible();
  await expect(page.locator("#chat").getByText("Renamed fish sauce")).toHaveCount(0);
  await expectAccessible(page, "after Save");

  // Undo: back as it was.
  await receipt.getByRole("button", { name: /^Undo/ }).click();
  await expect(receipt).toContainText("Undone");
  await expect(sameRow).toContainText("Fish sauce");
  await expect(kitchen(page).getByRole("region", { name: "Counter" })).toHaveCount(0);

  // Remove: asks once, focus on Cancel.
  await sameRow.getByRole("button", { name: "Edit fish sauce" }).click();
  await sheet.getByRole("button", { name: "Remove (added by mistake)" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Remove fish sauce?" });
  await expect(confirm).toContainText("It'll stay in history.");
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expectAccessible(page, "remove confirm open");
  if (process.env.ITEM_EDIT_SCREENSHOTS && phone) await shoot(page, "item-edit-remove-phone.png");
  await confirm.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(sameRow).toHaveAttribute("data-change", "gone");
  await expect(sameRow).toContainText("Removed");
  const undoRemove = sameRow.getByRole("button", { name: "Undo: Removed fish sauce" });
  await expect(undoRemove).toBeFocused();
  await expectAccessible(page, "after Remove");
  await undoRemove.click();
  await expect(sameRow).not.toHaveAttribute("data-change", "gone");
  await expect(sameRow.getByRole("button", { name: "Edit fish sauce" })).toBeVisible();
});
