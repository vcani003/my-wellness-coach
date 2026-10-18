/**
 * Journey steps 5–7 and after cooking (ux.md §8, decisions 0005, 0013) on the STAND-IN AI, at
 * phone and desktop size, with axe at each checkpoint. The stand-in declines meal ideas, a named
 * dish's recipe and recipe changes (0059 PF10: "only the real model can"), so the journey runs on
 * its clearly titled "Sample recipe (stand-in)":
 * ask for ideas → the decline line → "make me a sample recipe" → Recipe → Add to plan → Start
 * cooking → Done cooking → "Update your kitchen" (Running low + note) → Kitchen reflects it → Undo;
 * then the same in chat ("add that to my meal plan", "start cooking", "I made it") with Out, Do
 * later → To review. Ideas cards, Choose on a card, a named dish and recipe edits need the real AI
 * and are covered by integration tests with a scripted double (tests/support/scripted-ai).
 * Set MEAL_SCREENSHOTS=1 to save docs/design/screenshots/m-recipe-phone.png and
 * m-update-kitchen-phone.png.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "../support/axe";
import { goTo, openChat } from "../support/places";

const COOKIE = "dev_acting_as";
const KITCHEN_ID = "test-kitchen-demo";

async function resetAndActAs(page: Page, baseURL: string, path = "/") {
  const res = await page.request.post("/api/dev/reset", { headers: { origin: baseURL } });
  expect(res.ok()).toBe(true);
  await page.context().addCookies([{ name: COOKIE, value: "demo-vero", url: baseURL }]);
  await page.goto(path);
  await openChat(page);
}

const ideas = (page: Page) => page.getByRole("region", { name: "Meal ideas" });
const plan = (page: Page) => page.getByRole("region", { name: "Meal plan" });
const lastReceipt = (page: Page) => page.getByRole("region", { name: "What changed" }).last();
const kitchen = (page: Page) => page.getByRole("region", { name: "Kitchen" });
const recipe = (page: Page) => page.getByRole("article");
const composer = (page: Page) => page.getByRole("textbox", { name: "Message Lumi" });
const sheet = (page: Page) => page.getByRole("dialog", { name: "Update your kitchen" });
const shoot = (name: string) => `docs/design/screenshots/${name}`;

/** Types and sends; retries the typing until the page has hydrated (Send turns on). */
async function say(page: Page, text: string) {
  await expect(async () => {
    await composer(page).fill(text);
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled({ timeout: 500 });
  }).toPass();
  await composer(page).press("Enter");
}

async function screenshot(page: Page, isPhone: boolean, file: string) {
  if (!process.env.MEAL_SCREENSHOTS || !isPhone) return;
  // Hide Next's dev-only indicator; it isn't part of the app.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: shoot(file) });
}

/** The stand-in's one line for what only the real AI does (0059 PF10). */
const DECLINE = "That needs the real AI (Claude). I'm only the stand-in.";
const SAMPLE = "Sample recipe (stand-in)";
/** The kitchen as the server has it (nothing chosen or added by a declined message). */
const kitchenState = async (page: Page) =>
  (await (await page.request.get(`/api/kitchens/${KITCHEN_ID}/state`)).json()) as { meals: unknown[]; items: unknown[] };
const lastReply = (page: Page) => page.getByRole("log").getByText(DECLINE).last();

test("journey 5–7: ideas need the real AI → sample recipe → plan → cook → Update your kitchen (low + note) → Undo", async ({ page, baseURL }, testInfo) => {
  const isPhone = testInfo.project.name === "phone";
  await resetAndActAs(page, baseURL!, "/meals");
  await say(page, "I bought eggs, chicken thighs, spinach and yogurt");
  await expect(lastReceipt(page)).toContainText("Added yogurt");

  // Step 5 on the stand-in: the Meals place's "Get ideas" button asks in chat, and the stand-in
  // says only the real AI does ideas (PF10). No cards appear and nothing changes.
  await page.getByRole("button", { name: "Get ideas" }).click();
  await expect(lastReply(page)).toBeVisible();
  await expect(ideas(page).getByRole("listitem")).toHaveCount(0);
  await expect.poll(async () => (await kitchenState(page)).meals.length).toBe(0);

  // Step 6: a sample recipe opens at its own URL, clearly titled, labelled a suggestion; the dock stays.
  const names = [SAMPLE];
  await say(page, "make me a sample recipe");
  await expect(page).toHaveURL(/\/recipe\//);
  await expect(recipe(page).getByRole("heading", { level: 2, name: SAMPLE })).toBeVisible();
  await expect(recipe(page)).toContainText("Suggested recipe");
  await expect(recipe(page).getByRole("button", { name: "Use my own recipe" })).toBeVisible();
  await expect(recipe(page).getByRole("group", { name: "In your kitchen" })).toBeVisible();
  await expect(recipe(page).getByRole("group", { name: "Need" })).toBeVisible();
  await expect(recipe(page).getByRole("heading", { name: "Steps" })).toBeVisible();
  await expect(recipe(page)).toContainText("Assumes salt and cooking oil");
  await expect(composer(page)).toBeVisible();
  // A tick is shared and saved: it survives a reload.
  const salt = recipe(page).getByRole("checkbox", { name: "Salt" });
  await expect(salt).toBeEnabled();
  await salt.check();
  await expect(salt).toBeChecked();
  // Saved for everyone (not just shown): the kitchen's state has the tick.
  await expect
    .poll(async () => ((await (await page.request.get(`/api/kitchens/${KITCHEN_ID}/state`)).json()) as { ticks: unknown[] }).ticks.length)
    .toBe(1);
  await expectAccessible(page, "recipe");
  await screenshot(page, isPhone, "m-recipe-phone.png");
  await page.reload();
  await openChat(page);
  await expect(recipe(page).getByRole("checkbox", { name: "Salt" })).toBeChecked();

  // "Use my own recipe" readies the composer for a paste.
  await recipe(page).getByRole("button", { name: "Use my own recipe" }).click();
  await expect(composer(page)).toHaveValue(`My recipe for ${names[0]}: `);
  await expect(composer(page)).toBeFocused();
  await composer(page).fill("");

  // Step 7: Add to plan → Start cooking, then Back goes to Meals (the Recipe's place); the Plan has it.
  await recipe(page).getByRole("button", { name: "Add to plan" }).click();
  await expect(recipe(page)).toContainText("In your plan");
  await recipe(page).getByRole("button", { name: "Start cooking" }).click();
  await expect(recipe(page).getByRole("button", { name: "Done cooking" })).toBeVisible();
  await recipe(page).getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/meals$/);
  // (The reload above ended this session's ideas: they're never saved, 0013.)
  await expect(page.getByRole("region", { name: "Meals" })).toBeVisible();
  await goTo(page, "Plan");
  const row = plan(page).getByRole("listitem").filter({ hasText: names[0] });
  await expect(row).toContainText("Cooking");
  await expectAccessible(page, "meal plan");

  // Done cooking → "Update your kitchen": Running low + a note → Kitchen shows it → Undo.
  await plan(page).getByRole("button", { name: `Done cooking ${names[0]}` }).click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page)).toContainText(`Cooked: ${names[0]}`);
  const groups = sheet(page).getByRole("radiogroup");
  await expect(groups).toHaveCount(1);
  await expect(groups.first().getByRole("radio", { name: "Still have some" })).toBeChecked();
  // The visible segment is the radio's label (the radio itself is visually hidden).
  await groups.first().getByText("Running low", { exact: true }).click();
  await expect(groups.first().getByRole("radio", { name: "Running low" })).toBeChecked();
  await sheet(page).getByRole("textbox", { name: /Anything to remember/ }).fill("Used the last of the big pack");
  await expectAccessible(page, "update your kitchen");
  await screenshot(page, isPhone, "m-update-kitchen-phone.png");
  await sheet(page).getByRole("button", { name: "Done" }).click();
  await expect(sheet(page)).toHaveCount(0);

  // The result shows where you are (the Plan) and on the Kitchen, with Undo.
  await expect(plan(page)).toContainText(`Updated your kitchen after ${names[0]}: 1 running low.`);
  await goTo(page, "Kitchen");
  await expect(kitchen(page)).toContainText(`Updated your kitchen after ${names[0]}: 1 running low.`);
  await expect(kitchen(page).getByRole("listitem").filter({ hasText: "Running low" })).toHaveCount(1);
  await expectAccessible(page, "after update your kitchen");
  await kitchen(page).getByRole("button", { name: `Undo: kitchen update after ${names[0]}` }).click();
  await expect(kitchen(page)).toContainText("Undone.");
  await expect(kitchen(page).getByRole("listitem").filter({ hasText: "Running low" })).toHaveCount(0);
});

test("in chat: a sample recipe; plan, cook, 'I made it' → Out → Do later → To review → Done", async ({ page, baseURL }) => {
  await resetAndActAs(page, baseURL!, "/meals");
  await say(page, "I bought eggs, chicken thighs, spinach and yogurt");
  await expect(lastReceipt(page)).toContainText("Added yogurt");
  // Picking an idea card needs the real AI (PF10).
  await say(page, "the second one");
  await expect(lastReply(page)).toBeVisible();
  const names = [`${SAMPLE}: Chicken stir-fry`];

  // The sample recipe opens; focus stays in the composer; the chicken thighs are In your kitchen.
  await say(page, "make me a sample recipe for chicken stir-fry");
  await expect(page).toHaveURL(/\/recipe\//);
  await expect(recipe(page).getByRole("heading", { level: 2, name: names[0] })).toBeVisible();
  await expect(recipe(page).getByRole("group", { name: "In your kitchen" })).toContainText(/chicken thighs/i);
  await expect(composer(page)).toBeFocused();

  await say(page, "Add that to my meal plan");
  await expect(recipe(page)).toContainText("In your plan");
  await say(page, "start cooking");
  await expect(recipe(page)).toContainText("Cooking");
  await page.goBack();
  await expect(page).toHaveURL(/\/meals$/);

  // "I made it" → the sheet opens from the stream; Out, then Do later puts it in To review.
  await say(page, "I made it");
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page)).toContainText(`Cooked: ${names[0]}`);
  await sheet(page).getByRole("button", { name: "Do later" }).click();
  await expect(sheet(page)).toHaveCount(0);
  await goTo(page, "Kitchen");
  const card = kitchen(page).getByRole("button", { name: `Update your kitchen · ${names[0]}` });
  await expect(card).toBeVisible();
  await expectAccessible(page, "to review after cooking");

  // From To review: Out + a note → Done closes the card and the item leaves the Kitchen.
  const itemCount = await kitchen(page).getByRole("listitem").count();
  await card.click();
  await expect(sheet(page)).toBeVisible();
  await sheet(page).getByRole("radiogroup").first().getByText("Out", { exact: true }).click();
  await sheet(page).getByRole("textbox", { name: /Anything to remember/ }).fill("Finished it");
  await sheet(page).getByRole("button", { name: "Done" }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(card).toHaveCount(0);
  await expect(kitchen(page)).toContainText(`Updated your kitchen after ${names[0]}: 1 out.`);
  await expect(kitchen(page).getByRole("listitem")).toHaveCount(itemCount - 2); // the To review row and the item
});

test("Cancel in the Meal plan leaves 'cancelled · Undo'; Undo brings it back", async ({ page, baseURL }) => {
  await resetAndActAs(page, baseURL!, "/meals");
  await say(page, "I bought eggs and spinach");
  await expect(lastReceipt(page)).toContainText("Added spinach");
  await say(page, "make me a sample recipe");
  await expect(page).toHaveURL(/\/recipe\//);
  const name = await recipe(page).getByRole("heading", { level: 2 }).textContent();
  await say(page, "Add that to my meal plan");
  await expect(recipe(page)).toContainText("In your plan");
  await recipe(page).getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/meals$/);
  await goTo(page, "Plan");
  await plan(page).getByRole("button", { name: `Cancel ${name}` }).click();
  await expect(plan(page)).toContainText(`${name} cancelled`);
  await expectAccessible(page, "after cancel");
  await plan(page).getByRole("button", { name: `Undo: cancelled ${name}` }).click();
  await expect(plan(page).getByRole("button", { name: `Start cooking ${name}` })).toBeVisible();
});

test("in chat: a named dish needs the real AI (PF10); 'sample recipe for chicken curry' opens a sample with a Need list", async ({ page, baseURL }) => {
  await resetAndActAs(page, baseURL!, "/meals");
  await say(page, "I bought chicken thighs");
  await expect(lastReceipt(page)).toContainText("Added chicken thighs");

  // The stand-in never writes a named dish's recipe or adds what the message says you have.
  await say(page, "i was thinking a chicken curry, with coconut milk, lemongrass. I have a curry base seasoning packet. i also have potatoes");
  await expect(lastReply(page)).toBeVisible();
  await expect(page).toHaveURL(/\/meals$/);
  await expect.poll(async () => (await kitchenState(page)).meals.length).toBe(0);
  await expect.poll(async () => (await kitchenState(page)).items.length).toBe(1); // no potatoes or "curry base" added

  await say(page, "make me a sample recipe for chicken curry");
  await expect(page).toHaveURL(/\/recipe\//);
  await expect(recipe(page).getByRole("heading", { level: 2, name: `${SAMPLE}: Chicken curry` })).toBeVisible();
  await expect(recipe(page).getByRole("group", { name: "In your kitchen" })).toContainText(/chicken thighs/i);
  const need = recipe(page).getByRole("group", { name: "Need" });
  for (const name of [/coconut milk/i, /curry paste/i]) await expect(need).toContainText(name);
});

test("in chat: a recipe change needs the real AI (PF10): the open recipe stays exactly as it was", async ({ page, baseURL }) => {
  await resetAndActAs(page, baseURL!);
  await say(page, "I bought chicken thighs and potatoes");
  await expect(lastReceipt(page)).toContainText(/potatoes/i);
  await say(page, "make me a sample recipe for chicken stew");
  await expect(page).toHaveURL(/\/recipe\//);
  const steps = recipe(page).getByRole("listitem");
  const stepText = steps.locator("span:not([aria-hidden])");
  await expect(steps.nth(3)).toBeVisible();
  const before = await stepText.allTextContents();

  for (const text of ["I'm using baby carrots too", "skip step 1", "how much chicken do I need?"]) {
    await say(page, text);
    await expect(page.getByRole("log").getByText(DECLINE)).toHaveCount(["I'm using baby carrots too", "skip step 1", "how much chicken do I need?"].indexOf(text) + 1);
  }
  await expect(recipe(page).getByRole("checkbox", { name: "Baby carrots" })).toHaveCount(0);
  await expect(recipe(page).locator("[data-recipe-changed]")).toHaveCount(0);
  expect(await stepText.allTextContents()).toEqual(before);
  await expectAccessible(page, "recipe after a declined change");
});
