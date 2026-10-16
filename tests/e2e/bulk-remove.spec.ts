/**
 * Ask before removing more than 5 things at once (0045 KOS16) on the FAKE interpreter, at phone and
 * desktop size, with axe while Lumi asks: "we're out of" six things → "That would remove 6 things:
 * … Remove them all?" with Yes / No and nothing removed → Yes → one receipt with one Undo, all six
 * gone → Undo brings them all back. Then "No, keep them" changes nothing.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "../support/axe";
import { goTo } from "../support/places";

const COOKIE = "dev_acting_as";
const SIX = ["Milk", "Eggs", "Bread", "Rice", "Butter", "Cheese"];

async function resetAndActAs(page: Page, baseURL: string) {
  const res = await page.request.post("/api/dev/reset", { headers: { origin: baseURL } });
  expect(res.ok()).toBe(true);
  await page.context().addCookies([{ name: COOKIE, value: "demo-vero", url: baseURL }]);
  await page.goto("/");
}

const kitchen = (page: Page) => page.getByRole("region", { name: "Kitchen" });
const composer = (page: Page) => page.getByRole("textbox", { name: "Message Lumi" });
const lastReceipt = (page: Page) => page.locator("#chat").getByRole("region", { name: "What changed" }).last();
const question = (page: Page) => page.getByRole("group", { name: "Remove 6 things?" });

async function say(page: Page, text: string) {
  await expect(async () => {
    await composer(page).fill(text);
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled({ timeout: 500 });
  }).toPass();
  await composer(page).press("Enter");
}

async function shown(page: Page, names: string[]) {
  for (const name of names) await expect(kitchen(page).getByRole("listitem").filter({ hasText: name }).first()).toBeVisible();
}

test("more than 5 removals: Lumi asks, Yes removes them in one change with one Undo; No keeps them", async ({ page, baseURL }) => {
  await resetAndActAs(page, baseURL!);
  await goTo(page, "Kitchen");
  await say(page, "I bought milk, eggs, bread, rice, butter and cheese");
  await expect(lastReceipt(page)).toContainText("Added cheese");
  await shown(page, SIX);

  await say(page, "we're out of milk, eggs, bread, rice, butter and cheese");
  await expect(page.getByText("That would remove 6 things: milk, eggs, bread, rice, butter, and cheese. Remove them all?")).toBeVisible();
  await expect(question(page)).toBeVisible();
  await shown(page, SIX); // nothing removed yet
  await expectAccessible(page, "Lumi asks before removing 6");

  await question(page).getByRole("button", { name: "Yes, remove them" }).click();
  const receipt = lastReceipt(page);
  await expect(receipt).toContainText("Cheese");
  await expect(question(page)).toHaveCount(0);
  for (const name of SIX) await expect(kitchen(page).getByRole("listitem").filter({ hasText: new RegExp(`^${name}`) })).toHaveCount(0);

  // One Undo for all six.
  await receipt.getByRole("button", { name: /^Undo: / }).click();
  await expect(receipt).toContainText("Undone");
  await shown(page, SIX);

  // No changes nothing.
  await say(page, "we're out of milk, eggs, bread, rice, butter and cheese");
  await question(page).getByRole("button", { name: "No, keep them" }).click();
  await expect(page.getByText("Okay, I didn't remove anything.")).toBeVisible();
  await expect(question(page)).toHaveCount(0);
  await shown(page, SIX);
});
