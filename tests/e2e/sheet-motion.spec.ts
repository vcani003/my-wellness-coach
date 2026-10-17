/**
 * Every bottom sheet moves like the item sheet (0059 PF13; item-edit-motion.spec.ts covers that
 * one): Restock staples, Done shopping ("Add to your kitchen?"), the week's missing ingredients
 * and the day menu ("Which day?", a menu on its button, so it pops rather than slides). For each:
 * it moves in, settles in place, and while it's still closing a tap on what's underneath lands
 * (the lingering-overlay bug). Reduced motion: the day menu only fades.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { goTo, openChat } from "../support/places";

const COOKIE = "dev_acting_as";

async function start(page: Page, baseURL: string, path: string) {
  const res = await page.request.post("/api/dev/reset", { headers: { origin: baseURL } });
  expect(res.ok()).toBe(true);
  await page.context().addCookies([{ name: COOKIE, value: "demo-vero", url: baseURL }]);
  await page.goto(path);
  await openChat(page);
}

async function say(page: Page, text: string) {
  const composer = page.getByRole("textbox", { name: "Message Lumi" });
  await expect(async () => {
    await composer.fill(text);
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled({ timeout: 500 });
  }).toPass();
  await composer.press("Enter");
}

/** Phone: tuck the chat away so it doesn't cover the place. */
async function minimizeChat(page: Page) {
  const minimize = page.getByRole("button", { name: "Minimize chat" });
  if (await minimize.isVisible()) await minimize.click();
}

const sheetPopup = (page: Page) => page.locator(".sheet-motion");
const menuPopup = (page: Page) => page.locator(".pop-motion");
const lastReceipt = (page: Page) => page.getByRole("region", { name: "What changed" }).last();

/** The CSS properties the popup is transitioning right now. */
const moving = (popup: Locator) =>
  popup.evaluate((el) => el.getAnimations().map((a) => (a as CSSTransition).transitionProperty ?? "animation"));

/**
 * Start recording which properties transition on popups with `selector` (a listener, not a look
 * right after opening, which can miss a 380 ms transition on a slow machine).
 */
async function recordMotion(page: Page, selector: string) {
  await page.evaluate((sel) => {
    const w = window as unknown as { __moved: string[]; __movedSel?: string };
    w.__moved = [];
    if (w.__movedSel === undefined) {
      document.addEventListener("transitionrun", (e) => {
        if (w.__movedSel && (e.target as Element).matches?.(w.__movedSel)) w.__moved.push(e.propertyName);
      });
    }
    w.__movedSel = sel;
  }, selector);
}
const moved = (page: Page) => page.evaluate(() => (window as unknown as { __moved: string[] }).__moved);

/** Open with `open`; the popup moves in (a transform transition runs on it). */
async function opensMoving(page: Page, popup: Locator, selector: string, open: () => Promise<void>) {
  await recordMotion(page, selector);
  await open();
  await expect(popup).toBeVisible();
  await expect.poll(() => moved(page)).toContain("transform");
}

/** No transition running, nothing moved, fully shown. */
async function settled(popup: Locator) {
  await expect.poll(() => moving(popup)).toEqual([]);
  const style = await popup.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { transform: cs.transform, opacity: cs.opacity };
  });
  expect(style).toEqual({ transform: "none", opacity: "1" });
}

/** Centre of a target, for a raw tap (Playwright's click would politely wait for anything on top). */
async function spot(target: Locator) {
  const b = (await target.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/**
 * Close the popup, and while it's still closing, tap the spot `at` underneath (measured before it
 * opened: an open modal hides the page from the accessibility tree).
 */
async function tapWhileClosing(page: Page, popup: Locator, close: () => Promise<void>, at: { x: number; y: number }) {
  await close();
  await expect(popup).toHaveAttribute("data-ending-style", "");
  await page.mouse.click(at.x, at.y);
}

test("Restock staples and Done shopping: they spring in, and a closing sheet never blocks the next tap", async ({ page, baseURL }) => {
  await start(page, baseURL!, "/list");
  await say(page, "Add garlic, ginger and lemongrass to the list");
  await expect(lastReceipt(page)).toContainText("garlic, ginger, lemongrass");
  await minimizeChat(page);
  const list = page.getByRole("region", { name: "Shopping list" });
  const box = (name: string) => list.getByRole("checkbox", { name: new RegExp(`^${name}, got it`) });

  // Restock staples.
  const garlicAt = await spot(box("Garlic"));
  await opensMoving(page, sheetPopup(page), ".sheet-motion", () => page.getByRole("button", { name: "Restock staples" }).click());
  // With no staples yet it opens on Edit staples; either way, one dialog.
  const restock = page.getByRole("dialog");
  await settled(sheetPopup(page));
  await tapWhileClosing(page, sheetPopup(page), () => restock.getByRole("button", { name: "Close" }).click(), garlicAt);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(box("Garlic")).toBeChecked();

  // Done shopping.
  const gingerAt = await spot(box("Ginger"));
  await opensMoving(page, sheetPopup(page), ".sheet-motion", () => list.getByRole("button", { name: "Done shopping" }).click());
  const done = page.getByRole("dialog", { name: "Add to your kitchen?" });
  await settled(sheetPopup(page));
  await tapWhileClosing(page, sheetPopup(page), () => done.getByRole("button", { name: "Skip" }).click(), gingerAt);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(box("Ginger")).toBeChecked();

  // And after it has fully gone, taps work as ever.
  await box("Lemongrass").click();
  await expect(box("Lemongrass")).toBeChecked();
});

test("the day menu pops and the week's missing ingredients sheet springs; closing never blocks the next tap", async ({ page, baseURL }) => {
  await start(page, baseURL!, "/meals");
  // The stand-in's sample recipe (0059 PF10), in the plan with a day, so the week has needs.
  const recipe = page.getByRole("article");
  const CURRY = "Sample recipe (stand-in): Chicken curry";
  await say(page, "make me a sample recipe for chicken curry");
  await expect(recipe.getByRole("heading", { level: 2, name: CURRY })).toBeVisible();
  await recipe.getByRole("button", { name: "Add to plan" }).click();
  await expect(recipe).toContainText("In your plan");
  await recipe.getByRole("button", { name: "Back" }).click();
  await goTo(page, "Plan");
  await minimizeChat(page);
  await page.getByRole("button", { name: `Pick a day for ${CURRY}` }).click();
  await page.getByRole("menuitemradio", { name: /^Today · / }).click();
  const dayButton = page.getByRole("button", { name: /^Day for .*: / });
  await expect(dayButton).toContainText("Today");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const addNeeds = page.getByRole("button", { name: "Add this week's missing ingredients" });

  // The day menu pops in from its button; Escape, and a tap during its exit lands.
  const addNeedsAt = await spot(addNeeds);
  const dayButtonAt = await spot(dayButton);
  await opensMoving(page, menuPopup(page), ".pop-motion", () => dayButton.click());
  await expect(page.getByRole("group", { name: "Which day?" })).toBeVisible();
  await settled(menuPopup(page));

  // That tap opened the week's missing ingredients sheet, which springs in.
  await opensMoving(page, sheetPopup(page), ".sheet-motion", () => tapWhileClosing(page, menuPopup(page), () => page.keyboard.press("Escape"), addNeedsAt));
  const needs = page.getByRole("dialog", { name: "This week's missing ingredients" });
  await expect(needs).toBeVisible();
  await expect(menuPopup(page)).toHaveCount(0);
  await settled(sheetPopup(page));
  await tapWhileClosing(page, sheetPopup(page), () => needs.getByRole("button", { name: "Close" }).click(), dayButtonAt);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // That tap opened the day menu.
  await expect(page.getByRole("group", { name: "Which day?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menuPopup(page)).toHaveCount(0);

  // Reduced motion: the menu only fades, nothing moves.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await recordMotion(page, ".pop-motion");
  await dayButton.click();
  await expect(menuPopup(page)).toBeVisible();
  expect(await menuPopup(page).evaluate((el) => getComputedStyle(el).transform)).toBe("none");
  await settled(menuPopup(page));
  expect(await moved(page)).toContain("opacity");
  expect(await moved(page)).not.toContain("transform");
  await page.keyboard.press("Escape");
  await expect(menuPopup(page)).toHaveCount(0);
});
