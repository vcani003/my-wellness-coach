/**
 * Ask before removing more than 5 things at once (0045 KOS16), through `handleChatTurn` on an
 * embedded Postgres with the real backend apply path: held → yes applies exactly that change as
 * one change set with one Undo; no changes nothing; 5 or fewer save right away (0007); a stale
 * yes removes nothing; only the asker can answer (0017); retries; an unreadable held change never
 * crashes (0018). People are fictional (Ana, Ben).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { chatMessages } from "@/db/schema";
import type { StreamEvent } from "@/contracts/stream";
import type { ProposedChange } from "@/contracts/proposed-change";
import { getInterpreter, handleChatTurn } from "@/ai";
import { KEPT_REPLY, STALE_REPLY } from "@/ai/bulk-remove";
import { FALLBACK_REPLY } from "@/ai/fake";
import type { Interpreter } from "@/ai/interpreter";
import { listChatHistory } from "@/domains/chat/queries";
import { undo } from "@/domains/kitchen/commands";
import { getKitchenState } from "@/domains/kitchen/queries";
import type { KitchenScope } from "@/shared/membership";
import { newKitchen, openLocalDb } from "../support/db";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await openLocalDb());
});
afterAll(async () => {
  await close();
});

let n = 0;
async function turn(scope: KitchenScope, text: string, opts: { id?: string; interpreter?: Interpreter } = {}) {
  const events: StreamEvent[] = [];
  const id = opts.id ?? `bulk-${++n}`;
  for await (const e of handleChatTurn({ db, scope, interpreter: opts.interpreter ?? getInterpreter({ db, scope }) }, { clientMessageId: id, text })) {
    events.push(e);
  }
  const applied = events.find((e) => e.type === "applied");
  const confirm = events.find((e) => e.type === "confirm");
  const reply = events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join("");
  return {
    id,
    events,
    types: events.map((e) => e.type),
    result: applied?.type === "applied" ? applied.result : null,
    confirm: confirm?.type === "confirm" ? confirm : null,
    reply,
  };
}

const SIX = "milk, eggs, bread, rice, butter and cheese";
const open = async (scope: KitchenScope) =>
  (await getKitchenState(db, scope)).items.filter((i) => i.stock?.value !== "out").map((i) => i.name.value);

async function anaWithSix() {
  const k = await newKitchen(db, ["Ana", "Ben"]);
  const ana = await k.scope("Ana");
  await turn(ana, `I bought ${SIX}`);
  return { k, ana, ben: await k.scope("Ben") };
}

describe("more than 5 removals in one message (0045 KOS16)", () => {
  it("asks first and saves nothing; yes applies exactly that change as one change set with one Undo", async () => {
    const { ana } = await anaWithSix();
    const before = await getKitchenState(db, ana);

    const asked = await turn(ana, `we're out of ${SIX}`);
    expect(asked.types).toEqual(["ack", "status", "status", "text", "confirm", "done"]);
    expect(asked.result).toBeNull();
    expect(asked.reply).toBe("That would remove 6 things: milk, eggs, bread, rice, butter, and cheese. Remove them all?");
    expect(asked.confirm).toMatchObject({ kind: "bulk-remove", count: 6, names: ["milk", "eggs", "bread", "rice", "butter", "cheese"] });
    expect(await getKitchenState(db, ana)).toEqual(before);

    // Saved chat keeps the question (for the buttons on reload), never the held change itself.
    const saved = (await listChatHistory(db, ana)).messages.at(-1);
    expect(saved?.confirm).toEqual({ kind: "bulk-remove", count: 6, names: ["milk", "eggs", "bread", "rice", "butter", "cheese"] });
    expect(JSON.stringify(saved)).not.toContain("operations");

    const yes = await turn(ana, "Yes, remove them");
    expect(yes.types).toEqual(["ack", "status", "applied", "status", "text", "done"]);
    expect(yes.result?.applied).toHaveLength(6);
    expect(yes.result?.rejected).toEqual([]);
    expect(yes.result?.undoable).toBe(true);
    expect(yes.reply).toMatch(/^Done: /);
    expect(await open(ana)).toEqual([]);
    expect((await getKitchenState(db, ana)).version).toBe(before.version + 1);

    // One Undo brings all six back.
    const undone = await undo(db, ana, { changeSetId: yes.result!.changeSetId, tapId: "undo-bulk", basedOnVersion: before.version + 1 });
    expect(undone.ok && undone.result.rejected).toEqual([]);
    expect((await open(ana)).sort()).toEqual(["bread", "butter", "cheese", "eggs", "milk", "rice"]);

    // The yes was the answer: a second yes is a new message, not another removal.
    const again = await turn(ana, "yes");
    expect(again.result).toBeNull();
    expect(again.reply).toBe(FALLBACK_REPLY);
  });

  it("no changes nothing", async () => {
    const { ana } = await anaWithSix();
    await turn(ana, `we're out of ${SIX}`);
    const version = (await getKitchenState(db, ana)).version;
    const no = await turn(ana, "No, keep them");
    expect(no.types).toEqual(["ack", "status", "text", "done"]);
    expect(no.reply).toBe(KEPT_REPLY);
    expect((await getKitchenState(db, ana)).version).toBe(version);
    expect((await open(ana)).length).toBe(6);
  });

  it("5 or fewer save right away, with Undo (0007)", async () => {
    const { ana } = await anaWithSix();
    const five = await turn(ana, "we're out of milk, eggs, bread, rice and butter");
    expect(five.confirm).toBeNull();
    expect(five.result?.applied).toHaveLength(5);
    expect(five.result?.undoable).toBe(true);
    expect(await open(ana)).toEqual(["cheese"]);
  });

  it("anything other than yes or no passes it over and is read as a new message", async () => {
    const { ana } = await anaWithSix();
    await turn(ana, `we're out of ${SIX}`);
    const other = await turn(ana, "I bought limes");
    expect(other.result?.applied[0].summary.text).toBe("Added limes");
    const late = await turn(ana, "yes");
    expect(late.result).toBeNull();
    expect((await open(ana)).length).toBe(7);
  });

  it("a stale yes removes nothing: the kitchen changed since Lumi asked (here, Ben's change)", async () => {
    const { ana, ben } = await anaWithSix();
    await turn(ana, `we're out of ${SIX}`);
    await turn(ben, "I bought more eggs");
    const yes = await turn(ana, "yes");
    expect(yes.result).toBeNull();
    expect(yes.reply).toBe(STALE_REPLY);
    expect((await open(ana)).sort()).toEqual(["bread", "butter", "cheese", "eggs", "milk", "rice"]);
  });

  it("household: only the asker can answer; Ben's yes is his own message (0017)", async () => {
    const { ana, ben } = await anaWithSix();
    await turn(ana, `we're out of ${SIX}`);
    const bens = await turn(ben, "yes");
    expect(bens.result).toBeNull();
    expect(bens.reply).toBe(FALLBACK_REPLY);
    expect((await open(ana)).length).toBe(6);
    // Ben changed nothing, so Ana's yes still applies.
    const anas = await turn(ana, "yes");
    expect(anas.result?.applied).toHaveLength(6);
  });

  it("a retried yes applies once and gets the same result back (not \"stale\")", async () => {
    const { ana } = await anaWithSix();
    await turn(ana, `we're out of ${SIX}`);
    const first = await turn(ana, "yes", { id: "yes-retry" });
    const second = await turn(ana, "yes", { id: "yes-retry" });
    expect(second.result?.changeSetId).toBe(first.result?.changeSetId);
    expect(second.reply).toBe(first.reply);
    expect((await getKitchenState(db, ana)).version).toBe(first.result!.newVersion);
  });

  it("a retried question asks again and keeps one held change", async () => {
    const { ana } = await anaWithSix();
    await turn(ana, `we're out of ${SIX}`, { id: "ask-retry" });
    const again = await turn(ana, `we're out of ${SIX}`, { id: "ask-retry" });
    expect(again.confirm?.count).toBe(6);
    const rows = await db.select().from(chatMessages).where(and(eq(chatMessages.clientMessageId, "ask-retry"), eq(chatMessages.role, "assistant")));
    expect(rows).toHaveLength(1);
    expect((await turn(ana, "yes")).result?.applied).toHaveLength(6);
  });

  it("an unreadable held change never crashes: the yes is read as a new message (0018)", async () => {
    const { ana } = await anaWithSix();
    const asked = await turn(ana, `we're out of ${SIX}`);
    await db.update(chatMessages).set({ pendingConfirm: { kind: "bulk-remove", operations: "broken" } }).where(eq(chatMessages.clientMessageId, asked.id));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const yes = await turn(ana, "yes");
    err.mockRestore();
    expect(yes.types.at(-1)).toBe("done");
    expect(yes.result).toBeNull();
    expect((await open(ana)).length).toBe(6);
    // The history still reads; the bad row just has no buttons.
    const saved = (await listChatHistory(db, ana)).messages.find((m) => m.clientMessageId === asked.id && m.role === "assistant");
    expect(saved?.confirm).toBeUndefined();
  });

  it("a cleared list: asks, then one Undo puts every entry back", async () => {
    const k = await newKitchen(db, ["Ana"]);
    const ana = await k.scope("Ana");
    await turn(ana, "add oat milk, garlic, ginger, limes, hoisin sauce, rice noodles and tofu to the list");
    const asked = await turn(ana, "clear the list");
    expect(asked.reply).toMatch(/^That would remove 7 things from your shopping list: oat milk, garlic, /);
    const yes = await turn(ana, "ok");
    expect(yes.result?.applied).toHaveLength(7);
    expect((await getKitchenState(db, ana)).shoppingList).toEqual([]);
    const undone = await undo(db, ana, { changeSetId: yes.result!.changeSetId, tapId: "undo-list", basedOnVersion: yes.result!.newVersion });
    expect(undone.ok && undone.result.state.shoppingList).toHaveLength(7);
  });

  it("holds the whole message, whichever interpreter wrote it; yes saves the rest with it in one change set", async () => {
    const { ana } = await anaWithSix();
    const text = `I bought limes. We're out of ${SIX}`;
    const said = <T>(value: T) => ({ value, basis: "said" as const, confidence: "high" as const });
    // A stand-in for the real model: one add plus six Outs, by name.
    const model: Interpreter = {
      async interpret(req) {
        const proposal: ProposedChange = {
          proposalId: req.message.id,
          kitchenId: req.kitchenId,
          basedOnVersion: req.version,
          source: { via: "chat", messageId: req.message.id },
          operations: [
            { opId: "1", type: "item.add", evidence: "I bought limes", fields: { name: said("limes") } },
            ...["milk", "eggs", "bread", "rice", "butter", "cheese"].map((name, i) => ({
              opId: String(i + 2),
              type: "item.use" as const,
              evidence: `We're out of ${SIX}`,
              target: { name },
              fields: { stock: said("out" as const) },
            })),
          ],
        };
        return { kind: "change", reply: "Got it.", proposal };
      },
    };
    const asked = await turn(ana, text, { interpreter: model });
    expect(asked.reply).toContain("Nothing from that message is saved until you say yes.");
    expect(await open(ana)).not.toContain("limes");
    const yes = await turn(ana, "yes", { interpreter: model });
    expect(yes.result?.applied).toHaveLength(7);
    expect(await open(ana)).toEqual(["limes"]);
  });

  it("'plan the curry for Tuesday' + six removals: held, and the yes plans it for that day (0059: the day survives the hold)", async () => {
    const { ana } = await anaWithSix();
    // A meal to plan: the stand-in's sample recipe (0059 PF10; it no longer writes a named dish's recipe).
    await turn(ana, "make me a sample recipe for chicken curry");
    const meal = (await getKitchenState(db, ana)).meals.find((m) => m.title === "Sample recipe (stand-in): Chicken curry")!;
    expect(meal.status).toBe("chosen");
    const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const said = <T>(value: T) => ({ value, basis: "said" as const, confidence: "high" as const });
    const text = `plan the curry for ${day} and throw out the ${SIX}`;
    const model: Interpreter = {
      async interpret(req) {
        const proposal: ProposedChange = {
          proposalId: req.message.id,
          kitchenId: req.kitchenId,
          basedOnVersion: req.version,
          source: { via: "chat", messageId: req.message.id },
          operations: [
            { opId: "1", type: "meal.plan", evidence: `plan the curry for ${day}`, target: { mealId: meal.id }, date: day },
            ...["milk", "eggs", "bread", "rice", "butter", "cheese"].map((name, i) => ({
              opId: String(i + 2),
              type: "item.use" as const,
              evidence: `throw out the ${SIX}`,
              target: { name },
              fields: { stock: said("out" as const) },
            })),
          ],
        };
        return { kind: "change", reply: "Done.", proposal };
      },
    };
    const asked = await turn(ana, text, { interpreter: model });
    expect(asked.confirm).not.toBeNull();
    expect((await getKitchenState(db, ana)).meals.find((m) => m.id === meal.id)?.plannedFor).toBeUndefined();
    const yes = await turn(ana, "yes", { interpreter: model });
    expect(yes.result?.applied).toHaveLength(7);
    expect((await getKitchenState(db, ana)).meals.find((m) => m.id === meal.id)).toMatchObject({ status: "planned", plannedFor: day });
  });
});
