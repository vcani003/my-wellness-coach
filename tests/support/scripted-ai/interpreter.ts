/**
 * TEST-ONLY scripted interpreter (never shipped, never the app's stand-in). The stand-in AI only
 * does simple kitchen updates and declines questions, ideas, dish recipes and recipe or idea changes
 * (0059 PF10). The pipeline tests still drive those flows through `handleChatTurn`, so this wraps
 * the stand-in with its old meal phrasings, routed through the SAME code as the real interpreter
 * (meal-ops.ts `mealOperations`):
 *   "what can I make?" / "any other ideas?" → ideas · "the second one" → choose that card ·
 *   "I was thinking a <dish>, … I have X" / "I want to make <dish>" → adds + choose + recipe ·
 *   with a recipe open: "no X", "skip step 2", "use 3 X instead of 2", "I'm using X too", "make it …"
 *   and questions about it → recipe_change · on idea cards: "remove the X from the <idea>",
 *   "swap the X for Y in the first one", "make the <idea> without X".
 * Everything else goes to the stand-in unchanged.
 */
import type { InterpretRequest, InterpretResult, Interpreter } from "@/ai/interpreter";
import { createFakeInterpreter, type RecentChangesLookup } from "@/ai/fake";
import { matchIntent, toSegment, type Segment } from "@/ai/fake/patterns";
import { CHANGES_A_DISH, mealOperations, WANTS_RECIPE } from "@/ai/real/meal-ops";
import type { ModelOutput } from "@/ai/real/model-output";
import type { ProposedChange } from "@/contracts/proposed-change";
import { nameTokens } from "@/shared/text";
import { isFakeRecipeQuestion } from "./recipe-text";

type Op = ProposedChange["operations"][number];

/** The recipe changes the scripted meal AI understands (`fakeEdits`), plus "make it vegetarian" (a rewrite). */
export const SCRIPTED_RECIPE_CHANGE =
  /^(skip step \d+|use \d+ .+ instead of \d+|(no|without|i don'?t have( any)?) [a-z].*|i'?m (also )?using .+ too|make it .+)[.!?]*$/i;

const said = <T>(value: T) => ({ value, basis: "said" as const, confidence: "high" as const });
const list = (names: string[]) => new Intl.ListFormat("en", { type: "conjunction" }).format(names);
const empty = { clarification: null, rememberPreference: null, listOfferAccepted: null } as const;
const base = (req: InterpretRequest) => ({
  proposalId: req.message.id,
  kitchenId: req.kitchenId,
  basedOnVersion: req.version,
  source: { via: "chat" as const, messageId: req.message.id },
});

const IDEAS = /\b(what can (i|we) (make|cook)|meal ideas|dinner ideas|any (other )?ideas|something else)\b/i;
const CARD_ORDINALS: Record<string, number> = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3 };
const CHOOSE = /^\s*(?:let'?s (?:do|go with|make) )?the (first|1st|second|2nd|third|3rd)(?: one)?\b/i;
const DISH = /^\s*((?:i\s+was\s+thinking(?:\s+(?:of|about))?|i\s+want\s+to\s+(?:make|cook)|let'?s\s+(?:make|cook|have))\s+(?:(?:a|an|some)\s+)?([^,.!?]+?))(?=\s*(?:[,.!?]|\bwith\b|$))([\s\S]*)$/i;
const HAVE = /^\s*(?:and\s+)?(?:i|we)\s+(?:also\s+)?(?:have|'ve got|have got|got)\s+(?:also\s+)?(.+?)\s*$/i;

function dishIntent(text: string): { title: string; evidence: string; notes: string; have: Segment[] } | null {
  const m = DISH.exec(text);
  if (!m) return null;
  const dish = m[2].trim();
  if (!dish || /^(?:it|that|this|this one|that one|one|something|some)$/i.test(dish)) return null;
  const notes = m[3].replace(/^\s*[,.]\s*/, "").trim();
  const have = notes
    .split(/[.!?]+/)
    .map((sentence) => HAVE.exec(sentence)?.[1])
    .filter((s): s is string => Boolean(s))
    .flatMap((s) => s.split(/\s*,\s*(?:and\s+)?|\s+and\s+/i).map((x) => toSegment(x.trim())))
    .filter((s) => s.name);
  return { title: dish.replace(/^\w/, (c) => c.toUpperCase()), evidence: m[1].trim(), notes, have };
}

const IDEA_ORDINALS: Record<string, number> = { first: 0, "1st": 0, second: 1, "2nd": 1, third: 2, "3rd": 2 };

/** A change to an idea card, routed like the real interpreter (ai.md §5 "Refining an idea"). */
function ideaChange(req: InterpretRequest): InterpretResult | null {
  const ideas = req.ideas ?? [];
  const text = req.message.text.trim();
  if (!ideas.length || !(CHANGES_A_DISH.test(text) || /\b(use|add)\s+.+\s+(in|to)\s+(the|my)\b/i.test(text))) return null;
  const ordinal = /\b(first|second|third|1st|2nd|3rd)\s+one\b/i.exec(text);
  let index = ordinal ? IDEA_ORDINALS[ordinal[1].toLowerCase()] : -1;
  if (index < 0) {
    const words = new Set(nameTokens(text));
    const scores = ideas.map((i) => nameTokens(i.name).filter((w) => words.has(w)).length);
    const best = Math.max(...scores);
    index = best > 0 && scores.filter((s) => s === best).length === 1 ? scores.indexOf(best) : -1;
  }
  if (index < 0 || index >= ideas.length) return null;
  const label = `d${index + 1}`;
  const choose = WANTS_RECIPE.test(text);
  const out: ModelOutput = {
    kind: choose ? "change" : "answer",
    reply: "",
    ...empty,
    generate: { what: "recipe_change", meal: label },
    dish: null,
    operations: choose
      ? [{ action: "meal_choose", meal: label, evidence: text, item: null, name: null, quantity: null, location: null, frozen: null, stock: null, amountUsed: null, batch: null, store: null }]
      : [],
  };
  const m = mealOperations(out, req, new Date());
  if (m.operations.length === 0) return { kind: "answer", proposal: null, reply: "", followUps: m.followUps };
  return { kind: "change", reply: "Good choice.", proposal: { ...base(req), operations: m.operations }, followUps: m.followUps };
}

function recipeChange(req: InterpretRequest): InterpretResult | null {
  const text = req.message.text.trim();
  if (!(isFakeRecipeQuestion(text) || SCRIPTED_RECIPE_CHANGE.test(text)) || !req.state.meals.some((m) => m.recipe)) return null;
  const out: ModelOutput = { kind: "answer", reply: "", ...empty, generate: { what: "recipe_change", meal: "last_chosen" }, dish: null, operations: [] };
  const m = mealOperations(out, req, new Date());
  return m.followUps.length ? { kind: "answer", proposal: null, reply: "", followUps: m.followUps } : null;
}

function choose(req: InterpretRequest, label: string): InterpretResult {
  const out: ModelOutput = {
    kind: "change",
    reply: "",
    ...empty,
    generate: null,
    dish: null,
    operations: [{ action: "meal_choose", meal: label, evidence: req.message.text.trim(), item: null, name: null, quantity: null, location: null, frozen: null, stock: null, amountUsed: null, batch: null, store: null, when: null }],
  };
  const m = mealOperations(out, req, new Date());
  if (m.clarification) return { kind: "clarify", reply: m.clarification.question, proposal: { ...base(req), operations: [], clarification: m.clarification } };
  return { kind: "change", reply: "Good choice. Here's the recipe.", proposal: { ...base(req), operations: m.operations }, followUps: m.followUps };
}

function namedDish(req: InterpretRequest, dish: NonNullable<ReturnType<typeof dishIntent>>): InterpretResult {
  const out: ModelOutput = { kind: "change", reply: "", ...empty, generate: null, dish: { title: dish.title, notes: dish.notes || null, evidence: dish.evidence }, operations: [] };
  const m = mealOperations(out, req, new Date());
  if (m.operations.length === 0) return { kind: "answer", proposal: null, reply: "Let me look at what you have.", followUps: m.followUps };
  const adds: Op[] = dish.have.map((s, i) => ({
    opId: `${req.message.id}:have${i + 1}`,
    type: "item.add",
    evidence: s.raw,
    fields: { name: said(s.name), ...(s.quantity ? { quantity: said(s.quantity) } : {}) },
  }));
  const added = adds.length ? ` I added ${list(dish.have.map((s) => s.name))}.` : "";
  return { kind: "change", reply: `${dish.title} it is.${added} Here's a recipe.`, proposal: { ...base(req), operations: [...adds, ...m.operations] }, followUps: m.followUps };
}

export function createScriptedInterpreter(recentChanges?: RecentChangesLookup): Interpreter {
  const standIn = createFakeInterpreter(recentChanges);
  return {
    async interpret(req): Promise<InterpretResult> {
      const changed = ideaChange(req) ?? recipeChange(req);
      if (changed) return changed;
      const text = req.message.text;
      const intent = matchIntent(text);
      if (intent.kind === "needsRealAI" || intent.kind === "unknown") {
        if (IDEAS.test(text)) return { kind: "answer", proposal: null, reply: "Let me look at what you have.", followUps: [{ kind: "ideas", request: text.trim() }] };
        const card = CHOOSE.exec(text);
        if (card) return choose(req, `d${CARD_ORDINALS[card[1].toLowerCase()]}`);
        const dish = dishIntent(text);
        if (dish) return namedDish(req, dish);
      }
      return standIn.interpret(req);
    },
  };
}

/** The scripted interpreter without a change lookup (it then can't undo). */
export const scriptedInterpreter = createScriptedInterpreter();
