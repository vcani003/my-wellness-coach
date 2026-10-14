/**
 * One chat turn end to end on an embedded Postgres: the FAKE interpreter → the real backend
 * validate → apply path → the reply, as the canonical stream events (backend-data.md §6).
 * Covers journey steps 1–4 as the e2e test drives them (bought → froze → undo).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import type { StreamEvent } from "@/contracts/stream";
import { getInterpreter, handleChatTurn } from "@/ai";
import { FALLBACK_REPLY, NOTHING_TO_UNDO_REPLY } from "@/ai/fake";
import type { Interpreter } from "@/ai/interpreter";
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
  const id = opts.id ?? `msg-${++n}`;
  for await (const e of handleChatTurn({ db, scope, interpreter: opts.interpreter ?? getInterpreter({ db, scope }) }, { clientMessageId: id, text })) {
    events.push(e);
  }
  const applied = events.find((e) => e.type === "applied");
  const reply = events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join("");
  return { events, types: events.map((e) => e.type), result: applied?.type === "applied" ? applied.result : null, reply };
}

const where = async (scope: KitchenScope) =>
  Object.fromEntries((await getKitchenState(db, scope)).items.map((i) => [i.name.value, i.location?.value ?? "unknown"]));

describe("chat turn with the fake interpreter", () => {
  it("journey: bought → froze → undo, in the fixed event order", async () => {
    const k = await newKitchen(db, ["Vero"]);
    const vero = await k.scope("Vero");

    const bought = await turn(vero, "I bought eggs, chicken thighs, spinach and yogurt");
    expect(bought.types).toEqual(["ack", "status", "status", "applied", "status", "text", "done"]);
    expect(bought.result?.applied.map((a) => a.summary.text)).toEqual([
      "Added eggs",
      "Added chicken thighs",
      "Added spinach",
      "Added yogurt",
    ]);
    expect(bought.reply).toBe("All set: added eggs, chicken thighs, spinach, and yogurt.");

    const froze = await turn(vero, "I froze the chicken");
    expect(froze.result?.applied[0].summary.text).toBe("chicken thighs → freezer");
    expect((await where(vero))["chicken thighs"]).toBe("freezer");

    const undone = await turn(vero, "undo");
    expect(undone.result?.applied[0].summary.code).toBe("UNDONE");
    expect(undone.result?.undoable).toBe(false);
    expect((await where(vero))["chicken thighs"]).toBe("unknown");
    expect(undone.reply).toBe("No problem, that's undone.");
    expect(froze.reply).toBe("All set: moved the chicken to the freezer.");
  });

  it("used up and running low go through apply; out items leave the list (0011)", async () => {
    const k = await newKitchen(db, ["Vero"]);
    const vero = await k.scope("Vero");
    await turn(vero, "I bought spinach and yogurt");
    await turn(vero, "I used the rest of the spinach");
    const low = await turn(vero, "The yogurt is running low");
    expect(low.result?.applied[0].summary.code).toBe("ITEM_LOW");
    const state = await getKitchenState(db, vero);
    expect(state.items.map((i) => [i.name.value, i.stock?.value])).toEqual([["yogurt", "low"]]);
  });

  it("anything it doesn't understand: a polite reply and no changes", async () => {
    const k = await newKitchen(db, ["Vero"]);
    const vero = await k.scope("Vero");
    const out = await turn(vero, "Is it going to rain later?");
    expect(out.types).toEqual(["ack", "status", "status", "text", "done"]);
    expect(out.reply).toBe(FALLBACK_REPLY);
    expect((await getKitchenState(db, vero)).version).toBe(0);
  });

  it("undo only ever undoes your own change (H3, 0017)", async () => {
    const k = await newKitchen(db, ["Vero", "Levi"]);
    await turn(await k.scope("Levi"), "I bought milk");
    const out = await turn(await k.scope("Vero"), "undo");
    expect(out.reply).toBe(NOTHING_TO_UNDO_REPLY);
    expect(out.result).toBeNull();
  });

  it("a partial rejection is reported in place and in the reply", async () => {
    const k = await newKitchen(db, ["Vero"]);
    const vero = await k.scope("Vero");
    await turn(vero, "I bought chicken thighs and chicken wings");
    const out = await turn(vero, "I froze the chicken");
    expect(out.result?.rejected.map((r) => r.reason.code)).toEqual(["AMBIGUOUS_ITEM"]);
    expect(out.reply).toBe("I couldn't change anything: More than one item matches chicken.");
  });

  it("with rejections, the interpreter's reword is used when it has one", async () => {
    const k = await newKitchen(db, ["Vero"]);
    const vero = await k.scope("Vero");
    await turn(vero, "I bought chicken thighs and chicken wings");
    const fake = getInterpreter({ db, scope: vero });
    const withReword: Interpreter = { interpret: fake.interpret, reword: async (_req, _res, applied) => `reworded ${applied.rejected.length}` };
    const out = await turn(vero, "I froze the chicken", { interpreter: withReword });
    expect(out.reply).toBe("reworded 1");
  });

  it("retrying the same message ID never applies twice", async () => {
    const k = await newKitchen(db, ["Vero"]);
    const vero = await k.scope("Vero");
    await turn(vero, "I bought eggs", { id: "same" });
    const again = await turn(vero, "I bought eggs", { id: "same" });
    expect(again.result?.applied).toHaveLength(1);
    expect((await getKitchenState(db, vero)).items).toHaveLength(1);
  });

  it("if the interpreter throws, the stream ends with a retryable error and nothing changed", async () => {
    const k = await newKitchen(db, ["Vero"]);
    const broken: Interpreter = { interpret: async () => Promise.reject(new Error("boom")) };
    const errors = console.error;
    console.error = () => {};
    const out = await turn(await k.scope("Vero"), "hi", { interpreter: broken });
    console.error = errors;
    expect(out.events.at(-1)).toMatchObject({ type: "error", changed: false, retryable: true });
  });
});
