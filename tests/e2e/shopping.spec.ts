/**
 * Shopping list (0027, ux.md §10) on the FAKE interpreter, at phone and desktop size, with axe at
 * each checkpoint: items said in chat → grouped by store, receipt grouped by store → tick ("got
 * it", saved for everyone) → ⋯ Remove with Undo → offline tick queued and synced (SL4 Rec) →
 * Done shopping → "Add to your kitchen?" → the ticked item moves into the Kitchen.
 * Set SHOPPING_SCREENSHOTS=1 to save docs/design/screenshots/shopping-phone.png.
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

const list = (page: Page) => page.getByRole("region", { name: "Shopping list" });
const kitchen = (page: Page) => page.getByRole("region", { name: "Kitchen" });
const composer = (page: Page) => page.getByRole("textbox", { name: "Message Kitchen" });
const lastReceipt = (page: Page) => page.getByRole("region", { name: "What changed" }).last();
const box = (page: Page, name: string) => list(page).getByRole("checkbox", { name: new RegExp(`^${name}, got it`) });

/** Types and sends; retries the typing until the page has hydrated (Send turns on). */
async function say(page: Page, text: string) {
  await expect(async () => {
    await composer(page).fill(text);
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled({ timeout: 500 });
  }).toPass();
  await composer(page).press("Enter");
}

async function expandIfCollapsed(page: Page, region: ReturnType<typeof kitchen>) {
  const bar = region.getByRole("heading", { level: 2 }).getByRole("button");
  if ((await bar.getAttribute("aria-expanded")) === "false") await bar.click();
}

test("shopping list: add in chat → tick → remove → Done shopping moves it to the kitchen", async ({ page, baseURL }, testInfo) => {
  await resetAndActAs(page, baseURL!);
  await expect(list(page)).toHaveCount(0); // appears on its first item

  // Chat puts items on the list, under the store said; the receipt groups them by store.
  await say(page, "Add garlic, ginger, green onion and lemongrass to the list for MD Oriental Market");
  await expect(lastReceipt(page)).toContainText("On your list, MD Oriental Market: garlic, ginger, green onion, lemongrass");
  await say(page, "Add 1 bottle fish sauce and hoisin to the list");
  await expect(lastReceipt(page)).toContainText("On your list, Anywhere: fish sauce, hoisin");
  await expect(composer(page)).toBeFocused();

  const md = list(page).getByRole("region", { name: "MD Oriental Market" });
  const anywhere = list(page).getByRole("region", { name: "Anywhere" });
  await expect(md.getByRole("checkbox")).toHaveCount(4);
  await expect(anywhere.getByRole("checkbox")).toHaveCount(2);
  await expect(anywhere.getByRole("listitem").filter({ hasText: "Fish sauce" })).toContainText("1 bottle");
  await expect(anywhere.getByRole("listitem").filter({ hasText: "Hoisin" })).toContainText("New");
  // Anywhere is last.
  const groups = await list(page).getByRole("heading", { level: 3 }).allTextContents();
  expect(groups.at(-1)).toContain("Anywhere");
  await expectAccessible(page, "shopping list");

  // Tick = "got it": shows at once, is saved (survives a reload) and shows Done shopping.
  await box(page, "Garlic").click();
  await box(page, "Ginger").click();
  await expect(box(page, "Garlic")).toBeChecked();
  await expect(list(page).getByRole("button", { name: /Shopping list/ })).toContainText("6 · 2 got");
  await expect(list(page).getByText("Not synced yet")).toHaveCount(0);
  await page.reload();
  await expect(box(page, "Garlic")).toBeChecked();
  await expect(box(page, "Ginger")).toBeChecked();
  if (process.env.SHOPPING_SCREENSHOTS && testInfo.project.name === "phone") {
    await page.getByRole("button", { name: "Minimize chat" }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: "docs/design/screenshots/shopping-phone.png" });
    await page.getByRole("button", { name: /^Open chat/ }).click();
  }

  // Untick and tick again.
  await box(page, "Ginger").click();
  await expect(box(page, "Ginger")).not.toBeChecked();
  await box(page, "Ginger").click();
  await expect(box(page, "Ginger")).toBeChecked();

  // ⋯ → Remove, with Undo in place.
  await list(page).getByRole("button", { name: "More for hoisin" }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await expect(list(page)).toContainText("Hoisin removed");
  await expect(box(page, "Hoisin")).toHaveCount(0);
  await expectAccessible(page, "after remove");
  await list(page).getByRole("button", { name: "Undo: took hoisin off your list" }).click();
  await expect(box(page, "Hoisin")).toBeVisible();
  await list(page).getByRole("button", { name: "More for hoisin" }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await expect(box(page, "Hoisin")).toHaveCount(0);

  // Done shopping → "Add to your kitchen?" with the ticked items pre-selected.
  await list(page).getByRole("button", { name: "Done shopping" }).click();
  const sheet = page.getByRole("dialog", { name: "Add to your kitchen?" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("checkbox", { name: "Garlic" })).toBeChecked();
  await expect(sheet.getByRole("checkbox", { name: "Ginger" })).toBeChecked();
  await expect(sheet.getByRole("checkbox", { name: "Lemongrass" })).not.toBeChecked();
  await expectAccessible(page, "done shopping sheet");
  // Do later changes nothing.
  await sheet.getByRole("button", { name: "Do later" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(box(page, "Garlic")).toBeChecked();

  // Add: an unticked one chosen in the sheet goes too (ticked first).
  await list(page).getByRole("button", { name: "Done shopping" }).click();
  await sheet.getByRole("checkbox", { name: "Lemongrass" }).check();
  await sheet.getByRole("button", { name: "Add 3 items" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(list(page)).toContainText("Added 3 to your kitchen. 2 things are still on your list.");
  await expect(page.getByTestId("announcer")).toContainText("Added 3 to your kitchen.");
  await expect(box(page, "Garlic")).toHaveCount(0);
  await expect(box(page, "Lemongrass")).toHaveCount(0);
  await expect(box(page, "Green onion")).toBeVisible();

  await expandIfCollapsed(page, kitchen(page));
  for (const name of ["Garlic", "Ginger", "Lemongrass"]) {
    await expect(kitchen(page).getByRole("listitem").filter({ hasText: name })).toContainText("New");
  }
  await expectAccessible(page, "after done shopping");

  // One Undo puts them back on the list and out of the kitchen.
  await list(page).getByRole("button", { name: /^Undo: added garlic, ginger(,)? and lemongrass to your kitchen$/ }).click();
  await expect(box(page, "Garlic")).toBeChecked();
  await expect(kitchen(page).getByRole("listitem").filter({ hasText: "Lemongrass" })).toHaveCount(0);
});

test("SL4: a tick made with no signal is kept on the phone, marked 'Not synced yet', and syncs when back online", async ({ page, baseURL, context }) => {
  await resetAndActAs(page, baseURL!);
  await say(page, "Add oatmilk and shallot to the list for Publix");
  await expect(box(page, "Oatmilk")).toBeVisible();

  await context.setOffline(true);
  await box(page, "Oatmilk").click();
  await expect(box(page, "Oatmilk")).toBeChecked();
  await expect(list(page).getByText("Not synced yet")).toBeVisible();
  await expect(list(page)).toContainText("Offline · showing your list as of");
  await expectAccessible(page, "offline tick");

  await context.setOffline(false);
  await expect(list(page).getByText("Not synced yet")).toHaveCount(0);
  await page.reload();
  await expect(box(page, "Oatmilk")).toBeChecked();
});

test("a phone reopens with the shopping list on top when it was used last", async ({ page, baseURL }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 900, "phone only");
  await resetAndActAs(page, baseURL!);
  await say(page, "I bought eggs");
  await say(page, "Add limes to the list");
  await expect(box(page, "Limes")).toBeVisible();
  await page.reload();
  await expect
    .poll(() => page.locator("[data-widget]").evaluateAll((els) => els.map((e) => e.getAttribute("data-widget"))))
    .toEqual(["shopping.list", "kitchen.items"]);
  await expect(box(page, "Limes")).toBeVisible(); // expanded, ready to tick
});
