/**
 * The Kitchen place (K1, CAT1; Kitchen OS dock, 0042: the old "See all" page is now the Kitchen
 * itself) on the FAKE interpreter, at phone and desktop size, with axe at each checkpoint: buy a
 * few things → the dock's Kitchen → By type shows the category groups (remembered after a reload)
 * → search narrows ("nuoc mam" finds "nước mắm") → the view toggle still works while searching →
 * no matches → Clear → the groups again.
 * Set SEE_ALL_SCREENSHOTS=1 to save docs/design/screenshots/kitchen-by-type-phone.png and
 * kitchen-search-phone.png.
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
const search = (page: Page) => page.getByRole("searchbox", { name: "Search your kitchen" });
const groupTitles = (page: Page) => kitchen(page).getByRole("heading", { level: 3 });

async function say(page: Page, text: string) {
  await expect(async () => {
    await composer(page).fill(text);
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled({ timeout: 500 });
  }).toPass();
  await composer(page).press("Enter");
}

/** Minimizes the chat so the list shows, saves the picture, then opens the chat again. */
async function screenshot(page: Page, name: string) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.getByRole("button", { name: "Minimize chat" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `docs/design/screenshots/${name}` });
  await page.getByRole("button", { name: /^Open chat/ }).click();
}

test("Kitchen: By type groups, search narrows (accents ignored), the toggle while searching, clear", async ({ page, baseURL }, testInfo) => {
  const phone = testInfo.project.name === "phone";
  await resetAndActAs(page, baseURL!);
  await page.evaluate(() => window.localStorage.removeItem("kitchen.seeAll.view"));

  await say(page, "I bought fish sauce, nước mắm, jasmine rice and milk");
  await expect(lastReceipt(page)).toContainText("Added fish sauce");

  // The dock's Kitchen: By place first; focus on the place's title.
  await goTo(page, "Kitchen");
  await expect(page).toHaveURL(/\/kitchen$/);
  await expect(page.getByRole("heading", { name: "Kitchen", level: 1 })).toBeFocused();
  await expect(kitchen(page).getByText("Nước mắm")).toBeVisible();
  await expect(page.getByRole("button", { name: "By place" })).toHaveAttribute("aria-pressed", "true");
  await expectAccessible(page, "Kitchen, by place");

  // By type: the category groups, each row saying where it is.
  await page.getByRole("button", { name: "By type" }).click();
  await expect(page.getByRole("button", { name: "By type" })).toHaveAttribute("aria-pressed", "true");
  await expect(groupTitles(page)).toContainText(["Dairy & eggs", "Rice, noodles & grains", "Sauces & condiments"]);
  const sauces = kitchen(page).getByRole("region", { name: "Sauces & condiments" });
  await expect(sauces.getByRole("listitem")).toHaveCount(2);
  await expect(sauces.getByRole("listitem").filter({ hasText: "Fish sauce" })).toContainText(/Fish sauce · (Pantry|Fridge|Not sure where)/);
  await expectAccessible(page, "Kitchen, by type");
  if (process.env.SEE_ALL_SCREENSHOTS && phone) await screenshot(page, "kitchen-by-type-phone.png");

  // Remembered on this device.
  await page.reload();
  await openChat(page);
  await expect(page.getByRole("button", { name: "By type" })).toHaveAttribute("aria-pressed", "true");
  await expect(groupTitles(page).first()).toHaveText("Dairy & eggs");

  // Search narrows to a flat list, accents ignored, matches marked.
  await search(page).fill("nuoc mam");
  const results = kitchen(page).getByRole("region", { name: "1 match" });
  await expect(results.getByRole("listitem")).toHaveCount(1);
  await expect(results.getByRole("listitem")).toContainText("Nước mắm ·");
  await expect(results.locator("mark")).toHaveText(["Nước", "mắm"]);
  await expect(kitchen(page).getByRole("region", { name: "Sauces & condiments" })).toHaveCount(0);
  await expect(page.getByTestId("announcer")).toHaveText("1 match");
  await expectAccessible(page, "Kitchen, searching");

  // The toggle stays while searching: results are one flat list either way, and the choice sticks.
  await page.getByRole("button", { name: "By place" }).click();
  await expect(page.getByRole("button", { name: "By place" })).toHaveAttribute("aria-pressed", "true");
  await expect(kitchen(page).getByRole("region", { name: "1 match" }).getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: "By type" }).click();

  await search(page).fill("fish");
  await expect(kitchen(page).getByRole("region", { name: "2 matches" }).getByRole("listitem")).toHaveCount(2);
  if (process.env.SEE_ALL_SCREENSHOTS && phone) {
    await search(page).blur();
    await screenshot(page, "kitchen-search-phone.png");
  }

  await search(page).fill("tofu");
  await expect(kitchen(page).getByText("No matches for “tofu”")).toBeVisible();
  await expect(kitchen(page).getByText("Try another word, or ask Lumi in chat.")).toBeVisible();
  await expectAccessible(page, "Kitchen, no matches");

  // Clear: back to the groups, focus stays in the field.
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(search(page)).toHaveValue("");
  await expect(search(page)).toBeFocused();
  await expect(groupTitles(page).first()).toHaveText("Dairy & eggs");

  // Leaving and coming back: the view is kept, the search starts empty.
  await goTo(page, "Today");
  await goTo(page, "Kitchen");
  await expect(search(page)).toHaveValue("");
  await expect(page.getByRole("button", { name: "By type" })).toHaveAttribute("aria-pressed", "true");
  await search(page).fill("milk");
  await expect(kitchen(page).getByRole("region", { name: "1 match" })).toContainText("Milk");
  await expectAccessible(page, "Kitchen, search after coming back");
});

test("Kitchen: set a level in the item's edit sheet (KOS4 inside KOS3), receipt with Undo, Out stays in place, Add to my list", async ({ page, baseURL }, testInfo) => {
  const phone = testInfo.project.name === "phone";
  await resetAndActAs(page, baseURL!);

  await say(page, "I bought jasmine rice and milk");
  await expect(lastReceipt(page)).toContainText("Added jasmine rice");
  await goTo(page, "Kitchen");
  // The item row (the receipt under it has list items of its own).
  const rice = kitchen(page).locator("li[data-entity-id]").filter({ hasText: "Jasmine rice" });
  await expect(rice).toBeVisible();
  // Unknown level: no label.
  await expect(rice.locator("[data-stock]")).toHaveCount(0);

  // Tap the row → its edit sheet → How much is left? (acts at once).
  await rice.getByRole("button", { name: "Edit jasmine rice" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit jasmine rice" });
  const levels = sheet.getByRole("group", { name: "How much is left?" });
  await expect(levels.getByRole("button")).toHaveText(["Plenty", "Some left", "Running low", "Out"]);
  await levels.getByRole("button", { name: "Running low" }).click();

  // The receipt in the sheet, the level pressed, and the list offer.
  const receipt = sheet.getByRole("region", { name: "What changed" });
  await expect(receipt).toContainText("Jasmine rice: running low");
  await expect(levels.getByRole("button", { name: "Running low" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("announcer")).toContainText("Done. Jasmine rice: running low");
  await expectAccessible(page, "Kitchen, level set in the sheet");

  await receipt.getByRole("button", { name: "Add jasmine rice to my list" }).click();
  await expect(receipt).toContainText("Jasmine rice is on your list.");

  // Undo: the level goes back to unknown; the list keeps the rice (its own change).
  await receipt.getByRole("button", { name: "Undo: Jasmine rice: running low" }).click();
  await expect(receipt).toContainText("Undone");
  await expect(levels.getByRole("button", { name: "Running low" })).toHaveAttribute("aria-pressed", "false");

  // Plenty: no list offer. Done: back on the row, the receipt under it.
  await levels.getByRole("button", { name: "Plenty" }).click();
  await expect(sheet.getByRole("region", { name: "What changed" })).toContainText("Jasmine rice: plenty");
  await expect(sheet.getByRole("button", { name: /to my list/ })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(rice.getByRole("button", { name: "Edit jasmine rice" })).toBeFocused();
  await expect(rice.locator("[data-stock]")).toHaveText("Plenty");
  await expect(rice.getByRole("region", { name: "What changed" })).toContainText("Jasmine rice: plenty");
  if (process.env.STOCK_LEVEL_SCREENSHOT && phone) await screenshot(page, "kitchen-stock-level-phone.png");

  // Out: the item leaves the kitchen and the sheet closes, but its row stays, marked Out, until Undo or the next message.
  await rice.getByRole("button", { name: "Edit jasmine rice" }).click();
  await sheet.getByRole("group", { name: "How much is left?" }).getByRole("button", { name: "Out" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(rice).toHaveAttribute("data-change", "gone");
  await expect(rice.locator("[data-stock]")).toHaveText("Out");
  await expect(rice.getByRole("button", { name: "Edit jasmine rice" })).toHaveCount(0);
  await expect(rice.getByRole("button", { name: "Undo: Jasmine rice: out" })).toBeFocused();
  await expectAccessible(page, "Kitchen, set to Out");
  await rice.getByRole("button", { name: "Undo: Jasmine rice: out" }).click();
  await expect(rice).not.toHaveAttribute("data-change", "gone");
  await expect(rice.locator("[data-stock]")).toHaveText("Plenty");
});
