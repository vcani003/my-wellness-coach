/**
 * Kitchen See all (K1, CAT1) on the FAKE interpreter, at phone and desktop size, with axe at each
 * checkpoint: buy a few things → See all → By type shows the category groups (remembered after a
 * reload) → search narrows ("nuoc mam" finds "nước mắm") → no matches → Clear → the groups again;
 * the compact widget's search icon opens See all with the field focused.
 * Set SEE_ALL_SCREENSHOTS=1 to save docs/design/screenshots/kitchen-by-type-phone.png and
 * kitchen-search-phone.png.
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
const seeAll = (page: Page) => page.getByRole("article", { name: "Your kitchen" });
const search = (page: Page) => page.getByRole("searchbox", { name: "Search your kitchen" });
const groupTitles = (page: Page) => seeAll(page).getByRole("heading", { level: 3 });

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

test("See all: By type groups, search narrows (accents ignored), clear; the widget's search icon", async ({ page, baseURL }, testInfo) => {
  const phone = testInfo.project.name === "phone";
  await resetAndActAs(page, baseURL!);
  await page.evaluate(() => window.localStorage.removeItem("kitchen.seeAll.view"));

  await say(page, "I bought fish sauce, nước mắm, jasmine rice and milk");
  await expect(lastReceipt(page)).toContainText("Added fish sauce");
  await expect(kitchen(page).getByText("Nước mắm")).toBeVisible();

  // See all: By place first.
  await kitchen(page).getByRole("link", { name: /^See all \(\d+\)$/ }).click();
  await expect(page).toHaveURL(/\/kitchen$/);
  await expect(seeAll(page).getByRole("heading", { name: "Your kitchen", level: 2 })).toBeFocused();
  await expect(page.getByRole("button", { name: "By place" })).toHaveAttribute("aria-pressed", "true");
  await expectAccessible(page, "See all, by place");

  // By type: the category groups, each row saying where it is.
  await page.getByRole("button", { name: "By type" }).click();
  await expect(page.getByRole("button", { name: "By type" })).toHaveAttribute("aria-pressed", "true");
  await expect(groupTitles(page)).toContainText(["Dairy & eggs", "Rice, noodles & grains", "Sauces & condiments"]);
  const sauces = seeAll(page).getByRole("region", { name: "Sauces & condiments" });
  await expect(sauces.getByRole("listitem")).toHaveCount(2);
  await expect(sauces.getByRole("listitem").filter({ hasText: "Fish sauce" })).toContainText(/Fish sauce · (Pantry|Fridge|Not sure where)/);
  await expectAccessible(page, "See all, by type");
  if (process.env.SEE_ALL_SCREENSHOTS && phone) await screenshot(page, "kitchen-by-type-phone.png");

  // Remembered on this device.
  await page.reload();
  await expect(page.getByRole("button", { name: "By type" })).toHaveAttribute("aria-pressed", "true");
  await expect(groupTitles(page).first()).toHaveText("Dairy & eggs");

  // Search narrows to a flat list, accents ignored, matches marked.
  await search(page).fill("nuoc mam");
  const results = seeAll(page).getByRole("region", { name: "1 match" });
  await expect(results.getByRole("listitem")).toHaveCount(1);
  await expect(results.getByRole("listitem")).toContainText("Nước mắm ·");
  await expect(results.locator("mark")).toHaveText(["Nước", "mắm"]);
  await expect(seeAll(page).getByRole("region", { name: "Sauces & condiments" })).toHaveCount(0);
  await expect(page.getByTestId("announcer")).toHaveText("1 match");
  await expectAccessible(page, "See all, searching");

  await search(page).fill("fish");
  await expect(seeAll(page).getByRole("region", { name: "2 matches" }).getByRole("listitem")).toHaveCount(2);
  if (process.env.SEE_ALL_SCREENSHOTS && phone) {
    await search(page).blur();
    await screenshot(page, "kitchen-search-phone.png");
  }

  await search(page).fill("tofu");
  await expect(seeAll(page).getByText("No matches for “tofu”")).toBeVisible();
  await expect(seeAll(page).getByText("Try another word, or ask Kitchen in chat.")).toBeVisible();
  await expectAccessible(page, "See all, no matches");

  // Clear: back to the groups, focus stays in the field.
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(search(page)).toHaveValue("");
  await expect(search(page)).toBeFocused();
  await expect(groupTitles(page).first()).toHaveText("Dairy & eggs");

  // Back home, then the widget's search icon opens See all with the field focused.
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(kitchen(page).getByRole("link", { name: /^See all/ })).toBeFocused();
  await kitchen(page).getByRole("link", { name: "Search your kitchen" }).click();
  await expect(search(page)).toBeFocused();
  await search(page).fill("milk");
  await expect(seeAll(page).getByRole("region", { name: "1 match" })).toContainText("Milk");
  await expectAccessible(page, "See all from the search icon");
});
