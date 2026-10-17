/**
 * Shopping list (0027, ux.md §10) on the FAKE interpreter, at phone and desktop size, with axe at
 * each checkpoint: items said in chat → grouped by store, receipt grouped by store → tick ("got
 * it", saved for everyone) → ⋯ Remove with Undo → offline tick queued and synced (SL4 Rec) →
 * Done shopping → "Add to your kitchen?" → the ticked item moves into the Kitchen; Do later → To
 * review in the Kitchen → Add from there.
 * Kitchen OS places (0042): the list is the List place (`/list`); the Kitchen is a dock tap away,
 * and the List's Undo lines are still there when you come back.
 * Set SHOPPING_SCREENSHOTS=1 to save docs/design/screenshots/shopping-phone.png.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "../support/axe";
import { goTo, openChat } from "../support/places";

const COOKIE = "dev_acting_as";

async function resetAndActAs(page: Page, baseURL: string) {
  const res = await page.request.post("/api/dev/reset", { headers: { origin: baseURL } });
  expect(res.ok()).toBe(true);
  await page.context().addCookies([{ name: COOKIE, value: "demo-vero", url: baseURL }]);
  await page.goto("/list");
  await openChat(page);
}

const list = (page: Page) => page.getByRole("region", { name: "Shopping list" });
const kitchen = (page: Page) => page.getByRole("region", { name: "Kitchen" });
const composer = (page: Page) => page.getByRole("textbox", { name: "Message Lumi" });
const lastReceipt = (page: Page) => page.getByRole("region", { name: "What changed" }).last();
const EMPTY = "Your list is clear. Tell me what you need.";
const box = (page: Page, name: string) => list(page).getByRole("checkbox", { name: new RegExp(`^${name}, got it`) });

/** Types and sends; retries the typing until the page has hydrated (Send turns on). */
async function say(page: Page, text: string) {
  await expect(async () => {
    await composer(page).fill(text);
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled({ timeout: 500 });
  }).toPass();
  await composer(page).press("Enter");
}

test("shopping list: add in chat → tick → remove → Done shopping moves it to the kitchen", async ({ page, baseURL }, testInfo) => {
  await resetAndActAs(page, baseURL!);
  await expect(list(page).getByRole("checkbox")).toHaveCount(0);
  await expect(list(page)).toContainText(EMPTY);

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
  await expect(list(page)).toContainText("6 · 2 got");
  await expect(list(page).getByText("Not synced yet")).toHaveCount(0);
  await page.reload();
  await openChat(page);
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
  // Skip changes nothing (Do later has its own test below).
  await sheet.getByRole("button", { name: "Skip" }).click();
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

  await goTo(page, "Kitchen");
  for (const name of ["Garlic", "Ginger", "Lemongrass"]) {
    await expect(kitchen(page).getByRole("listitem").filter({ hasText: name })).toContainText("New");
  }
  await expectAccessible(page, "after done shopping");

  // Back on the List, the result and its Undo are still there; one Undo puts them back on the
  // list and out of the kitchen.
  await goTo(page, "List");
  await expect(list(page)).toContainText("Added 3 to your kitchen. 2 things are still on your list.");
  await list(page).getByRole("button", { name: /^Undo: added garlic, ginger(,)? and lemongrass to your kitchen$/ }).click();
  await expect(box(page, "Garlic")).toBeChecked();
  await goTo(page, "Kitchen");
  await expect(kitchen(page).getByRole("listitem").filter({ hasText: "Lemongrass" })).toHaveCount(0);
});

test("Do later: Done shopping → Do later → To review in the Kitchen → Add puts them in the kitchen and off the list", async ({ page, baseURL }) => {
  await resetAndActAs(page, baseURL!);
  await say(page, "Add garlic, ginger and shallot to the list for MD Oriental Market");
  await expect(box(page, "Shallot")).toBeVisible();
  await box(page, "Garlic").click();
  await box(page, "Ginger").click();
  await expect(box(page, "Ginger")).toBeChecked();

  // Done shopping → Do later: saved for later; the list stays as it was, ticks included.
  await list(page).getByRole("button", { name: "Done shopping" }).click();
  const sheet = page.getByRole("dialog", { name: "Add to your kitchen?" });
  await expect(sheet.getByRole("checkbox", { name: "Garlic" })).toBeChecked();
  await expect(sheet.getByRole("checkbox", { name: "Shallot" })).not.toBeChecked();
  await sheet.getByRole("button", { name: "Do later" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(list(page)).toContainText("Saved for later. It's in To review in your Kitchen.");
  await expect(page.getByTestId("announcer")).toContainText("Saved for later.");
  await expect(box(page, "Garlic")).toBeChecked();
  await expect(box(page, "Shallot")).not.toBeChecked();
  await expectAccessible(page, "after do later");

  // To review in the Kitchen shows them, and it's saved (survives a reload).
  await page.reload();
  await openChat(page);
  await goTo(page, "Kitchen");
  const review = kitchen(page).getByRole("region", { name: "To review" });
  const card = review.getByRole("button", { name: "2 items to add · Shopping list" });
  await expect(card).toBeVisible();
  await expect(review.getByRole("heading")).toContainText("To review · 1");
  await expectAccessible(page, "to review");

  // Tapping it reopens the sheet with those items chosen; Add moves them.
  await card.click();
  await expect(sheet.getByRole("checkbox", { name: "Garlic" })).toBeChecked();
  await expect(sheet.getByRole("checkbox", { name: "Ginger" })).toBeChecked();
  await expect(sheet.getByRole("checkbox", { name: "Shallot" })).toHaveCount(0);
  await expectAccessible(page, "to review sheet");
  await sheet.getByRole("button", { name: "Add 2 items" }).click();
  await expect(sheet).toHaveCount(0);

  await expect(kitchen(page)).toContainText("Added 2 to your kitchen. 1 thing is still on your list.");
  await expect(review).toHaveCount(0);
  for (const name of ["Garlic", "Ginger"]) {
    await expect(kitchen(page).getByRole("listitem").filter({ hasText: name })).toContainText("New");
  }
  await expectAccessible(page, "after add from to review");
  await goTo(page, "List");
  for (const name of ["Garlic", "Ginger"]) await expect(box(page, name)).toHaveCount(0);
  await expect(box(page, "Shallot")).toBeVisible();

  // One Undo (still beside the change on the Kitchen): back on the list (ticked), out of the
  // kitchen, and the card is back in To review.
  await goTo(page, "Kitchen");
  await kitchen(page).getByRole("button", { name: "Undo: added garlic and ginger to your kitchen" }).click();
  await expect(kitchen(page).getByRole("listitem").filter({ hasText: "Ginger" })).toHaveCount(0);
  await expect(card).toBeVisible();
  await goTo(page, "List");
  await expect(box(page, "Garlic")).toBeChecked();
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
  await openChat(page);
  await expect(box(page, "Oatmilk")).toBeChecked();
});

test("a phone opened fresh goes back to the List when it was used last (ux.md §10)", async ({ page, baseURL, context }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 900, "phone only");
  await resetAndActAs(page, baseURL!);
  await say(page, "Add limes to the list");
  await expect(box(page, "Limes")).toBeVisible();
  // A reload is the same visit: it stays where it is.
  await page.reload();
  await openChat(page);
  await expect(page).toHaveURL(/\/list$/);
  // Opening the app again (a new tab: a fresh session, the same phone) on Today goes back to the List.
  const again = await context.newPage();
  await again.goto("/");
  await openChat(again);
  await expect(again).toHaveURL(/\/list$/);
  await expect(again.getByRole("region", { name: "Shopping list" }).getByRole("checkbox", { name: /^Limes, got it/ })).toBeVisible();
  // Going to Today on purpose afterwards stays on Today.
  await goTo(again, "Today");
  await again.reload();
  await openChat(again);
  await expect(again).toHaveURL(/\/$/);
});
