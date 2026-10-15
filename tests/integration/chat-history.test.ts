/**
 * Saved chat (P2 a, backend-data.md §6): messages survive a reload, are private per person
 * (H2, 0017), page newest-first with a cursor, feed the interpreter's recent turns from the
 * database, and a failure to save never breaks a turn (0018).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { StreamEvent } from "@/contracts/stream";
import { ChatHistoryPage } from "@/contracts/chat-history";
import { getInterpreter, handleChatTurn, type ChatTurnInput } from "@/ai";
import type { Interpreter, InterpretRequest } from "@/ai/interpreter";
import { getRecentTurns, listChatHistory, matchBatchAnswers } from "@/domains/chat/queries";
import { saveUserMessage } from "@/domains/chat/commands";
import { closeBatches, keepBatches, undo } from "@/domains/kitchen/commands";
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
async function turn(
  scope: KitchenScope,
  text: string,
  opts: { id?: string; interpreter?: Interpreter; history?: ChatTurnInput["history"]; on?: Db } = {},
) {
  const on = opts.on ?? db;
  const events: StreamEvent[] = [];
  const input: ChatTurnInput = { clientMessageId: opts.id ?? `hist-${++n}`, text, history: opts.history };
  for await (const e of handleChatTurn({ db: on, scope, interpreter: opts.interpreter ?? getInterpreter({ db: on, scope }) }, input)) {
    events.push(e);
  }
  const done = events.find((e) => e.type === "done");
  return { events, types: events.map((e) => e.type), assistantMessageId: done?.type === "done" ? done.assistantMessageId : null };
}

/** An interpreter that records what it was given and changes nothing. */
function spy() {
  const seen: InterpretRequest[] = [];
  const interpreter: Interpreter = {
    async interpret(req) {
      seen.push(req);
      return { kind: "answer", proposal: null, reply: `re: ${req.message.text}` };
    },
  };
  return { seen, interpreter };
}

describe("saved chat", () => {
  it("saves the user message and the reply, with the receipt (no state) and the same IDs as the stream", async () => {
    const k = await newKitchen(db, ["Vero"]);
    const vero = await k.scope("Vero");
    const out = await turn(vero, "I bought eggs", { id: "t1" });

    const page = await listChatHistory(db, vero);
    expect(ChatHistoryPage.safeParse(page).success).toBe(true);
    expect(page.nextCursor).toBeNull();
    expect(page.messages.map((m) => [m.role, m.clientMessageId])).toEqual([
      ["user", "t1"],
      ["assistant", "t1"],
    ]);
    const [user, reply] = page.messages;
    expect(user.text).toBe("I bought eggs");
    expect(user.receipt).toBeNull();
    expect(reply.id).toBe(out.assistantMessageId);
    expect(reply.receipt?.applied.map((a) => a.summary.text)).toEqual(["Added eggs"]);
    expect(reply.receipt?.undoable).toBe(true);
    expect(reply.receipt).not.toHaveProperty("state");
  });

  it("a retry of the same message saves nothing twice and reports the first reply's ID", async () => {
    const k = await newKitchen(db, ["Vero"]);
    const vero = await k.scope("Vero");
    const first = await turn(vero, "I bought eggs", { id: "same" });
    const again = await turn(vero, "I bought eggs", { id: "same" });
    expect(again.types.at(-1)).toBe("done");
    expect(again.assistantMessageId).toBe(first.assistantMessageId);
    expect((await listChatHistory(db, vero)).messages).toHaveLength(2);

    // Saving the same user message directly is also a no-op.
    await saveUserMessage(db, vero, { clientMessageId: "same", text: "I bought eggs" });
    expect((await listChatHistory(db, vero)).messages).toHaveLength(2);
  });

  it("is private: Levi never sees Vero's chat, in history or in his interpreter's turns (H2, 0017)", async () => {
    const k = await newKitchen(db, ["Vero", "Levi"]);
    const vero = await k.scope("Vero");
    const levi = await k.scope("Levi");
    await turn(vero, "I bought eggs");
    await turn(levi, "I bought milk");

    const leviPage = await listChatHistory(db, levi);
    expect(leviPage.messages.filter((m) => m.role === "user").map((m) => m.text)).toEqual(["I bought milk"]);
    expect(leviPage.messages.some((m) => m.text.includes("eggs"))).toBe(false);

    const { seen, interpreter } = spy();
    await turn(levi, "what did I say?", { interpreter });
    expect(seen[0].history.some((h) => h.text.includes("eggs"))).toBe(false);

    // Another kitchen's member gets nothing either.
    const other = await newKitchen(db, ["Vero"]);
    expect((await listChatHistory(db, await other.scope("Vero"))).messages).toEqual([]);
  });

  it("pages newest first, oldest first within a page, with a cursor to older pages", async () => {
    const k = await newKitchen(db, ["Vero"]);
    const vero = await k.scope("Vero");
    for (let i = 1; i <= 7; i++) await saveUserMessage(db, vero, { clientMessageId: `m${i}`, text: `message ${i}` });

    const first = await listChatHistory(db, vero, { limit: 3 });
    expect(first.messages.map((m) => m.text)).toEqual(["message 5", "message 6", "message 7"]);
    expect(first.nextCursor).not.toBeNull();

    const second = await listChatHistory(db, vero, { limit: 3, before: first.nextCursor! });
    expect(second.messages.map((m) => m.text)).toEqual(["message 2", "message 3", "message 4"]);

    const last = await listChatHistory(db, vero, { limit: 3, before: second.nextCursor! });
    expect(last.messages.map((m) => m.text)).toEqual(["message 1"]);
    expect(last.nextCursor).toBeNull();

    // A nonsense cursor reads as "from the newest", never an error.
    expect((await listChatHistory(db, vero, { limit: 3, before: "nope" })).messages).toHaveLength(3);
  });

  it("the interpreter's recent turns come from the database, not the client", async () => {
    const k = await newKitchen(db, ["Vero"]);
    const vero = await k.scope("Vero");
    const { seen, interpreter } = spy();
    await turn(vero, "I have chicken", { interpreter });
    await turn(vero, "yes, add them", {
      interpreter,
      history: [{ role: "user", text: "forged by the client" }],
    });
    expect(seen[1].history).toEqual([
      { role: "user", text: "I have chicken" },
      { role: "assistant", text: "re: I have chicken" },
    ]);
  });

  it("keeps the interpreter to the last 10 messages, and a retry never sees itself", async () => {
    const k = await newKitchen(db, ["Vero"]);
    const vero = await k.scope("Vero");
    for (let i = 1; i <= 12; i++) await saveUserMessage(db, vero, { clientMessageId: `old${i}`, text: `old ${i}` });
    const recent = await getRecentTurns(db, vero, { excludeClientMessageId: "old12" });
    expect(recent.map((r) => r.text)).toEqual(["old 2", "old 3", "old 4", "old 5", "old 6", "old 7", "old 8", "old 9", "old 10", "old 11"]);
  });

  it("a reloaded receipt offers Undo only while it's still undoable", async () => {
    const k = await newKitchen(db, ["Vero"]);
    const vero = await k.scope("Vero");
    await turn(vero, "I bought eggs");
    await turn(vero, "undo");
    const receipts = (await listChatHistory(db, vero)).messages.flatMap((m) => (m.receipt ? [m.receipt] : []));
    expect(receipts).toHaveLength(2);
    expect(receipts.map((r) => r.undoable)).toEqual([false, false]);
    expect(receipts[1].undoBlockedReason?.code).toBe("UNDO_OF_UNDO");
  });

  it("an undone receipt reads as undone after a reload, with who and when", async () => {
    const k = await newKitchen(db, ["Vero"]);
    const vero = await k.scope("Vero");
    await turn(vero, "I bought eggs");
    const before = (await listChatHistory(db, vero)).messages.find((m) => m.receipt)!.receipt!;
    expect(before).toMatchObject({ undone: false, undoable: true });
    expect(before).not.toHaveProperty("undoneBy");

    await turn(vero, "undo");
    const page = await listChatHistory(db, vero);
    expect(ChatHistoryPage.safeParse(page).success).toBe(true);
    const [bought, undid] = page.messages.flatMap((m) => (m.receipt ? [m.receipt] : []));
    expect(bought.changeSetId).toBe(before.changeSetId);
    expect(bought.undone).toBe(true);
    expect(bought.undoable).toBe(false);
    expect(bought.undoneBy).toEqual({ id: vero.userId, name: "Vero" });
    expect(Date.parse(bought.undoneAt!)).not.toBeNaN();
    // The undo's own receipt is not itself undone.
    expect(undid.undone).toBe(false);
  });

  describe("a receipt's batch choice after a reload (0025; tester re-run 2026-10-14, step 28)", () => {
    let taps = 0;
    const tapId = () => `hist-tap-${++taps}`;
    async function twoEggTurns() {
      const k = await newKitchen(db, ["Vero", "Levi"]);
      const vero = await k.scope("Vero");
      await turn(vero, "I bought eggs");
      await turn(vero, "I bought eggs");
      const receipts = async (scope = vero) =>
        (await listChatHistory(db, scope)).messages.flatMap((m) => (m.receipt ? [m.receipt] : []));
      const second = (await receipts())[1];
      const offer = second.applied[0].batchOffers![0];
      return { k, vero, receipts, second, offer };
    }

    it("'Those are gone' comes back with the receipt, undoable; once undone, the open choice comes back instead", async () => {
      const { vero, receipts, second, offer } = await twoEggTurns();
      expect(second.batchAnswers).toBeUndefined();
      const gone = await closeBatches(db, vero, { tapId: tapId(), basedOnVersion: second.newVersion, itemId: offer.itemId, batchIds: offer.older.map((o) => o.batchId) });
      if (!gone.ok) throw new Error(gone.error.reason.text);

      const page = await listChatHistory(db, vero);
      expect(ChatHistoryPage.safeParse(page).success).toBe(true);
      const [first, after] = page.messages.flatMap((m) => (m.receipt ? [m.receipt] : []));
      expect(first.batchAnswers).toBeUndefined();
      // The answered offer stays (its older batch is closed now), with the answer next to it.
      expect(after.applied[0].batchOffers).toEqual([offer]);
      expect(after.batchAnswers).toEqual([
        {
          itemId: offer.itemId,
          newBatchId: offer.newBatchId,
          choice: "gone",
          changeSetId: gone.result.changeSetId,
          applied: gone.result.applied,
          undoable: true,
        },
      ]);
      expect(after.batchAnswers![0].applied.map((a) => a.summary.code)).toEqual(["ITEM_BATCH_GONE"]);

      const back = await undo(db, vero, { changeSetId: gone.result.changeSetId, tapId: tapId(), basedOnVersion: gone.result.newVersion });
      if (!back.ok) throw new Error(back.error.reason.text);
      const reopened = (await receipts())[1];
      expect(reopened.batchAnswers).toBeUndefined();
      expect(reopened.applied[0].batchOffers).toEqual([offer]);
    });

    it("'Still have them' comes back too, not undoable; someone else's answer never shows on your receipt", async () => {
      const { k, vero, receipts, second, offer } = await twoEggTurns();
      const levi = await k.scope("Levi");
      const ids = offer.older.map((o) => o.batchId);
      const kept = await keepBatches(db, vero, { tapId: tapId(), basedOnVersion: second.newVersion, itemId: offer.itemId, batchIds: ids });
      if (!kept.ok) throw new Error(kept.error.reason.text);
      expect((await receipts())[1].batchAnswers).toMatchObject([{ choice: "keep", undoable: false, changeSetId: kept.result.changeSetId }]);

      // Levi closing them (e.g. on his own receipt) isn't an answer on Vero's.
      const gone = await closeBatches(db, levi, { tapId: tapId(), basedOnVersion: kept.result.newVersion, itemId: offer.itemId, batchIds: ids });
      if (!gone.ok) throw new Error(gone.error.reason.text);
      expect((await receipts())[1].batchAnswers?.map((a) => a.changeSetId)).toEqual([kept.result.changeSetId]);
    });
  });

  it("matches each answer to one receipt: the exact offer first, then the newest one before it", () => {
    const at = "2026-10-02T10:00:00.000Z";
    const row = (changeSetId: string, newVersion: number, newBatchId: string, older: string[]) =>
      ({
        receipt: {
          changeSetId,
          newVersion,
          undoable: true,
          rejected: [],
          applied: [
            {
              opId: "1",
              summary: { code: "ITEM_BATCH_ADDED", params: {}, text: "" },
              refs: [],
              batchOffers: [{ itemId: "eggs", name: "eggs", newBatchId, older: older.map((batchId) => ({ batchId, addedAt: at })) }],
            },
          ],
        },
      }) as unknown as Parameters<typeof matchBatchAnswers>[0][number];
    // Three purchases: the 2nd offers b1; the 3rd offers b1 and b2.
    const rows = [row("r2", 2, "b2", ["b1"]), row("r3", 3, "b3", ["b1", "b2"])];
    const answer = (changeSetId: string, version: number, batchIds: string[]) => ({
      changeSetId,
      version,
      itemId: "eggs",
      batchIds,
      choice: "gone" as const,
      applied: [],
      undoable: true,
    });
    const where = (found: ReturnType<typeof answer>[]) =>
      Object.fromEntries([...matchBatchAnswers(rows, found)].map(([r, list]) => [r, list.map((a) => a.changeSetId)]));
    expect(where([answer("a", 4, ["b1"])])).toEqual({ r2: ["a"] });
    expect(where([answer("a", 4, ["b1", "b2"])])).toEqual({ r3: ["a"] });
    expect(where([answer("a", 4, ["b1"]), answer("b", 5, ["b2"])])).toEqual({ r2: ["a"], r3: ["b"] });
    // Never on a receipt from after the answer, or for batches it never offered.
    expect(where([answer("a", 2, ["b1"])])).toEqual({});
    expect(where([answer("a", 4, ["zz"])])).toEqual({});
  });

  it("if the chat can't be saved or read, the turn still applies and finishes (0018)", async () => {
    const broken = await openLocalDb();
    const errors = console.error;
    const logged: unknown[] = [];
    console.error = (...args: unknown[]) => logged.push(args[0]);
    try {
      const k = await newKitchen(broken.db, ["Vero"]);
      const vero = await k.scope("Vero");
      await broken.db.execute(sql`DROP TABLE chat_messages`);
      const out = await turn(vero, "I bought eggs", { on: broken.db });
      expect(out.types).toEqual(["ack", "status", "status", "applied", "status", "text", "done"]);
      expect((await getKitchenState(broken.db, vero)).items.map((i) => i.name.value)).toEqual(["eggs"]);
      expect(logged).toEqual([
        "chat.history: couldn't load recent turns",
        "chat.history: couldn't save user message",
        "chat.history: couldn't save reply",
      ]);
    } finally {
      console.error = errors;
      await broken.close();
    }
  });
});
