/**
 * The Kitchen OS shell (0042) on the FAKE interpreter: the five places in the dock are real routes,
 * the chat stays mounted while you move (a half-typed message survives), each place passes axe in
 * light and dark (KOS14), and nothing scrolls sideways at 390×844 (ported from recipe-cat's
 * `e2e/kitchen-os.spec.ts`). Set PLACE_SHOTS=<folder> to save a light and a dark screenshot of each
 * place at phone width.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "../support/axe";
import { dock, goTo, type PlaceName } from "../support/places";

const COOKIE = "dev_acting_as";

async function resetAndActAs(page: Page, baseURL: string) {
  const res = await page.request.post("/api/dev/reset", { headers: { origin: baseURL } });
  expect(res.ok()).toBe(true);
  await page.context().addCookies([{ name: COOKIE, value: "demo-vero", url: baseURL }]);
  await page.goto("/");
}

const composer = (page: Page) => page.getByRole("textbox", { name: "Message Lumi" });
const lastReceipt = (page: Page) => page.getByRole("region", { name: "What changed" }).last();

async function say(page: Page, text: string) {
  await expect(async () => {
    await composer(page).fill(text);
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled({ timeout: 500 });
  }).toPass();
  await composer(page).press("Enter");
}

/** A kitchen with something in every place, so each screen has real content to lay out. */
async function fill(page: Page) {
  await say(page, "I bought eggs, chicken thighs, spinach, yogurt and a big bag of jasmine rice");
  await expect(lastReceipt(page)).toContainText("Added eggs");
  await say(page, "Add garlic, ginger and lemongrass to the list for MD Oriental Market");
  await expect(lastReceipt(page)).toContainText("On your list, MD Oriental Market");
  await say(page, "What can I make tonight?");
  await expect(page.getByText("Meal ideas are ready", { exact: true })).toBeVisible();
}

const PLACES: { name: PlaceName; url: RegExp; title: string; region: string }[] = [
  { name: "Today", url: /\/$/, title: "Today", region: "Today" },
  { name: "Kitchen", url: /\/kitchen$/, title: "Kitchen", region: "Kitchen" },
  { name: "Plan", url: /\/plan$/, title: "Meal plan", region: "Meal plan" },
  { name: "Meals", url: /\/meals$/, title: "Meals", region: "Meals" },
  { name: "List", url: /\/list$/, title: "Shopping list", region: "Shopping list" },
];

async function noSidewaysScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow, `sideways scroll on ${where}`).toEqual({ doc: 0, body: 0 });
}

test("the dock moves between the five places; the chat stays mounted; settings opens from the avatars", async ({ page, baseURL }) => {
  await resetAndActAs(page, baseURL!);
  await expect(dock(page).getByRole("link")).toHaveText(["Today", "Kitchen", "Plan", "Meals", "List"]);
  await expect(dock(page).getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");

  // A half-typed message survives moving around: the chat is never reloaded.
  await composer(page).fill("half a thought");
  for (const p of PLACES.slice(1).concat(PLACES[0])) {
    await goTo(page, p.name);
    await expect(page).toHaveURL(p.url);
    await expect(page.getByRole("heading", { level: 1, name: p.title })).toBeFocused();
    await expect(page.getByRole("region", { name: p.region })).toBeVisible();
    await expect(dock(page).locator("a[aria-current='page']")).toHaveCount(1);
  }
  await expect(composer(page)).toHaveValue("half a thought");

  // Back works like a phone's Back: real URLs.
  await goTo(page, "List");
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);

  // Settings opens from the household avatars; no place is marked in the dock there.
  await page.getByRole("link", { name: "Settings, signed in as Vero" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(dock(page).locator("a[aria-current='page']")).toHaveCount(0);
  await expect(composer(page)).toHaveValue("half a thought");
});

test("a place's own button asks Lumi: Use it up / Get ideas send a chat message (online only)", async ({ page, baseURL }) => {
  await resetAndActAs(page, baseURL!);
  await say(page, "I bought eggs and spinach");
  await expect(lastReceipt(page)).toContainText("Added eggs");
  await goTo(page, "Meals");
  await page.getByRole("button", { name: "Get ideas" }).click();
  await expect(page.getByRole("region", { name: "Meal ideas" }).getByRole("listitem")).toHaveCount(2);
  await expectAccessible(page, "meals with ideas");
});

test.describe("phone width 390×844", () => {
  test.skip(({ isMobile }) => !isMobile, "phone only");
  test.use({ viewport: { width: 390, height: 844 } });

  test("every place: no sideways scroll, axe in light and dark", async ({ page, baseURL }) => {
    await resetAndActAs(page, baseURL!);
    await fill(page);
    const shots = process.env.PLACE_SHOTS;
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      for (const p of PLACES) {
        await goTo(page, p.name);
        await expect(page.getByRole("region", { name: p.region })).toBeVisible();
        await noSidewaysScroll(page, `${p.name} (${scheme})`);
        await expectAccessible(page, `${p.name} (${scheme})`);
        if (shots) await page.screenshot({ path: `${shots}/${p.name.toLowerCase()}-${scheme}.png` });
      }
      await page.getByRole("link", { name: "Settings, signed in as Vero" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
      await noSidewaysScroll(page, `Settings (${scheme})`);
      await expectAccessible(page, `Settings (${scheme})`);
      if (shots) await page.screenshot({ path: `${shots}/settings-${scheme}.png` });
    }
  });
});
