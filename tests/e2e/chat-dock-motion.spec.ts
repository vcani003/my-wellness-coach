/**
 * The chat dock moves instead of just appearing (0059 PF16), on the FAKE interpreter.
 * Phone: the round chat button opens the dock, which springs up (a transform transition) while the
 * button shrinks away; Minimize drops it and the button pops back. A minimized dock is never
 * focusable or tappable, even while it drops away. Opening and minimizing over and over, then
 * tapping Send, still sends. Peek <-> Full runs a view transition where the browser has one.
 * Desktop: the chat column fades in when reopened. Reduced motion: fades only, nothing moves.
 */
import { expect, test, type Page } from "@playwright/test";

const COOKIE = "dev_acting_as";

async function start(page: Page, baseURL: string) {
  const res = await page.request.post("/api/dev/reset", { headers: { origin: baseURL } });
  expect(res.ok()).toBe(true);
  await page.context().addCookies([{ name: COOKIE, value: "demo-vero", url: baseURL }]);
  // Record which properties transition on the dock and the chat button, and count view transitions.
  await page.addInitScript(() => {
    const w = window as unknown as { __moved: { el: string; prop: string }[]; __vt: number };
    w.__moved = [];
    w.__vt = 0;
    document.addEventListener("transitionrun", (e) => {
      const el = e.target as Element;
      const which = el.id === "chat" ? "dock" : el.classList?.contains("chat-fab") ? "fab" : null;
      if (which) w.__moved.push({ el: which, prop: e.propertyName });
    });
    const start = document.startViewTransition?.bind(document);
    if (start) {
      document.startViewTransition = ((cb: ViewTransitionUpdateCallback) => {
        w.__vt += 1;
        return start(cb);
      }) as typeof document.startViewTransition;
    }
  });
  await page.goto("/");
  await expect(page.locator("#chat")).not.toHaveAttribute("data-dock", "launch");
  // Motion switches on a moment after the app settles (KitchenApp MOTION_SETTLE_MS).
  await expect(page.locator(".app-shell")).toHaveAttribute("data-motion", "");
}

const dockEl = (page: Page) => page.locator("#chat");
const fab = (page: Page) => page.getByRole("button", { name: /^Open chat/ });
const composer = (page: Page) => page.getByRole("textbox", { name: "Message Lumi" });
const minimize = (page: Page) => page.getByRole("button", { name: "Minimize chat" });

const moved = (page: Page, el: "dock" | "fab") =>
  page.evaluate((which) => (window as unknown as { __moved: { el: string; prop: string }[] }).__moved.filter((m) => m.el === which).map((m) => m.prop), el);
const clearMoved = (page: Page) => page.evaluate(() => ((window as unknown as { __moved: unknown[] }).__moved = []));

/** Nothing inside the chat can take focus: not by script, not by Tab. */
async function chatNotFocusable(page: Page) {
  const focused = await page.evaluate(() => {
    const box = document.querySelector<HTMLElement>("#chat textarea, #chat input");
    box?.focus();
    return document.activeElement?.closest("#chat") !== null;
  });
  expect(focused).toBe(false);
  await page.locator("body").focus();
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest("#chat") !== null)).toBe(false);
  }
}

test.describe("phone", () => {
  test.skip(({ isMobile }) => !isMobile, "the phone dock");

  test("the dock springs up from the chat button and drops back; a minimized dock is never focusable", async ({ page, baseURL }) => {
    await start(page, baseURL!);
    await expect(dockEl(page)).toHaveAttribute("data-dock", "minimized");
    await chatNotFocusable(page);

    await fab(page).click();
    await expect(composer(page)).toBeFocused();
    await expect.poll(() => moved(page, "dock")).toContain("transform");
    await expect.poll(() => moved(page, "fab")).toContain("transform");
    // The chat button is gone for assistive tech at once, and can't be focused.
    await expect(fab(page)).toHaveCount(0);
    await expect(page.locator(".chat-fab")).toHaveAttribute("inert", "");
    // Settled in place.
    await expect.poll(() => dockEl(page).evaluate((el) => el.getAnimations().length)).toBe(0);
    expect(await dockEl(page).evaluate((el) => getComputedStyle(el).transform)).toBe("none");

    await clearMoved(page);
    await minimize(page).click();
    await expect(fab(page)).toBeFocused();
    // While it drops away it's inert: nothing in it takes taps or focus.
    await expect(dockEl(page)).toHaveAttribute("inert", "");
    await expect.poll(() => moved(page, "dock")).toContain("transform");
    await expect(dockEl(page)).toBeHidden();
    await chatNotFocusable(page);
  });

  test("open and minimize over and over, then tap Send: the message is sent", async ({ page, baseURL }) => {
    await start(page, baseURL!);
    for (let i = 0; i < 4; i += 1) {
      await fab(page).click();
      await expect(composer(page)).toBeVisible();
      await minimize(page).click();
      await expect(fab(page)).toBeVisible();
    }
    await fab(page).click();
    await expect(composer(page)).toBeFocused();
    await composer(page).fill("I bought fish sauce");
    await page.getByRole("button", { name: "Send" }).tap();
    await expect(page.getByRole("log", { name: "Conversation" }).getByText("I bought fish sauce")).toBeVisible();
    await expect(page.getByRole("region", { name: "What changed" }).last()).toBeVisible();
  });

  test("Peek <-> Full slides (a view transition where there is one), and nothing gets stuck", async ({ page, baseURL, browserName }) => {
    await start(page, baseURL!);
    await fab(page).click();
    await expect(composer(page)).toBeFocused();
    const vtBefore = await page.evaluate(() => (window as unknown as { __vt: number }).__vt);
    await page.getByRole("button", { name: "Show chat" }).click();
    await expect(dockEl(page)).toHaveAttribute("data-dock", "full");
    await page.getByRole("button", { name: "Hide chat" }).click();
    await expect(dockEl(page)).toHaveAttribute("data-dock", "peek");
    const supported = await page.evaluate(() => typeof document.startViewTransition === "function");
    if (supported) expect(await page.evaluate(() => (window as unknown as { __vt: number }).__vt)).toBe(vtBefore + 2);
    else test.info().annotations.push({ type: "note", description: `${browserName}: no view transitions; Peek/Full just change` });
    // Right after a morph the chat still takes taps.
    await page.getByRole("button", { name: "Show chat" }).click();
    await minimize(page).click();
    await expect(fab(page)).toBeFocused();
  });

  test("reduced motion: the dock and button only fade", async ({ page, baseURL }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await start(page, baseURL!);
    await fab(page).click();
    await expect(composer(page)).toBeFocused();
    await expect.poll(() => moved(page, "dock")).toContain("opacity");
    expect(await moved(page, "dock")).not.toContain("transform");
    expect(await moved(page, "fab")).not.toContain("transform");
  });
});

test.describe("desktop", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "the desktop chat column");

  test("the chat column fades back in when reopened; minimized it isn't focusable", async ({ page, baseURL }) => {
    await start(page, baseURL!);
    await expect(composer(page)).toBeVisible();
    await minimize(page).click();
    await expect(fab(page)).toBeFocused();
    await expect(dockEl(page)).toBeHidden();
    await chatNotFocusable(page);
    await clearMoved(page);
    await fab(page).click();
    await expect(composer(page)).toBeFocused();
    await expect.poll(() => moved(page, "dock")).toContain("opacity");
  });
});
