/**
 * Primary journey steps 1–4 (ux.md §8, decision 0005) on the FAKE interpreter, at phone and
 * desktop size, with automated accessibility checks (axe) at each checkpoint:
 *   empty kitchen → "I bought …" → items show as New → "I froze the chicken" → it moves to the
 *   Freezer → Undo puts it back.
 * Plus the dock states (phone), the desktop split, and a two-person cue.
 * Set M2_SCREENSHOTS=1 to save docs/design/screenshots/m2-<project>.png after step 1.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, request, test, type Page } from "@playwright/test";

const KITCHEN_ID = "test-kitchen-demo";
const COOKIE = "dev_acting_as"; // DEV_ACTING_AS_COOKIE (src/lib/auth/current-user.ts)

async function resetAndActAs(page: Page, baseURL: string, userId: "demo-vero" | "demo-levi") {
  const res = await page.request.post("/api/dev/reset", { headers: { origin: baseURL } });
  expect(res.ok()).toBe(true);
  await page.context().addCookies([{ name: COOKIE, value: userId, url: baseURL }]);
  await page.goto("/");
}

/** Fails on serious or critical WCAG 2.2 A/AA issues (frontend.md §6). */
async function expectAccessible(page: Page, checkpoint: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const minor = results.violations.filter((v) => !blocking.includes(v));
  if (minor.length) console.log(`[axe ${checkpoint}] minor:`, minor.map((v) => `${v.id} (${v.impact})`).join(", "));
  expect(blocking.map((v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), checkpoint).toEqual([]);
}

const kitchen = (page: Page) => page.getByRole("region", { name: "Kitchen" });
const composer = (page: Page) => page.getByRole("textbox", { name: "Message Kitchen" });
const lastReceipt = (page: Page) => page.getByRole("region", { name: "What changed" }).last();

async function say(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

test("journey steps 1–4: bought → Kitchen shows items → froze → Freezer → Undo", async ({ page, baseURL }, testInfo) => {
  await resetAndActAs(page, baseURL!, "demo-vero");

  // Step 2 (ux.md §8): empty Kitchen, suggestions, composer in the dock.
  await expect(kitchen(page)).toContainText("Your kitchen is empty. Tell me what you've got.");
  await expect(page.getByRole("group", { name: "Ideas to start with" })).toBeVisible();
  await expect(composer(page)).toBeVisible();
  await expectAccessible(page, "empty kitchen");

  // Step 3: "I bought …" → receipt with all 4 and Undo; Kitchen shows them as New; focus stays.
  await say(page, "I bought eggs, chicken thighs, spinach and yogurt");
  const bought = lastReceipt(page);
  for (const line of ["Added eggs", "Added chicken thighs", "Added spinach", "Added yogurt"]) {
    await expect(bought).toContainText(line);
  }
  await expect(bought.getByRole("button", { name: "Undo: Added eggs, Added chicken thighs, Added spinach, Added yogurt" })).toBeVisible();
  await expect(composer(page)).toBeFocused();
  const notSure = kitchen(page).getByRole("region", { name: "Not sure where" });
  for (const name of ["Eggs", "Chicken thighs", "Spinach", "Yogurt"]) {
    await expect(notSure.getByRole("listitem").filter({ hasText: name })).toContainText("New");
  }
  await expect(page.getByTestId("announcer")).toContainText("Kitchen updated.");
  await expectAccessible(page, "after bought");
  if (process.env.M2_SCREENSHOTS) {
    await page.waitForTimeout(700); // let the highlight settle
    await page.screenshot({ path: `docs/design/screenshots/m2-${testInfo.project.name}.png` });
  }

  // Step 4: "I froze the chicken" → "Chicken thighs → freezer"; it moves to Freezer, Updated.
  await say(page, "I froze the chicken");
  await expect(lastReceipt(page)).toContainText("Chicken thighs → freezer");
  const freezer = kitchen(page).getByRole("region", { name: "Freezer" });
  await expect(freezer.getByRole("listitem").filter({ hasText: "Chicken thighs" })).toContainText("Updated");
  await expect(notSure.getByText("Chicken thighs")).toHaveCount(0);
  await expectAccessible(page, "after froze");

  // Undo (step 9 of the script, done here): chicken goes back; the receipt says Undone.
  await lastReceipt(page).getByRole("button", { name: "Undo: Chicken thighs moved to the freezer" }).click();
  await expect(lastReceipt(page)).toContainText("Undone");
  await expect(kitchen(page).getByRole("region", { name: "Freezer" })).toHaveCount(0);
  await expect(notSure.getByRole("listitem").filter({ hasText: "Chicken thighs" })).toBeVisible();
  await expect(page.getByTestId("announcer")).toContainText("Undone:");
  await expectAccessible(page, "after undo");
});

test("anything the stand-in doesn't understand gets a polite reply and changes nothing", async ({ page, baseURL }) => {
  await resetAndActAs(page, baseURL!, "demo-vero");
  await say(page, "What can I make tonight?");
  await expect(page.getByText(/I'm a simple stand-in for now/)).toBeVisible();
  await expect(page.getByRole("region", { name: "What changed" })).toHaveCount(0);
  await expect(kitchen(page)).toContainText("Your kitchen is empty.");
});

test("the other person's change appears with 'Levi · just now', without moving focus", async ({ page, baseURL }) => {
  await resetAndActAs(page, baseURL!, "demo-vero");
  await composer(page).focus();

  const levi = await request.newContext({ baseURL, extraHTTPHeaders: { cookie: `${COOKIE}=demo-levi` } });
  const res = await levi.post("/api/chat", {
    data: { kitchenId: KITCHEN_ID, clientMessageId: `levi-${Date.now()}`, text: "I bought milk" },
  });
  expect(await res.text()).toContain('"type":"done"');
  await levi.dispose();

  // Coming back to the app checks right away (instead of waiting up to 15 s).
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(kitchen(page).getByRole("listitem").filter({ hasText: "Milk" })).toContainText("Levi · just now");
  await expect(page.getByTestId("announcer")).toContainText("Levi updated the kitchen.");
  await expect(composer(page)).toBeFocused();
  // Undo is only for your own changes: Vero has no receipt for Levi's milk.
  await expect(page.getByRole("button", { name: /^Undo/ })).toHaveCount(0);
});

test.describe("phone dock", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 900, "phone only");

  test("Peek, Full and Minimized; the chat button gets focus and a new-reply cue", async ({ page, baseURL }) => {
    await resetAndActAs(page, baseURL!, "demo-vero");
    await say(page, "I bought eggs");
    await expect(lastReceipt(page)).toContainText("Added eggs");

    // Peek shows only the latest reply; Full shows the whole conversation.
    const myMessage = page.getByText("You: I bought eggs");
    await expect(myMessage).toBeHidden();
    const show = page.getByRole("button", { name: "Show chat" });
    await expect(show).toHaveAttribute("aria-expanded", "false");
    await show.click();
    await expect(page.getByRole("button", { name: "Hide chat" })).toHaveAttribute("aria-expanded", "true");
    await expect(myMessage).toBeVisible();
    await expectAccessible(page, "full chat");
    await page.getByRole("button", { name: "Hide chat" }).click();

    // Minimize → the round chat button, focused.
    await page.getByRole("button", { name: "Minimize chat" }).click();
    const fab = page.getByRole("button", { name: "Open chat" });
    await expect(fab).toBeFocused();
    await expect(composer(page)).toBeHidden();
    await expectAccessible(page, "minimized");

    // A reply that arrives while minimized shows the dot, named in words too.
    await fab.click();
    await expect(composer(page)).toBeFocused();
    await page.route("**/api/chat", async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    await say(page, "The eggs are running low");
    await page.getByRole("button", { name: "Minimize chat" }).click();
    await expect(page.getByRole("button", { name: "Open chat, new reply" })).toBeVisible();
    await page.getByRole("button", { name: "Open chat, new reply" }).click();
    await expect(lastReceipt(page)).toContainText("Eggs: running low");
  });
});

test.describe("desktop layout", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 900, "desktop only");

  test("chat on the left (1/3), workspace on the right (2/3), no dock controls", async ({ page, baseURL }) => {
    await resetAndActAs(page, baseURL!, "demo-vero");
    const chat = await page.getByRole("region", { name: "Chat" }).boundingBox();
    const work = await page.getByRole("main", { name: "Workspace" }).boundingBox();
    expect(chat && work).toBeTruthy();
    expect(chat!.x).toBeLessThan(work!.x);
    expect(chat!.width / (chat!.width + work!.width)).toBeCloseTo(1 / 3, 1);
    await expect(page.getByRole("button", { name: "Minimize chat" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Show chat" })).toBeHidden();
  });
});
