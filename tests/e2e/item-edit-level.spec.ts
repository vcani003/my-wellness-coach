/**
 * The level buttons next to a typed amount in the edit sheet (Vero's iPhone bug, 0045 KOS3/KOS4):
 * "If I have an amount and then try to select Running low, it doesn't allow me to save."
 * (a) the item already has an amount → tap Running low → it's saved, and the sheet says so.
 * (b) type a new amount → tap Running low → the typed amount is still there, Save is on, and
 *     Save keeps it (not refused as someone else's change).
 */
import { expect, test, type Page } from "@playwright/test";
import { goTo, openChat } from "../support/places";

const COOKIE = "dev_acting_as";

async function resetAndActAs(page: Page, baseURL: string) {
  // Like a phone opening the preview by Wi-Fi address (plain http): no crypto.randomUUID.
  await page.addInitScript(() => {
    Reflect.deleteProperty(Crypto.prototype, "randomUUID");
  });
  const res = await page.request.post("/api/dev/reset", { headers: { origin: baseURL } });
  expect(res.ok()).toBe(true);
  await page.context().addCookies([{ name: COOKIE, value: "demo-vero", url: baseURL }]);
  await page.goto("/");
  await openChat(page);
}

const kitchen = (page: Page) => page.getByRole("region", { name: "Kitchen" });
const composer = (page: Page) => page.getByRole("textbox", { name: "Message Lumi" });

async function say(page: Page, text: string) {
  await expect(async () => {
    await composer(page).fill(text);
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled({ timeout: 500 });
  }).toPass();
  await composer(page).press("Enter");
}

async function fishSauceWithAmount(page: Page, baseURL: string) {
  await resetAndActAs(page, baseURL);
  await say(page, "I bought fish sauce");
  await expect(page.getByRole("region", { name: "What changed" }).last()).toContainText("Added fish sauce");
  await goTo(page, "Kitchen");
  const edit = kitchen(page).getByRole("button", { name: "Edit fish sauce" });
  await edit.click();
  const sheet = page.getByRole("dialog", { name: "Edit fish sauce" });
  await sheet.getByRole("textbox", { name: "Amount (optional)" }).fill("1 bottle");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(kitchen(page).getByRole("region", { name: "What changed" })).toContainText("Updated fish sauce");
  await expect(edit).toHaveAccessibleDescription(/1 bottle/);
  return { edit, sheet };
}

test("(a) an item with an amount → Running low saves at once, and the sheet says so", async ({ page, baseURL }) => {
  const { edit, sheet } = await fishSauceWithAmount(page, baseURL!);
  await edit.click();
  await expect(sheet.getByRole("textbox", { name: "Amount (optional)" })).toHaveValue("1 bottle");
  const low = sheet.getByRole("group", { name: "How much is left?" }).getByRole("button", { name: "Running low" });
  await low.click();
  await expect(low).toHaveAttribute("aria-pressed", "true");
  // A clear in-sheet confirmation that it's saved; no error; nothing left for Save, so Done is the one way out.
  await expect(sheet.locator("[data-level-status]")).toContainText("Saved");
  await expect(sheet.getByRole("alert")).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Save" })).toHaveCount(0);
  await expect(sheet.locator("[data-sheet-note]")).toContainText(/running low/i);
  // The amount is untouched.
  await expect(sheet.getByRole("textbox", { name: "Amount (optional)" })).toHaveValue("1 bottle");
  // Done closes; the row reads Running low.
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(kitchen(page).locator("li[data-entity-id]").filter({ hasText: /Fish sauce/ })).toContainText(/Running low/i);
});

/** A slow answer (the phone preview over Wi-Fi, a dev server compiling): every server action waits. */
async function slowServer(page: Page, ms: number) {
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (req.method() === "POST" && req.headers()["next-action"]) await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

test("(b, slow) type an amount → Running low → Save at once, while the level is still saving: both are saved", async ({ page, baseURL }) => {
  const { edit, sheet } = await fishSauceWithAmount(page, baseURL!);
  await slowServer(page, 1500);
  await edit.click();
  const amount = sheet.getByRole("textbox", { name: "Amount (optional)" });
  await amount.fill("half a bottle");
  const low = sheet.getByRole("group", { name: "How much is left?" }).getByRole("button", { name: "Running low" });
  await low.click();
  // While it saves, the level says so; Save is still Save (the typed amount is still to send).
  await expect(sheet.locator("[data-level-status]")).toContainText("Saving…");
  // A finger doesn't wait: tap Save right away (Playwright would otherwise wait for the level's save).
  const save = sheet.locator("[data-edit-save]");
  await expect(save).toHaveText("Save");
  await save.click({ force: true });
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
  const row = kitchen(page).locator("li[data-entity-id]").filter({ hasText: /Fish sauce/ });
  await expect(edit).toHaveAccessibleDescription(/half a bottle/);
  await expect(row).toContainText(/Running low/i);
  await expect(row.locator("[data-item-note]")).toHaveAttribute("data-item-note", "receipt");
});

test("(a, slow) an item with an amount → Running low: 'Saving…' by the level, then 'Saved', and Done to close", async ({ page, baseURL }) => {
  const { edit, sheet } = await fishSauceWithAmount(page, baseURL!);
  await slowServer(page, 1500);
  await edit.click();
  const low = sheet.getByRole("group", { name: "How much is left?" }).getByRole("button", { name: "Running low" });
  await low.click();
  await expect(sheet.locator("[data-level-status]")).toContainText("Saving…");
  // The footer doesn't pretend the level is waiting for Save.
  await expect(sheet.getByRole("button", { name: "Saving…" })).toHaveCount(0);
  await expect(sheet.locator("[data-level-status]")).toContainText("Saved", { timeout: 15_000 });
  await expect(low).toHaveAttribute("aria-pressed", "true");
  await expect(sheet.getByRole("button", { name: "Save" })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("(b) type an amount → Running low → the typed amount stays, Save is on and keeps it", async ({ page, baseURL }) => {
  const { edit, sheet } = await fishSauceWithAmount(page, baseURL!);
  await edit.click();
  const amount = sheet.getByRole("textbox", { name: "Amount (optional)" });
  await amount.fill("half a bottle");
  const low = sheet.getByRole("group", { name: "How much is left?" }).getByRole("button", { name: "Running low" });
  await low.click();
  await expect(low).toHaveAttribute("aria-pressed", "true");
  await expect(amount).toHaveValue("half a bottle");
  const save = sheet.getByRole("button", { name: "Save" });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const row = kitchen(page).locator("li[data-entity-id]").filter({ hasText: /Fish sauce/ });
  await expect(row.locator("[data-item-note]")).toHaveAttribute("data-item-note", "receipt");
  await expect(edit).toHaveAccessibleDescription(/half a bottle/);
  await expect(row).toContainText(/Running low/i);
});
