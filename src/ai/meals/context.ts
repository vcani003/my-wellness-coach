/**
 * The per-request part of an idea or recipe call (ai.md §2): kitchen with labels, what needs
 * using up, every member's allergies with their notes, the asker's diets and preferences, and the
 * request. All of it is data; look-alike tags are stripped so text can't open or close a section.
 */
import { itemLabels, renderKitchen } from "../real/prompt";
import { restrictionLines } from "./allergen-guard";
import { rankUseItUp } from "./use-it-up";
import type { MealContext, MealIdeasInput, PastedRecipeInput, RecipeInput } from "./types";

const TAGS =
  "today|kitchen|use_it_up|allergies|preferences|recent_chat|request|count|meal|current_recipe|change_request|pasted_content|shopping_list|user_message|regenerate";
const TAG_RE = new RegExp(String.raw`<\/?\s*(${TAGS})\b[^>]*>`, "gi");

export function neutralizeAll(text: string): string {
  return text.replace(TAG_RE, "");
}

const section = (tag: string, body: string) => `<${tag}>\n${neutralizeAll(body)}\n</${tag}>`;

/** label (i3) → item ID and back. */
export function labelMaps(ctx: MealContext) {
  const toId = itemLabels(ctx.state);
  const toLabel = new Map([...toId].map(([label, id]) => [id, label]));
  return { toId, toLabel };
}

function common(ctx: MealContext, now: Date): string[] {
  const { toLabel } = labelMaps(ctx);
  const useItUp = rankUseItUp(ctx.state, now)
    .map((u) => `${toLabel.get(u.itemId) ?? "?"}: ${u.name} · ${u.reasons.join(", ")}`)
    .join("\n");
  const allergies = restrictionLines(ctx.restrictions, ctx.members, ctx.userId).join("\n");
  const prefs = (ctx.preferences ?? []).join("\n");
  const chat = (ctx.history ?? [])
    .slice(-6)
    .map((t) => `${t.role === "user" ? "User" : "Kitchen"}: ${t.text}`)
    .join("\n");
  return [
    `<today>${now.toISOString().slice(0, 10)}</today>`,
    section("kitchen", renderKitchen(ctx.state, now)),
    section("use_it_up", useItUp || "(nothing urgent)"),
    section("allergies", allergies || "(none)"),
    section("preferences", prefs || "(none)"),
    section("recent_chat", chat || "(none)"),
  ];
}

export function renderIdeasRequest(input: MealIdeasInput, now: Date, extra?: string): string {
  return [
    ...common(input, now),
    section("request", input.request?.text.trim() || "(none: suggest from the kitchen)"),
    `<count>${input.count ?? 3}</count>`,
    ...(extra ? [extra] : []),
  ].join("\n\n");
}

function mealSection(input: MealContext & { meal: RecipeInput["meal"] }): string {
  const { toLabel } = labelMaps(input);
  const idea = input.meal.idea;
  const lines = [`Dish: ${input.meal.title}`];
  if (idea) {
    lines.push(`Why it was suggested: ${idea.why}`);
    const uses = idea.uses.map((id) => toLabel.get(id)).filter(Boolean);
    if (uses.length) lines.push(`Uses: ${uses.join(", ")}`);
    if (idea.missing.length) lines.push(`Missing: ${idea.missing.join(", ")}`);
  }
  return section("meal", lines.join("\n"));
}

export function renderRecipeRequest(input: RecipeInput, now: Date): string {
  const parts = [...common(input, now), mealSection(input)];
  if (input.refine) {
    const c = input.refine.current;
    const recipe = [
      `Title: ${c.title}`,
      ...(c.servings ? [`Servings: ${c.servings}`] : []),
      "Ingredients:",
      ...c.ingredients.map((i) => `- ${i.amount ? `${i.amount} ` : ""}${i.name}`),
      "Steps:",
      ...c.steps.map((s, i) => `${i + 1}. ${s}`),
    ].join("\n");
    parts.push(section("current_recipe", recipe), section("change_request", input.refine.text));
  }
  return parts.join("\n\n");
}

export function renderPastedRequest(input: PastedRecipeInput, now: Date): string {
  return [...common(input, now), mealSection(input), section("pasted_content", input.text)].join("\n\n");
}
