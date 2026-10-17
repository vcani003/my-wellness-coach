/**
 * Phone chat with a (simulated) iPhone keyboard, in WebKit at iPhone size (0059 PF7).
 * Vero, on her iPhone: "I can't send messages on mobile, it just disappears when I click away from
 * chat box." On iPhone the keyboard doesn't shrink the page; we read `visualViewport` and lift the
 * chat by the keyboard's height (viewport.ts). When a tap on Send took focus from the message box,
 * the keyboard closed mid-tap, the chat dropped ~300 px and the places dock came back, so the
 * finger lifted over something else and the message wasn't sent.
 *
 * HONEST LIMITS: this is a simulation, not a real keyboard. Playwright can't open the iOS
 * keyboard, so `visualViewport.height` is stubbed and its `resize` fired by hand: shrunk when the
 * test "opens" the keyboard, restored when the box loses focus (as iOS does) or at pointerdown.
 * Taps are split into mouse down / up so the layout can move in between, as a slow finger would.
 * It proves our layout and focus logic; it does not prove Safari's real keyboard timing. That
 * needs the real-iPhone check in frontend.md §8.
 */
import { expect, test, type Page } from "@playwright/test";
import { openChat } from "../support/places";

const COOKIE = "dev_acting_as";
const KEYBOARD_PX = 300;

declare global {
  interface Window {
    __kb: { open(px: number): void; close(): void; closeOn(target: EventTarget, event: string): void };
  }
}

async function start(page: Page, baseURL: string) {
  const res = await page.request.post("/api/dev/reset", { headers: { origin: baseURL } });
  expect(res.ok()).toBe(true);
  await page.context().addCookies([{ name: COOKIE, value: "demo-vero", url: baseURL }]);
  // A keyboard we control: visualViewport.height shrinks while it's "up"; innerHeight doesn't (iOS).
  await page.addInitScript(() => {
    const vv = window.visualViewport!;
    let keyboard = 0;
    Object.defineProperty(vv, "height", { configurable: true, get: () => window.innerHeight - keyboard });
    Object.defineProperty(vv, "offsetTop", { configurable: true, get: () => 0 });
    const set = (px: number) => {
      keyboard = px;
      vv.dispatchEvent(new Event("resize"));
    };
    window.__kb = {
      open: (px) => set(px),
      close: () => set(0),
      closeOn: (target, event) => target.addEventListener(event, () => set(0), { once: true }),
    };
  });
  await page.goto("/");
  await openChat(page);
}

const composer = (page: Page) => page.getByRole("textbox", { name: "Message Lumi" });
const send = (page: Page) => page.getByRole("button", { name: "Send" });
const lastReceipt = (page: Page) => page.getByRole("region", { name: "What changed" }).last();
const keyboardState = (page: Page) => page.locator("html");

/** Focus the box, type, and "open" the keyboard: the chat lifts above it and the dock steps aside. */
async function typeWithKeyboard(page: Page, text: string) {
  await composer(page).tap();
  await page.evaluate((px) => window.__kb.open(px), KEYBOARD_PX);
  await expect(keyboardState(page)).toHaveAttribute("data-keyboard", "open");
  await expect(page.getByRole("navigation", { name: "Places" })).toBeHidden();
  await page.keyboard.type(text);
  await expect(send(page)).toBeEnabled();
}

/** A finger on Send: down, a moment for the layout to react, then up at the same spot. */
async function slowTap(page: Page) {
  const box = (await send(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
}

test("tapping Send with the keyboard up sends; the keyboard closing when the box loses focus can't make it miss", async ({ page, baseURL }) => {
  await start(page, baseURL!);
  await typeWithKeyboard(page, "I bought eggs");
  // As on iOS: the keyboard closes when the message box loses focus.
  await page.evaluate(() => {
    const box = document.querySelector("textarea")!;
    window.__kb.closeOn(box, "blur");
  });
  await slowTap(page);
  await expect(lastReceipt(page)).toContainText("Added eggs");
  await expect(composer(page)).toHaveValue("");
  // Focus (and so the keyboard) stayed in the box: ready for the next message.
  await expect(composer(page)).toBeFocused();
  await expect(keyboardState(page)).toHaveAttribute("data-keyboard", "open");
});

test("even if the keyboard closes as the finger lands, the chat holds still until the tap is done", async ({ page, baseURL }) => {
  await start(page, baseURL!);
  await typeWithKeyboard(page, "I bought spinach");
  await page.evaluate(() => window.__kb.closeOn(window, "pointerdown"));
  await slowTap(page);
  await expect(lastReceipt(page)).toContainText("Added spinach");
  // Then the layout follows the closed keyboard: the chat settles and the dock comes back.
  await expect(keyboardState(page)).not.toHaveAttribute("data-keyboard", "open");
  await expect(page.getByRole("navigation", { name: "Places" })).toBeVisible();
});

test("tapping outside the message box keeps the draft, and it still sends", async ({ page, baseURL }) => {
  await start(page, baseURL!);
  await typeWithKeyboard(page, "I bought yogurt");
  await page.evaluate(() => window.__kb.closeOn(document.querySelector("textarea")!, "blur"));
  await page.getByRole("heading", { level: 1 }).tap();
  await expect(composer(page)).not.toBeFocused();
  await expect(keyboardState(page)).not.toHaveAttribute("data-keyboard", "open");
  await expect(composer(page)).toBeVisible();
  await expect(composer(page)).toHaveValue("I bought yogurt");
  await send(page).tap();
  await expect(lastReceipt(page)).toContainText("Added yogurt");
});
