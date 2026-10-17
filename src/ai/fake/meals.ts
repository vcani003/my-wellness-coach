/**
 * ⚠️ FAKE MEAL AI (a stand-in, NOT the real AI): deterministic ideas and recipes so local dev and
 * the end-to-end tests run with no accounts (backend-data.md §8). It builds model-shaped answers
 * from the kitchen and sends them through the SAME code guards as the real one (uses/missing,
 * basics, allergen flags and the leave-out rule, the In-your-kitchen/Need split, recipe.save).
 */
import { askedAllergies } from "../meals/allergen-guard";
import { applyRecipeEdits } from "../meals/apply-edits";
import { basicsNote } from "../meals/basics";
import { labelMaps } from "../meals/context";
import { matchKitchenItem } from "../meals/match";
import type { IdeaOut, RecipeEditOut, RecipeOutput } from "../meals/model-output";
import { toRefinedIdea } from "../meals/refine-idea";
import { toIdea } from "../meals/to-ideas";
import { toRecipeResult } from "../meals/to-recipe";
import type {
  GeneratedIdea,
  IdeaRefineInput,
  IdeaRefineResult,
  IdeasEvent,
  MealAI,
  MealIdeasInput,
  PastedRecipeInput,
  RecipeEvent,
  RecipeInput,
  RecipeResult,
} from "../meals/types";
import { allergenExcusedIds, rankUseItUp } from "../meals/use-it-up";
import { collectIdeas, collectRecipe } from "../real/meals";

/**
 * A named dish's ingredients (MI1), the fake way: kitchen items a word of the title names
 * ("chicken" → chicken thighs), then everything listed in the notes ("with X, Y and Z", "I have
 * X"), as said. Code then sorts them into In your kitchen / Need, as for the real model.
 */
function dishIngredients(input: RecipeInput, toLabel: Map<string, string>): RecipeOutput["ingredients"] {
  const fromTitle = input.meal.title
    .split(/\s+/)
    .map((word) => matchKitchenItem(input.state, word))
    .filter((i): i is NonNullable<typeof i> => Boolean(i));
  const named = (input.meal.notes ?? "")
    .split(/[.!?;]+/)
    .map((s) => s.trim().replace(/^(?:and\s+)?(?:with|(?:i|we)\s+(?:also\s+)?(?:have|'ve got|got)|use)\s+(?:also\s+)?/i, ""))
    .flatMap((s) => s.split(/\s*,\s*(?:and\s+)?|\s+and\s+/i))
    .map((s) => s.trim().replace(/^(?:a|an|some|the)\s+/i, ""))
    .filter(Boolean);
  const out: RecipeOutput["ingredients"] = [];
  const seen = new Set<string>();
  for (const item of fromTitle) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push({ name: item.name.value, amount: null, item: toLabel.get(item.id) ?? null, basic: false });
  }
  for (const name of named) {
    const item = matchKitchenItem(input.state, name);
    if (item && seen.has(item.id)) continue;
    if (item) seen.add(item.id);
    out.push({ name, amount: null, item: item ? (toLabel.get(item.id) ?? null) : null, basic: false });
  }
  return out;
}

type Current = NonNullable<RecipeInput["refine"]>["current"];

/**
 * The fake's edit mode, for e2e tests and testers: a few fixed phrasings become edits; anything
 * else is a rewrite (as before). Generic on purpose: no dish-specific words.
 * - "I'm using baby carrots too" / "add baby carrots" → a new ingredient at the end, worked into the last step
 * - "no garlic" / "I don't have garlic" / "without garlic" → that ingredient removed
 * - "use 3 eggs instead of 2" → that ingredient's amount changed
 * - "skip step 2" → that step removed
 */
export function fakeEdits(text: string, current: Current): { edits: RecipeEditOut[]; reply: string } | null {
  const t = text.trim().replace(/[.!?]+$/, "");
  const blank = { name: "", amount: "", item: "", text: "" };
  const find = (words: string) => {
    const w = words.trim().toLowerCase();
    return current.ingredients.findIndex((i) => i.name.toLowerCase() === w || i.name.toLowerCase().includes(w) || w.includes(i.name.toLowerCase()));
  };
  let m = /^skip step (\d+)$/i.exec(t);
  if (m) return { edits: [{ ...blank, op: "remove_step", at: Number(m[1]) }], reply: `Skipped step ${m[1]}.` };
  m = /^use (\d+) (.+?) instead of (\d+)$/i.exec(t);
  if (m) {
    const at = find(m[2]);
    if (at < 0) return null;
    return { edits: [{ ...blank, op: "change_ingredient", at: at + 1, name: current.ingredients[at].name, amount: m[1] }], reply: `Changed it to ${m[1]} ${m[2]}.` };
  }
  m = /^(?:no|without|i don'?t have(?: any)?|i'?m out of) (.+)$/i.exec(t);
  if (m) {
    const at = find(m[1]);
    if (at < 0) return null;
    return { edits: [{ ...blank, op: "remove_ingredient", at: at + 1 }], reply: `Took out the ${current.ingredients[at].name}.` };
  }
  m = /^(?:i'?m (?:also )?using (.+?) too|add (?:some )?(.+))$/i.exec(t);
  if (m) {
    const name = (m[1] ?? m[2]).trim();
    const last = current.steps.length;
    if (!name || last === 0) return null;
    return {
      edits: [
        { ...blank, op: "add_ingredient", at: current.ingredients.length, name },
        { ...blank, op: "change_step", at: last, text: `${current.steps[last - 1]} Add the ${name} too.` },
      ],
      reply: `Added ${name} and worked it into step ${last}.`,
    };
  }
  return null;
}

const title = (s: string) => s.replace(/\s*\(.*?\)\s*/g, " ").trim().replace(/^\w/, (c) => c.toUpperCase());

/** "…in the first one", "…from the curry", "…in my curry": where the change goes, not what. */
const WHERE = String.raw`(?:\s+(?:in|on|from|out of|to)\s+(?:the|my|this|that)\b.*)?`;
const FAKE_IDEA_SWAP = new RegExp(String.raw`\b(?:swap|switch|replace)\s+(?:the\s+)?(.+?)\s+(?:for|with)\s+(?:some\s+)?(.+?)${WHERE}$`, "i");
const FAKE_IDEA_INSTEAD = new RegExp(String.raw`\buse\s+(?:the\s+|some\s+)?(.+?)\s+instead of\s+(?:the\s+)?(.+?)${WHERE}$`, "i");
const FAKE_IDEA_REMOVE = new RegExp(
  String.raw`\b(?:remove|take out|leave out|without|no|(?:i\s+)?don'?t want(?:\s+to use)?)\s+(?:the\s+|any\s+)?(.+?)${WHERE}$`,
  "i",
);
const FAKE_IDEA_ADD = new RegExp(String.raw`\b(?:use|add)\s+(?:the\s+|some\s+)?(.+?)\s+(?:in|to)\s+(?:the|my|this)\b.*$`, "i");

/**
 * The fake's idea change (ai.md §5 "Refining an idea"), for e2e tests and testers: "remove the X
 * from …", "no X in …", "swap the X for Y in …", "use Y instead of X …", "use / add Y in …".
 * Generic on purpose (no dish words). Returns the whole card, model-shaped, plus a reply.
 */
export function fakeIdeaChange(text: string, idea: IdeaRefineInput["idea"], input: IdeaRefineInput): { out: IdeaOut; reply: string } {
  const t = text.trim().replace(/[.!?]+$/, "");
  const { toLabel } = labelMaps(input);
  const nameOf = (id: string) => input.state.items.find((i) => i.id === id)?.name.value ?? "";
  const hits = (name: string, words: string) => {
    const a = name.toLowerCase();
    const w = words.trim().toLowerCase();
    return Boolean(w) && (a === w || a.includes(w) || w.includes(a));
  };
  let uses = [...idea.uses];
  let missing = [...idea.missing];
  let name = idea.name;
  let why = idea.why;
  const swapWord = (s: string, from: string, to: string) =>
    s
      .replace(new RegExp(String.raw`\b${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\b`, "i"), to)
      .replace(/\s{2,}/g, " ")
      .trim();
  const remove = (words: string) => {
    const before = uses.length + missing.length;
    uses = uses.filter((id) => !hits(nameOf(id), words));
    missing = missing.filter((m) => !hits(m, words));
    return uses.length + missing.length < before;
  };
  const add = (words: string) => {
    const item = matchKitchenItem(input.state, words);
    if (item) {
      if (!uses.includes(item.id)) uses.push(item.id);
    } else if (!missing.some((m) => hits(m, words))) missing.push(words.trim());
  };
  let reply = "";
  let m = FAKE_IDEA_SWAP.exec(t) ?? null;
  let from = m?.[1];
  let to = m?.[2];
  if (!m) {
    m = FAKE_IDEA_INSTEAD.exec(t);
    from = m?.[2];
    to = m?.[1];
  }
  if (m && from && to) {
    if (remove(from)) {
      add(to);
      name = swapWord(name, from, title(to));
      why = swapWord(why, from, to);
      reply = `Swapped the ${from} for ${to}.`;
    }
  } else if ((m = FAKE_IDEA_REMOVE.exec(t))) {
    const what = m[1];
    if (remove(what)) {
      name = swapWord(name, what, "") || idea.name;
      why = swapWord(why, what, "") || idea.why;
      reply = `Took the ${what} out of the ${idea.name} idea.`;
    }
  } else if ((m = FAKE_IDEA_ADD.exec(t))) {
    add(m[1]);
    reply = `Added ${m[1]} to the ${idea.name} idea.`;
  }
  const out: IdeaOut = {
    name: title(name),
    why,
    uses: uses.flatMap((id) => (toLabel.get(id) ? [toLabel.get(id)!] : [])),
    missing,
    basics: ["salt", "cooking oil"],
  };
  return { out, reply };
}

export function createFakeMealAI(now: () => Date = () => new Date()): MealAI {
  async function* streamMealIdeas(input: MealIdeasInput): AsyncGenerator<IdeasEvent> {
    const at = now();
    const count = input.count ?? 3;
    const { toId, toLabel } = labelMaps(input);
    const ranked = rankUseItUp(input.state, at);
    const rankedIds = new Set(ranked.map((r) => r.itemId));
    const order = [...ranked.map((r) => r.itemId), ...input.state.items.map((i) => i.id).filter((id) => !rankedIds.has(id))];
    const raw: IdeaOut[] = [];
    const asked = input.request?.text.trim();
    // "…a chicken curry with potatoes, yogurt and lemongrass": that dish, with those ingredients
    // (kitchen ones move to Uses through the same guard as the real model's).
    const withList = asked ? /\b(?:a|an)\s+([a-z][a-z' -]*?)\s+with\s+(.+?)[?!.]*$/i.exec(asked) : null;
    if (withList) {
      const fromTitle = withList[1].split(/\s+/).filter((w) => matchKitchenItem(input.state, w));
      const listed = withList[2].split(/\s*,\s*(?:and\s+)?|\s+and\s+/i).map((s) => s.trim()).filter(Boolean);
      raw.push({ name: title(withList[1]), why: "You asked for it", uses: [], missing: [...fromTitle, ...listed], basics: ["salt"] });
    } else if (asked && /\b(taco|soup|salad|curry|stir.?fry|omelette|pasta|noodle|rice|pho)/i.test(asked)) {
      raw.push({ name: title(asked.replace(/[?!.]+$/, "")), why: "You asked for it", uses: [], missing: [asked.replace(/[?!.]+$/, "")], basics: ["salt"] });
    }
    for (const id of order) {
      const item = input.state.items.find((i) => i.id === id)!;
      const reason = ranked.find((r) => r.itemId === id)?.reasons[0];
      raw.push({
        name: `${title(item.name.value)} rice bowl`,
        why: reason ? `Uses the ${item.name.value} (${reason})` : `Uses your ${item.name.value}`,
        uses: [toLabel.get(id)!],
        missing: [],
        basics: ["salt", "cooking oil"],
      });
    }
    const guard = {
      ctx: input,
      labels: toId,
      useItUp: rankedIds,
      allergenExcused: allergenExcusedIds(ranked),
      asked: askedAllergies(input.request?.text, input.restrictions),
    };
    const kept: GeneratedIdea[] = [];
    let dropped = 0;
    for (const r of raw) {
      if (kept.length >= count) break;
      const v = toIdea(r, guard);
      if (!v) continue;
      if (!v.keep) {
        dropped++;
        continue;
      }
      kept.push(v.idea);
      yield { type: "idea", idea: v.idea };
    }
    const droppedForAllergens = Math.min(dropped, Math.max(0, count - kept.length));
    const note = basicsNote([...new Set(kept.flatMap((k) => k.basics))]);
    const reply = kept.length ? "Here are some ideas from your kitchen." : "Nothing in your kitchen fits that right now.";
    yield { type: "done", result: { ok: true, ideas: kept, reply, notes: note ? [note] : [], droppedForAllergens } };
  }

  async function* streamRecipe(input: RecipeInput): AsyncGenerator<RecipeEvent> {
    const { toId, toLabel } = labelMaps(input);
    const idea = input.meal.idea;
    const current = input.refine?.current;
    // A small refinement goes through edit mode and the SAME apply code as the real one.
    const edit = current ? fakeEdits(input.refine!.text, current) : null;
    if (edit) {
      const applied = applyRecipeEdits(current!, edit.edits, edit.reply, {
        ctx: input,
        labels: toId,
        mealId: input.meal.mealId,
        fallbackTitle: input.meal.title,
        source: "ai",
        opId: `${input.refine!.messageId}:recipe`,
        evidence: input.refine!.text,
      });
      if (applied.ok) {
        const r = applied.result;
        const g = r.recipe;
        yield {
          type: "part",
          part: "edit",
          data: {
            title: g.title,
            summary: g.summary,
            servings: g.servings,
            source: g.source,
            allergenFlags: g.allergenFlags,
            ingredients: g.ingredients,
            steps: g.steps,
            basics: g.basicsAssumed,
            note: basicsNote(g.basicsAssumed),
            changed: { ingredients: r.change.ingredients, steps: r.change.steps },
          },
        };
        yield { type: "done", result: r };
        return;
      }
    }
    // "…without yogurt" / "no yogurt" in the user's words about the meal or its idea: left out.
    const leftOut = [...`${input.meal.notes ?? ""}\n${idea?.notes ?? ""}`.matchAll(/\b(?:without|no|remove|don'?t want(?: to use)?)\s+(?:the\s+|any\s+)?([a-z][a-z ]*?)(?=$|[\n,.;!?]|\s+(?:in|from|on)\b)/gim)].map((m) => m[1].trim().toLowerCase());
    const kept = (name: string) => !leftOut.some((w) => name.toLowerCase().includes(w) || w.includes(name.toLowerCase()));
    const out: RecipeOutput = current
      ? {
          title: current.title,
          summary: `Adjusted: ${input.refine!.text}`,
          servings: current.servings ?? "2",
          ingredients: current.ingredients.map((i) => ({ name: i.name, amount: i.amount, item: i.itemId ? (toLabel.get(i.itemId) ?? null) : null, basic: i.group === "basic" })),
          steps: [...current.steps, `Adjusted for: ${input.refine!.text}`],
          reply: "Here's the updated recipe.",
        }
      : {
          title: input.meal.title,
          summary: "A quick suggestion from your kitchen.",
          servings: "2",
          ingredients: [
            ...(!idea ? dishIngredients(input, toLabel) : []),
            ...(idea?.uses ?? [])
              .map((id) => ({ name: input.state.items.find((i) => i.id === id)?.name.value ?? "", amount: null, item: toLabel.get(id) ?? null, basic: false }))
              .filter((i) => kept(i.name)),
            ...(idea?.missing ?? []).filter(kept).map((name) => ({ name, amount: null, item: null, basic: false })),
            { name: "salt", amount: "a pinch", item: null, basic: true },
            { name: "cooking oil", amount: "1 tbsp", item: null, basic: true },
          ],
          steps: ["Prepare the ingredients.", "Cook everything in a hot pan with the oil.", "Season with salt and serve."],
          reply: `Here's a recipe for ${input.meal.title}.`,
        };
    const result = toRecipeResult(out, {
      ctx: input,
      labels: toId,
      mealId: input.meal.mealId,
      fallbackTitle: input.meal.title,
      source: "ai",
      opId: input.refine ? `${input.refine.messageId}:recipe` : `recipe:${input.meal.mealId}`,
      ...(input.refine ? { evidence: input.refine.text } : {}),
    });
    if (!result.ok) {
      yield { type: "done", result: { ok: false, reason: "failed", reply: "Sorry, I couldn't write the recipe just now. Please try again." } };
      return;
    }
    const r = result.recipe;
    yield { type: "part", part: "meta", data: { title: r.title, summary: r.summary, servings: r.servings, source: "ai", allergenFlags: r.allergenFlags } };
    for (const [index, ing] of r.ingredients.entries()) yield { type: "part", part: "ingredient", data: { ...ing, index } };
    for (const [index, text] of r.steps.entries()) yield { type: "part", part: "step", data: { index, text } };
    yield { type: "part", part: "basics", data: { basics: r.basicsAssumed, note: basicsNote(r.basicsAssumed) } };
    yield { type: "done", result };
  }

  async function readPastedRecipe(input: PastedRecipeInput): Promise<RecipeResult> {
    const lines = input.text.split("\n").map((l) => l.trim()).filter(Boolean);
    const ingredients = lines.filter((l) => /^[-•*]\s*/.test(l)).map((l) => ({ name: l.replace(/^[-•*]\s*/, ""), amount: null, item: null, basic: false }));
    const steps = lines.filter((l) => /^\d+\s*[.)]/.test(l));
    const result = toRecipeResult(
      { title: input.meal.title, summary: "Your recipe.", servings: null, ingredients, steps, reply: `Saved your recipe for ${input.meal.title}.` },
      {
        ctx: input,
        labels: labelMaps(input).toId,
        mealId: input.meal.mealId,
        fallbackTitle: input.meal.title,
        source: "user",
        opId: `${input.messageId}:recipe`,
        evidence: lines[0] ?? input.meal.title,
        pastedText: input.text,
      },
    );
    return result.ok ? result : { ok: false, reason: "failed", reply: "Sorry, I couldn't read that recipe just now, so nothing was saved." };
  }

  return {
    streamMealIdeas,
    generateMealIdeas: (input) => collectIdeas(streamMealIdeas(input)),
    streamRecipe,
    generateRecipe: (input) => collectRecipe(streamRecipe(input)),
    readPastedRecipe,
    async refineIdea(input: IdeaRefineInput): Promise<IdeaRefineResult> {
      const { out, reply } = fakeIdeaChange(input.request.text, input.idea, input);
      return toRefinedIdea(out, reply, input, now());
    },
  };
}
