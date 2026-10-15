/**
 * Shared-kitchen cues (ux.md §6) on the FAKE interpreter, at phone and desktop size, with axe:
 * - **Since your last visit** (tester run 2026-10-14 household, step 5b): Vero buys eggs and
 *   milk → switches to Levi → "I used the rest of the eggs" → back to Vero: the line says Levi
 *   used up the eggs (still there after a reload) → Dismiss → gone, and still gone after a reload.
 * - **While you're looking:** Levi uses up the milk while Vero has the app open → one quiet line
 *   and one announcement, focus stays in the composer.
 * The rows are on the Kitchen place (`/kitchen`, 0042); Today shows the same lines (its Kitchen card).
 */
import { expect, request, test, type Page } from "@playwright/test";
import { expectAccessible } from "../support/axe";
import { goTo } from "../support/places";

const KITCHEN_ID = "test-kitchen-demo";
const COOKIE = "dev_acting_as"; // DEV_ACTING_AS_COOKIE (src/lib/auth/current-user.ts)

const kitchen = (page: Page) => page.getByRole("region", { name: "Kitchen" });
const sinceLine = (page: Page) => kitchen(page).getByRole("region", { name: "Since your last visit" });
const composer = (page: Page) => page.getByRole("textbox", { name: "Message Lumi" });
const lastReceipt = (page: Page) => page.getByRole("region", { name: "What changed" }).last();

async function resetAndActAs(page: Page, baseURL: string, userId: "demo-vero" | "demo-levi") {
  const res = await page.request.post("/api/dev/reset", { headers: { origin: baseURL } });
  expect(res.ok()).toBe(true);
  await page.context().addCookies([{ name: COOKIE, value: userId, url: baseURL }]);
  await page.goto("/kitchen");
}

async function say(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

/** The dev bar's "Acting as" switch reloads the page as that person. */
async function switchTo(page: Page, name: "Vero" | "Levi") {
  // The radio itself is visually hidden inside its label (SegmentedRadio), so tap the label.
  await page.getByRole("radiogroup", { name: "Acting as" }).getByText(name, { exact: true }).click();
  await expect(page.getByRole("link", { name: `Settings, signed in as ${name}` })).toBeVisible();
  await expect(kitchen(page)).toBeVisible();
}

test("Since your last visit: Vero sees that Levi used up the eggs, and can dismiss it", async ({ page, baseURL }) => {
  await resetAndActAs(page, baseURL!, "demo-vero");
  await say(page, "I bought eggs and milk");
  await expect(lastReceipt(page)).toContainText("Added eggs");
  // Her own change is never "since your last visit".
  await expect(sinceLine(page)).toHaveCount(0);

  await switchTo(page, "Levi");
  await expect(sinceLine(page)).toHaveCount(0); // Levi's first visit on this device
  await say(page, "I used the rest of the eggs");
  await expect(lastReceipt(page)).toContainText("Eggs: out");

  await switchTo(page, "Vero");
  await expect(kitchen(page).getByRole("listitem").filter({ hasText: "Eggs" })).toHaveCount(0);
  await expect(sinceLine(page)).toContainText("Since your last visit: Levi used up the eggs.");
  await expectAccessible(page, "since your last visit");
  // It stays until dismissed, even across a reload, and Today (where you usually land) shows it too.
  await page.reload();
  await expect(sinceLine(page)).toContainText("Levi used up the eggs.");
  await goTo(page, "Today");
  await expect(page.getByRole("region", { name: "Today" }).getByRole("region", { name: "Since your last visit" })).toContainText(
    "Levi used up the eggs.",
  );
  await expectAccessible(page, "since your last visit on Today");
  await goTo(page, "Kitchen");

  await sinceLine(page).getByRole("button", { name: "Dismiss" }).click();
  await expect(sinceLine(page)).toHaveCount(0);
  await expectAccessible(page, "since your last visit dismissed");

  // Seen is seen: the next visit doesn't repeat it.
  await page.reload();
  await expect(kitchen(page).getByRole("listitem").filter({ hasText: "Milk" })).toBeVisible();
  await expect(sinceLine(page)).toHaveCount(0);
});

test("while you're looking: Levi uses up the milk → one quiet line and one announcement, focus stays", async ({ page, baseURL }) => {
  await resetAndActAs(page, baseURL!, "demo-vero");
  await say(page, "I bought eggs and milk");
  await expect(lastReceipt(page)).toContainText("Added milk");
  await expect(composer(page)).toBeFocused();

  const levi = await request.newContext({ baseURL, extraHTTPHeaders: { cookie: `${COOKIE}=demo-levi` } });
  const res = await levi.post("/api/chat", {
    data: { kitchenId: KITCHEN_ID, clientMessageId: `levi-${Date.now()}`, text: "I used the rest of the milk" },
  });
  expect(await res.text()).toContain('"type":"done"');
  await levi.dispose();

  // Coming back to the app checks right away (instead of waiting up to 15 s).
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(kitchen(page).getByRole("listitem").filter({ hasText: "Milk" })).toHaveCount(0);
  await expect(kitchen(page).getByText("Levi used up the milk.")).toBeVisible();
  await expect(page.getByTestId("announcer")).toHaveText("Levi used up the milk.");
  await expect(composer(page)).toBeFocused();
  await expect(sinceLine(page)).toHaveCount(0);
  await expectAccessible(page, "live removal cue");

  // It lasts until your next message, like the other highlights.
  await say(page, "I bought bread");
  await expect(lastReceipt(page)).toContainText("Added bread");
  await expect(kitchen(page).getByText("Levi used up the milk.")).toHaveCount(0);
});
