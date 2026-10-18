/**
 * ⚠️ FAKE INTERPRETER (the stand-in AI, NOT the real AI).
 *
 * Deterministic and tiny, so the app runs locally with no accounts and the end-to-end tests are
 * repeatable (backend-data.md §8). It only does simple kitchen updates (0059 PF10):
 *   "I bought X, Y and Z" (a leading "5-6", "2 x" or "a dozen" is the quantity) · "I froze the X" ·
 *   "I used the rest of the X" · "X is running low" · "we have plenty of X" · "there's some X left" (KOS4) ·
 *   "add X and Y to the list [for Store]" · "take X off the list" · "clear the list" ·
 *   "throw out X, Y and Z" (KOS16: more than 5 removals and the turn asks first) ·
 *   "the old X are gone" · "I defrosted the X" · "undo" ·
 *   "X goes under <category>" (CAT1; adds also get the shared keyword guess) ·
 *   "X goes in the pantry" / "put X in the fridge" (0041; adds get their place from the backend) ·
 *   staples (0054): "X is a staple [from Store]", "we always keep X", "X isn't a staple any more",
 *   "what staples do I need?" / "restock", and "yes" to its own "remember these as your staples?" ·
 *   the dated plan (0045 KOS1, KOS12): "plan the curry for Tuesday", "move the pasta to Friday",
 *   "take the day off the pasta", "what are we eating this week?", "add what we need for this week's meals" ·
 *   for the last chosen meal: "add that to my plan", "start cooking", "I made it" ·
 *   "make me a sample recipe [for <dish>]": a template titled "Sample recipe (stand-in)", so the
 *   recipe and week screens can be clicked through.
 * Questions, recipes, meal ideas and recipe changes get STAND_IN_DECLINE_REPLY and change nothing:
 * only the real model answers those (PF10). Anything else gets FALLBACK_REPLY. Everything it
 * proposes still goes through the real backend validate → apply path.
 */
import type { ChangeSetSummary } from "@/contracts/apply-result";
import type { ProposedChange } from "@/contracts/proposed-change";
import type { InterpretRequest, InterpretResult, Interpreter } from "../interpreter";
import { CHANGES_A_DISH, mealOperations } from "../real/meal-ops";
import type { ModelOutput } from "../real/model-output";
import { CATEGORY_LABEL_EN, guessCategory } from "@/shared/item-category";
import { mentionsAllergen } from "@/shared/profile/allergens";
import { matchStaple } from "@/shared/staples";
import { standardName } from "@/shared/text";
import { STAPLES_OFFER, staplesAnswer } from "../staples";
import { WEEK_NEEDS_ADD, weekPlanAnswer } from "../week-plan";
import { isIsoDay } from "@/shared/plan-dates";
import { matchIntent, splitList, type Segment } from "./patterns";
import { sampleRecipeTitle, STAND_IN_DECLINE_REPLY } from "./decline";

export { STAND_IN_DECLINE_REPLY } from "./decline";

/** A change to a recipe or an idea ("skip step 2", "no garlic", "make it vegetarian"): the real AI's job (PF10). */
const RECIPE_CHANGE =
  /^(skip step \d+|use \d+ .+ instead of \d+|(no|without|i don'?t have( any)?) [a-z].*|i'?m (also )?using .+ too|make it .+|add .+ (to|in) (the|my|this) (recipe|curry|dish|one)\b.*)[.!?]*$/i;

/**
 * Replies use verb-first wording ("moved the chicken thighs to the freezer"), never "the X is/are",
 * because a name's number can't be told from the count of names ("chicken thighs" is one target).
 */
const said = <T>(value: T) => ({ value, basis: "said" as const, confidence: "high" as const });
const list = (names: string[]) => new Intl.ListFormat("en", { type: "conjunction" }).format(names);

/** CAT1: the shared keyword guess as an inferred fact, or nothing when no word matched. */
function guessedCategory(name: string) {
  const g = guessCategory(name);
  return g.matched ? { category: { value: g.category, basis: "inferred" as const, confidence: "medium" as const } } : {};
}

export const FALLBACK_REPLY =
  "Sorry, I didn't catch that. I'm only the stand-in AI, so I just do simple kitchen updates like " +
  "“I bought eggs and milk”, “I froze the chicken”, “I used the rest of the spinach”, " +
  "“the yogurt is running low”, “add rice to the list”, “plan the curry for Tuesday” and “undo”. " +
  "Say “make me a sample recipe” to try the recipe screens.";
/** PF10: said with every sample recipe, so nobody mistakes it for a real one. */
export const SAMPLE_REPLY = "Here's a sample recipe from the stand-in: a template for trying the screens, not a real recipe.";
export const NOTHING_TO_UNDO_REPLY = "There's nothing of yours to undo right now.";

type Op = ProposedChange["operations"][number];

/**
 * The fake's general staples guess (0054 SS6, only when none are saved): a fixed everyday list,
 * minus what's in the kitchen and not low, what's on the list, and every member's allergens.
 */
export const FAKE_STAPLES = ["jasmine rice", "fish sauce", "eggs", "garlic", "soy sauce", "peanut butter"];
export const FAKE_GUESS_LEAD = "A few basics to keep on hand: ";
export const FAKE_REMEMBER_OFFER = "Want me to remember these as your staples?";

function fakeStaplesGuess(req: InterpretRequest): string[] {
  const allergens = (req.allergies ?? []).map((a) => a.subject);
  const stocked = req.state.items.filter((i) => i.stock?.value !== "low").map((i) => ({ name: i.name.value, standardName: i.standardName }));
  const listed = (req.state.shoppingList ?? []).map((e) => ({ name: e.name.value, standardName: e.standardName }));
  return FAKE_STAPLES.filter((n) => {
    const me = { name: n, standardName: standardName(n) };
    return !mentionsAllergen(n, allergens) && matchStaple(me, stocked).length === 0 && matchStaple(me, listed).length === 0;
  });
}

/** The names in the fake's own "…on hand: X, Y and Z. Want me to remember these as your staples?". */
function offeredFakeStaples(req: InterpretRequest): string[] {
  const last = [...req.history].reverse().find((t) => t.role === "assistant")?.text ?? "";
  if (!STAPLES_OFFER.test(last)) return [];
  const m = /:\s*(.+?)\.\s*Want me to remember/i.exec(last);
  return m ? splitList(m[1]) : [];
}

/** For "undo": the speaker's own recent change sets, newest first (looked up by the route). */
export type RecentChangesLookup = (req: InterpretRequest) => Promise<ChangeSetSummary[]>;

function itemOps(targets: Segment[], type: "item.update" | "item.use" | "item.stock.set", fields: Record<string, unknown>): Op[] {
  return targets.map((s) => ({ opId: "", type, evidence: s.raw, target: { name: s.name }, fields }) as Op);
}

export function createFakeInterpreter(recentChanges: RecentChangesLookup = async () => []): Interpreter {
  return {
    async interpret(req): Promise<InterpretResult> {
      const intent = matchIntent(req.message.text);
      let operations: Op[] = [];
      let reply = "";
      const names = (segs: Segment[]) => list(segs.map((s) => s.name));
      switch (intent.kind) {
        case "bought":
          operations = intent.items.map((s) => ({
            opId: "",
            type: "item.add",
            evidence: s.raw,
            fields: { name: said(s.name), ...(s.quantity ? { quantity: said(s.quantity) } : {}), ...guessedCategory(s.name) },
          }));
          reply = `All set: added ${names(intent.items)}.`;
          break;
        case "froze":
          // "Froze" implies the freezer (inferred, high), like the real interpreter; only a place
          // the user names is remembered (0041).
          operations = itemOps(intent.targets, "item.update", { location: { value: "freezer", basis: "inferred", confidence: "high" }, frozen: said(true) });
          reply = `All set: moved the ${names(intent.targets)} to the freezer.`;
          break;
        case "usedUp":
          operations = itemOps(intent.targets, "item.use", { stock: said("out") });
          reply = `Got it: marked the ${names(intent.targets)} as used up.`;
          break;
        case "oldGone":
          // "The old eggs are gone" (0025): the oldest batch closes; newer ones stay.
          operations = intent.targets.map((s) => ({
            opId: "",
            type: "item.batch.close",
            evidence: s.raw,
            target: { name: s.name, which: "oldest" },
          }));
          reply = `Got it: marked the older ${names(intent.targets)} as gone.`;
          break;
        case "defrosted":
          operations = intent.targets.map((s) => ({ opId: "", type: "item.defrost", evidence: s.raw, target: { name: s.name } }));
          reply = `Noted: marked the ${names(intent.targets)} as defrosted.`;
          break;
        case "category":
          operations = [{ opId: "", type: "item.update", evidence: req.message.text.trim(), target: { name: intent.target.name }, fields: { category: said(intent.category) } }];
          reply = `Done: the ${intent.target.name} is under ${CATEGORY_LABEL_EN[intent.category]} now.`;
          break;
        case "place":
          operations = [{ opId: "", type: "item.update", evidence: req.message.text.trim(), target: { name: intent.target.name }, fields: { location: said(intent.location) } }];
          reply = `Done: I'll put the ${intent.target.name} in the ${intent.location} from now on.`;
          break;
        case "low":
          operations = itemOps(intent.targets, "item.use", { stock: said("low") });
          reply = `Noted: marked the ${names(intent.targets)} as running low.`;
          break;
        case "level":
          // KOS4: how much is left, not a use. Plenty and Some never offer the list (SL3).
          operations = itemOps(intent.targets, "item.stock.set", { stock: said(intent.level) });
          reply = intent.level === "plenty" ? `Good: marked plenty of ${names(intent.targets)}.` : `Noted: there's some ${names(intent.targets)} left.`;
          break;
        case "toList":
          operations = intent.items.map((s) => ({
            opId: "",
            type: "shopping.add",
            evidence: s.raw,
            fields: {
              name: said(s.name),
              ...(s.quantity ? { quantity: said(s.quantity) } : {}),
              ...(intent.store ? { store: said(intent.store) } : {}),
            },
          }));
          reply = `On your list: ${names(intent.items)}.`;
          break;
        case "offList":
          operations = intent.targets.map((s) => ({ opId: "", type: "shopping.remove", evidence: s.raw, target: { name: s.name } }));
          reply = `Done: took ${names(intent.targets)} off your list.`;
          break;
        case "clearList": {
          // Every open entry, by ID. More than 5 makes the turn ask first (0045 KOS16).
          const open = req.state.shoppingList ?? [];
          if (open.length === 0) return { kind: "answer", proposal: null, reply: "Your list is already empty." };
          const evidence = req.message.text.trim();
          operations = open.map((e) => ({ opId: "", type: "shopping.remove", evidence, target: { shoppingItemId: e.id } }));
          reply = "Done: your list is clear.";
          break;
        }
        case "throwOut":
          operations = intent.targets.map((s) => ({ opId: "", type: "item.remove", evidence: s.raw, target: { name: s.name } }));
          reply = `Done: removed ${names(intent.targets)}.`;
          break;
        case "undo": {
          // Your own latest change that isn't undone and isn't itself an Undo (H3, 0017).
          const last = (await recentChanges(req)).find((c) => !c.undone && !c.summaries.some((s) => s.code === "UNDONE"));
          if (!last) return { kind: "answer", proposal: null, reply: NOTHING_TO_UNDO_REPLY };
          operations = [{ opId: "", type: "changeset.revert", evidence: req.message.text.trim(), target: { changeSetId: last.changeSetId } }];
          reply = "No problem, that's undone.";
          break;
        }
        case "needsRealAI":
          return { kind: "answer", proposal: null, reply: STAND_IN_DECLINE_REPLY };
        case "sample": {
          // PF10: a template recipe, clearly titled, chosen through the same code as the real
          // interpreter's named dish (meal-ops.ts); the stand-in meal AI writes it.
          const title = sampleRecipeTitle(intent.dish);
          const out: ModelOutput = {
            kind: "change",
            reply: "",
            clarification: null,
            rememberPreference: null,
            listOfferAccepted: null,
            generate: null,
            dish: { title, notes: null, evidence: req.message.text.trim() },
            operations: [],
          };
          const m = mealOperations(out, req, new Date());
          if (m.operations.length === 0) return { kind: "answer", proposal: null, reply: STAND_IN_DECLINE_REPLY };
          const base = { proposalId: req.message.id, kitchenId: req.kitchenId, basedOnVersion: req.version, source: { via: "chat" as const, messageId: req.message.id } };
          return { kind: "change", reply: SAMPLE_REPLY, proposal: { ...base, operations: m.operations }, followUps: m.followUps };
        }
        case "meal": {
          // The same code resolution as the real interpreter (labels, "last chosen", follow-ups).
          const out: ModelOutput = {
            kind: "change",
            reply: "",
            clarification: null,
            rememberPreference: null,
            listOfferAccepted: null,
            generate: null,
            dish: null,
            operations: [
              { action: intent.action, meal: intent.label, evidence: req.message.text.trim(), item: null, name: null, quantity: null, location: null, frozen: null, stock: null, amountUsed: null, batch: null, store: null, when: intent.when ?? null },
            ],
          };
          const m = mealOperations(out, req, new Date());
          const base = { proposalId: req.message.id, kitchenId: req.kitchenId, basedOnVersion: req.version, source: { via: "chat" as const, messageId: req.message.id } };
          if (m.clarification) {
            return { kind: "clarify", reply: m.clarification.question, proposal: { ...base, operations: [], clarification: m.clarification } };
          }
          const replies = {
            meal_plan: intent.when ? "Done, it's on the plan." : "Added it to your plan.",
            meal_start_cooking: "Enjoy cooking!",
            meal_done: "Enjoy! Let me know what's left.",
            meal_date: "Moved it.",
            meal_clear_date: "Done: no day for it now.",
          };
          return { kind: "change", reply: replies[intent.action], proposal: { ...base, operations: m.operations }, followUps: m.followUps };
        }
        case "weekPlan": {
          // KOS1: from the plan, by code (the same answer as the real interpreter).
          const today = req.today && isIsoDay(req.today) ? req.today : new Date().toISOString().slice(0, 10);
          return { kind: "answer", proposal: null, reply: weekPlanAnswer(req.state, today) };
        }
        case "weekNeeds":
          // KOS12: the turn reads the week's needs and adds them (or lists them, for a question).
          return { kind: "answer", proposal: null, reply: "Let me check this week's meals.", weekNeeds: { add: WEEK_NEEDS_ADD.test(req.message.text) } };
        case "stapleAdd":
          // 0054 SS2: said in the user's own words; the store only when they say one (SS5).
          operations = intent.items.map((s) => ({
            opId: "",
            type: "staple.add",
            evidence: s.raw,
            fields: { name: said(s.name), ...(intent.store ? { store: said(intent.store) } : {}) },
          }));
          reply = `Got it: ${names(intent.items)} ${intent.items.length > 1 ? "are" : "is"} on your staples now.`;
          break;
        case "stapleRemove":
          operations = intent.targets.map((s) => ({ opId: "", type: "staple.remove", evidence: req.message.text.trim(), target: { name: s.name } }));
          reply = `Done: took ${names(intent.targets)} off your staples.`;
          break;
        case "staplesQuestion": {
          // SS6: from the saved staples, by code; the general guess only when there are none.
          const answer = staplesAnswer(req.state);
          if (answer) return { kind: "answer", proposal: null, reply: answer.reply, ...(answer.staples ? { staples: answer.staples } : {}) };
          const guess = fakeStaplesGuess(req);
          return {
            kind: "answer",
            proposal: null,
            reply: guess.length ? `${FAKE_GUESS_LEAD}${list(guess)}. ${FAKE_REMEMBER_OFFER}` : "You look well stocked on the basics.",
          };
        }
        case "yes": {
          // A yes to "remember these as your staples?" (SS2): the names Kitchen offered, as staples.
          const offered = offeredFakeStaples(req);
          if (offered.length === 0) return { kind: "answer", proposal: null, reply: FALLBACK_REPLY };
          operations = offered.map((name) => ({ opId: "", type: "staple.add", evidence: req.message.text.trim(), fields: { name: said(name) } }));
          reply = `Saved ${list(offered)} as your staples.`;
          break;
        }
        case "unknown": {
          // "No garlic", "skip step 2", "swap the chicken for tofu": a recipe or idea change (PF10).
          const text = req.message.text.trim();
          const reply = RECIPE_CHANGE.test(text) || CHANGES_A_DISH.test(text) ? STAND_IN_DECLINE_REPLY : FALLBACK_REPLY;
          return { kind: "answer", proposal: null, reply };
        }
      }
      // "I got the ingredients needed to make this" names no food (PF10): nothing to do.
      if (operations.length === 0) return { kind: "answer", proposal: null, reply: FALLBACK_REPLY };
      return {
        kind: "change",
        reply,
        proposal: {
          proposalId: req.message.id,
          kitchenId: req.kitchenId,
          basedOnVersion: req.version,
          source: { via: "chat", messageId: req.message.id },
          operations: operations.map((op, i) => ({ ...op, opId: String(i + 1) })),
        },
      };
    },
  };
}

/** The fake without a change lookup (it then can't undo). */
export const fakeInterpreter = createFakeInterpreter();
