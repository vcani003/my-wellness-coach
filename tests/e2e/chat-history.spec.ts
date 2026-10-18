/**
 * Saved chat (P2 a): send → reload → your message, the reply and its "What changed" receipt are
 * still there (phone Peek shows the latest reply and receipt, like a live one) → Undo still works.
 * axe at each checkpoint. Set CHAT_HISTORY_SCREENSHOT=1 to save
 * docs/design/screenshots/chat-history-phone.png after the reload.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "../support/axe";
import { openChat } from "../support/places";

const COOKIE = "dev_acting_as"; // DEV_ACTING_AS_COOKIE (src/lib/auth/current-user.ts)

const kitchen = (page: Page) => page.getByRole("region", { name: "Kitchen" });
const composer = (page: Page) => page.getByRole("textbox", { name: "Message Lumi" });
const receipts = (page: Page) => page.getByRole("region", { name: "What changed" });
const UNDO = "Undo: Added eggs, Added spinach";

async function say(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

test("chat survives a reload: message, reply and receipt are back, and Undo still works", async ({ page, baseURL }, testInfo) => {
  const reset = await page.request.post("/api/dev/reset", { headers: { origin: baseURL! } });
  expect(reset.ok()).toBe(true);
  await page.context().addCookies([{ name: COOKIE, value: "demo-vero", url: baseURL! }]);
  await page.goto("/kitchen"); // the Kitchen place shows the undo's effect (0042)
  await openChat(page);

  await say(page, "I bought eggs and spinach");
  await expect(receipts(page).last()).toContainText("Added spinach");
  await expect(page.getByRole("button", { name: UNDO })).toBeVisible();

  await page.reload();
  await openChat(page);
  const phone = testInfo.project.name === "phone";
  const myMessage = page.getByText("You: I bought eggs and spinach");

  // The receipt is back, with Undo (still undoable), and nothing is shown twice.
  await expect(receipts(page)).toHaveCount(1);
  await expect(receipts(page)).toContainText("Added eggs");
  await expect(page.getByRole("button", { name: UNDO })).toBeVisible();
  // No welcome: this isn't a first run any more.
  await expect(page.getByRole("group", { name: "Ideas to start with" })).toHaveCount(0);
  if (phone) {
    // Peek shows the latest reply and its receipt, just like a live one; Full shows the rest.
    await expect(myMessage).toBeHidden();
    await expectAccessible(page, "peek after reload");
    if (process.env.CHAT_HISTORY_SCREENSHOT) {
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }); // dev-only badge
      await page.screenshot({ path: "docs/design/screenshots/chat-history-phone.png" });
    }
    await page.getByRole("button", { name: "Show chat" }).click();
  }
  await expect(myMessage).toBeVisible();
  await expectAccessible(page, "chat after reload");
  if (phone) await page.getByRole("button", { name: "Hide chat" }).click();

  // Undo on the saved receipt puts the kitchen back.
  await page.getByRole("button", { name: UNDO }).click();
  await expect(receipts(page)).toContainText("Undone");
  await expect(kitchen(page)).toContainText("Your kitchen is empty.");
  await expectAccessible(page, "after undo from saved chat");

  // A new live turn appends once, below the saved one (phone: Peek shows only the latest).
  await say(page, "I bought yogurt");
  await expect(receipts(page).last()).toContainText("Added yogurt");
  if (phone) await page.getByRole("button", { name: "Show chat" }).click();
  await expect(receipts(page)).toHaveCount(2);

  // After another reload the earlier receipt is no longer undoable (it was undone).
  await page.reload();
  await openChat(page);
  if (phone) await page.getByRole("button", { name: "Show chat" }).click();
  await expect(receipts(page)).toHaveCount(2);
  await expect(receipts(page).first()).toContainText("Added eggs");
  await expect(receipts(page).first()).toContainText("Undone");
  await expect(page.getByRole("button", { name: UNDO })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo: Added yogurt" })).toBeVisible();
});

test("an undone receipt still reads Undone after a reload (struck through, no Undo)", async ({ page, baseURL }, testInfo) => {
  const reset = await page.request.post("/api/dev/reset", { headers: { origin: baseURL! } });
  expect(reset.ok()).toBe(true);
  await page.context().addCookies([{ name: COOKIE, value: "demo-vero", url: baseURL! }]);
  await page.goto("/");
  await openChat(page);
  const phone = testInfo.project.name === "phone";
  const undo = page.getByRole("button", { name: "Undo: Added eggs" });

  await say(page, "I bought eggs");
  await expect(undo).toBeVisible();
  await undo.click();
  await expect(receipts(page)).toContainText("Undone");

  await page.reload();
  await openChat(page);
  if (phone) await page.getByRole("button", { name: "Show chat" }).click();
  await expect(receipts(page)).toHaveCount(1);
  await expect(receipts(page)).toContainText("Undone");
  await expect(receipts(page).getByRole("listitem").filter({ hasText: "Added eggs" })).toHaveClass(/line-through/);
  await expect(undo).toHaveCount(0);
  await expect(receipts(page).getByRole("button")).toHaveCount(0);
  await expectAccessible(page, "undone receipt after reload");
});
