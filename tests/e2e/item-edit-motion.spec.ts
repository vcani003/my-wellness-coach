/**
 * The item sheet's open / close motion (Vero, 0059 preview feedback: "a more elegant transition
 * popup… something fun like a bounce"), on Base UI's own transition hooks (globals.css
 * `.sheet-motion`). Phone: slides up on a soft spring, drops away quicker. Desktop: pops in from
 * 0.94, fades out. Reduced motion: a plain fade, nothing moves.
 * What must never change: focus goes to Name and back to the row, and a closing sheet never sits
 * over the row you tap next (the earlier lingering-overlay bug).
 * Set SHEET_ANIM_FRAMES=<dir> to save a few frames mid-animation (Chromium plays them at 1/10
 * speed so the frames land mid-way).
 */
import { expect, test, type Page } from "@playwright/test";
import { goTo, openChat } from "../support/places";

const COOKIE = "dev_acting_as";
const FRAMES = process.env.SHEET_ANIM_FRAMES;

async function start(page: Page, baseURL: string) {
  const res = await page.request.post("/api/dev/reset", { headers: { origin: baseURL } });
  expect(res.ok()).toBe(true);
  await page.context().addCookies([{ name: COOKIE, value: "demo-vero", url: baseURL }]);
  await page.goto("/");
  await openChat(page);
  const composer = page.getByRole("textbox", { name: "Message Lumi" });
  await expect(async () => {
    await composer.fill("I bought fish sauce and jasmine rice");
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled({ timeout: 500 });
  }).toPass();
  await composer.press("Enter");
  await expect(page.getByRole("region", { name: "What changed" }).last()).toContainText("Added fish sauce");
  await goTo(page, "Kitchen");
  // Phone: tuck the chat away so it doesn't cover the rows (a short iPhone screen).
  const minimize = page.getByRole("button", { name: "Minimize chat" });
  if (await minimize.isVisible()) await minimize.click();
}

const kitchen = (page: Page) => page.getByRole("region", { name: "Kitchen" });
const popup = (page: Page) => page.locator("[data-item-sheet]");

/** The CSS properties the popup is transitioning right now. */
const moving = (page: Page) =>
  popup(page).evaluate((el) =>
    el.getAnimations().map((a) => (a as CSSTransition).transitionProperty ?? "animation"),
  );

/** The popup has settled: no transition running, nothing moved, fully shown. */
async function settled(page: Page) {
  await expect.poll(() => moving(page)).toEqual([]);
  const style = await popup(page).evaluate((el) => {
    const cs = getComputedStyle(el);
    return { transform: cs.transform, opacity: cs.opacity };
  });
  expect(style).toEqual({ transform: "none", opacity: "1" });
}

async function frames(page: Page, name: string, act: () => Promise<void>) {
  if (!FRAMES || page.context().browser()?.browserType().name() !== "chromium") return act();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 0.1 });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await act();
  for (let i = 0; i < 6; i++) {
    await page.screenshot({ path: `${FRAMES}/${name}-${i}.png` });
    await page.waitForTimeout(450);
  }
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
  await cdp.detach();
}

test("the sheet moves in and out, focus is unchanged, and a closing sheet never blocks the next tap", async ({ page, baseURL }, testInfo) => {
  const phone = testInfo.project.name !== "desktop";
  await start(page, baseURL!);
  const fish = kitchen(page).getByRole("button", { name: "Edit fish sauce" });
  const rice = kitchen(page).getByRole("button", { name: "Edit jasmine rice" });

  // Open: it moves (transform and opacity), then settles in place with focus in Name.
  await frames(page, `open-${testInfo.project.name}`, () => fish.click());
  const sheet = page.getByRole("dialog", { name: "Edit fish sauce" });
  await expect(sheet).toBeVisible();
  if (!FRAMES || testInfo.project.name === "iphone-webkit") expect(await moving(page)).toEqual(expect.arrayContaining(["transform"]));
  await expect(sheet.getByRole("textbox", { name: "Name" })).toBeFocused();
  await settled(page);
  const box = (await sheet.boundingBox())!;
  const viewport = page.viewportSize()!;
  if (phone) expect(Math.round(box.y + box.height)).toBe(viewport.height);
  else expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2);

  // Close: it leaves, then focus is back on the row.
  await frames(page, `close-${testInfo.project.name}`, () => sheet.getByRole("button", { name: "Close" }).click());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(fish).toBeFocused();

  // Tap the next row WHILE the last sheet is still closing: the tap lands, its sheet opens.
  // (A raw mouse tap at the row's spot: Playwright's click would politely wait for anything on top.)
  const riceBox = (await rice.boundingBox())!;
  const riceAt = { x: riceBox.x + riceBox.width / 2, y: riceBox.y + riceBox.height / 2 };
  // Nothing else is on top of that spot while no sheet is open.
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-item-edit]")?.textContent, riceAt)).toBe("Jasmine rice");
  await fish.click();
  await settled(page);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(popup(page)).toHaveAttribute("data-ending-style", "");
  await page.mouse.click(riceAt.x, riceAt.y);
  const riceSheet = page.getByRole("dialog", { name: "Edit jasmine rice" });
  await expect(riceSheet).toBeVisible();
  await expect(riceSheet.getByRole("textbox", { name: "Name" })).toBeFocused();
  await settled(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(rice).toBeFocused();
  // And after it has fully gone, a row tap works as ever.
  await fish.click();
  await expect(sheet).toBeVisible();
});

test("reduced motion: the sheet only fades, nothing moves", async ({ page, baseURL }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await start(page, baseURL!);
  await kitchen(page).getByRole("button", { name: "Edit fish sauce" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit fish sauce" });
  await expect(sheet).toBeVisible();
  expect(await moving(page)).not.toContain("transform");
  expect(await popup(page).evaluate((el) => getComputedStyle(el).transform)).toBe("none");
  await settled(page);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
