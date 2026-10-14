/**
 * ⚠️ FAKE INTERPRETER (milestone 2 stand-in, NOT the real AI).
 *
 * Deterministic and tiny, so the app runs locally with no accounts and the end-to-end tests are
 * repeatable (backend-data.md §8). It understands only:
 *   "I bought X, Y and Z" · "I froze the X" · "I used the rest of the X" · "X is running low" ·
 *   "add X and Y to the list [for Store]" · "the old X are gone" · "I defrosted the X" · "undo" ·
 *   "I was thinking a <dish>, with … I have X" / "I want to make <dish>" (MI1)
 * and answers anything else politely with no changes. Everything it proposes still goes through
 * the real backend validate → apply path. The AI specialist replaces this folder (ai.md §9).
 */
import type { ChangeSetSummary } from "@/contracts/apply-result";
import type { ProposedChange } from "@/contracts/proposed-change";
import type { InterpretRequest, InterpretResult, Interpreter } from "../interpreter";
import { mealOperations } from "../real/meal-ops";
import type { ModelOutput } from "../real/model-output";
import { matchIntent, type Segment } from "./patterns";

/**
 * Replies use verb-first wording ("moved the chicken thighs to the freezer"), never "the X is/are",
 * because a name's number can't be told from the count of names ("chicken thighs" is one target).
 */
const said = <T>(value: T) => ({ value, basis: "said" as const, confidence: "high" as const });
const list = (names: string[]) => new Intl.ListFormat("en", { type: "conjunction" }).format(names);

export const FALLBACK_REPLY =
  "Sorry, I didn't catch that. I'm a simple stand-in for now, so I only understand things like " +
  "“I bought eggs and milk”, “I froze the chicken”, “I used the rest of the spinach”, " +
  "“the yogurt is running low” and “undo”.";
export const NOTHING_TO_UNDO_REPLY = "There's nothing of yours to undo right now.";

type Op = ProposedChange["operations"][number];

/** For "undo": the speaker's own recent change sets, newest first (looked up by the route). */
export type RecentChangesLookup = (req: InterpretRequest) => Promise<ChangeSetSummary[]>;

function itemOps(targets: Segment[], type: "item.update" | "item.use", fields: Record<string, unknown>): Op[] {
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
            fields: { name: said(s.name), ...(s.quantity ? { quantity: said(s.quantity) } : {}) },
          }));
          reply = `All set: added ${names(intent.items)}.`;
          break;
        case "froze":
          operations = itemOps(intent.targets, "item.update", { location: said("freezer"), frozen: said(true) });
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
        case "low":
          operations = itemOps(intent.targets, "item.use", { stock: said("low") });
          reply = `Noted: marked the ${names(intent.targets)} as running low.`;
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
        case "undo": {
          // Your own latest change that isn't undone and isn't itself an Undo (H3, 0017).
          const last = (await recentChanges(req)).find((c) => !c.undone && !c.summaries.some((s) => s.code === "UNDONE"));
          if (!last) return { kind: "answer", proposal: null, reply: NOTHING_TO_UNDO_REPLY };
          operations = [{ opId: "", type: "changeset.revert", evidence: req.message.text.trim(), target: { changeSetId: last.changeSetId } }];
          reply = "No problem, that's undone.";
          break;
        }
        case "mealIdeas":
          return { kind: "answer", proposal: null, reply: "Let me look at what you have.", followUps: [{ kind: "ideas", request: req.message.text.trim() }] };
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
              { action: intent.action, meal: intent.label, evidence: req.message.text.trim(), item: null, name: null, quantity: null, location: null, frozen: null, stock: null, amountUsed: null, batch: null, store: null },
            ],
          };
          const m = mealOperations(out, req, new Date());
          const base = { proposalId: req.message.id, kitchenId: req.kitchenId, basedOnVersion: req.version, source: { via: "chat" as const, messageId: req.message.id } };
          if (m.clarification) {
            return { kind: "clarify", reply: m.clarification.question, proposal: { ...base, operations: [], clarification: m.clarification } };
          }
          const replies = { meal_choose: "Good choice. Here's the recipe.", meal_plan: "Added it to your plan.", meal_start_cooking: "Enjoy cooking!", meal_done: "Enjoy! Let me know what's left." };
          return { kind: "change", reply: replies[intent.action], proposal: { ...base, operations: m.operations }, followUps: m.followUps };
        }
        case "dish": {
          // MI1: what they say they have goes into the kitchen, then the dish is chosen directly
          // through the same code as the real interpreter (meal-ops.ts) and its recipe follows.
          const out: ModelOutput = {
            kind: "change",
            reply: "",
            clarification: null,
            rememberPreference: null,
            listOfferAccepted: null,
            generate: null,
            dish: { title: intent.title, notes: intent.notes || null, evidence: intent.evidence },
            operations: [],
          };
          const m = mealOperations(out, req, new Date());
          const adds: Op[] = intent.have.map((s, i) => ({
            opId: `${req.message.id}:have${i + 1}`,
            type: "item.add",
            evidence: s.raw,
            fields: { name: said(s.name), ...(s.quantity ? { quantity: said(s.quantity) } : {}) },
          }));
          const base = { proposalId: req.message.id, kitchenId: req.kitchenId, basedOnVersion: req.version, source: { via: "chat" as const, messageId: req.message.id } };
          if (m.operations.length === 0) {
            return { kind: "answer", proposal: null, reply: "Let me look at what you have.", followUps: m.followUps };
          }
          const added = adds.length ? ` I added ${list(intent.have.map((s) => s.name))}.` : "";
          return {
            kind: "change",
            reply: `${intent.title} it is.${added} Here's a recipe.`,
            proposal: { ...base, operations: [...adds, ...m.operations] },
            followUps: m.followUps,
          };
        }
        case "unknown":
          return { kind: "answer", proposal: null, reply: FALLBACK_REPLY };
      }
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
