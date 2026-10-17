/**
 * Refining an idea card in chat (ai.md §5 "Refining an idea", Vero 2026-10-15), on the FAKE AI in
 * the Kitchen OS places layout: "remove the yogurt from the chicken curry" on Meals changes only
 * that card's Uses line, in place, with the recipe lines' brief highlight; nothing navigates and no
 * recipe is written. Choosing the card afterwards writes a recipe without the yogurt.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "../support/axe";
import { openChat } from "../support/places";

const COOKIE = "dev_acting_as";

async function resetAndActAs(page: Page, baseURL: string, path = "/") {
  const res = await page.request.post("/api/dev/reset", { headers: { origin: baseURL } });
  expect(res.ok()).toBe(true);
  await page.context().addCookies([{ name: COOKIE, value: "demo-vero", url: baseURL }]);
  await page.goto(path);
  await openChat(page);
}

const ideas = (page: Page) => page.getByRole("region", { name: "Meal ideas" });
const lastReceipt = (page: Page) => page.getByRole("region", { name: "What changed" }).last();
const recipe = (page: Page) => page.getByRole("article");
const composer = (page: Page) => page.getByRole("textbox", { name: "Message Lumi" });

/** Types and sends; retries the typing until the page has hydrated (Send turns on). */
async function say(page: Page, text: string) {
  await expect(async () => {
    await composer(page).fill(text);
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled({ timeout: 500 });
  }).toPass();
  await composer(page).press("Enter");
}

test("an idea changed in chat: only its line changes, highlighted; the recipe chosen later leaves it out", async ({ page, baseURL }) => {
  await resetAndActAs(page, baseURL!, "/meals");
  await say(page, "I bought chicken thighs, potatoes and greek yogurt");
  await expect(lastReceipt(page)).toContainText(/greek yogurt/i);

  await say(page, "what can I make? a chicken curry with potatoes, greek yogurt and lemongrass");
  const curry = ideas(page).getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3, name: "Chicken curry" }) });
  await expect(curry).toHaveCount(1);
  const [uses, missing] = [curry.locator("dd").nth(0), curry.locator("dd").nth(1)];
  await expect(uses).toContainText("greek yogurt");
  await expect(missing).toHaveText("lemongrass");
  const others = ideas(page).getByRole("listitem").filter({ hasNot: page.getByRole("heading", { level: 3, name: "Chicken curry" }) });
  const othersBefore = await others.allTextContents();

  await say(page, "remove the yogurt from the chicken curry");
  await expect(uses).not.toContainText("yogurt");
  await expect(uses).toContainText(/chicken thighs.*potatoes/);
  // Only the changed line is marked; the name, why and Missing lines and the other cards aren't.
  await expect(uses).toHaveAttribute("data-recipe-changed", "");
  await expect(curry.locator("[data-recipe-changed]")).toHaveCount(1);
  await expect(missing).toHaveText("lemongrass");
  await expect(ideas(page).locator("[data-recipe-changed]")).toHaveCount(1);
  expect(await others.allTextContents()).toEqual(othersBefore);
  // No recipe was written and nothing moved.
  await expect(page).toHaveURL(/\/meals$/);
  await expect(curry.getByRole("button", { name: "Choose Chicken curry" })).toBeVisible();
  await expectAccessible(page, "idea card after a chat change");

  await curry.getByRole("button", { name: "Choose Chicken curry" }).click();
  await expect(page).toHaveURL(/\/recipe\//);
  await expect(recipe(page).getByRole("heading", { level: 2, name: "Chicken curry" })).toBeVisible();
  await expect(recipe(page).getByRole("group", { name: "In your kitchen" })).toContainText(/potatoes/i);
  await expect(recipe(page).getByRole("group", { name: "Need" })).toContainText(/lemongrass/i);
  await expect(recipe(page)).not.toContainText(/yogurt/i);
});
