/**
 * The AI layer's entry points (ai.md §9). Which interpreter runs is a server setting, never a user
 * choice (0020):
 * - AI_MODE=real with ANTHROPIC_API_KEY → real Claude interpreter.
 * - AI_MODE=real without a key, or production without AI_MODE=fake → a stub that changes nothing
 *   and says the AI isn't set up (never silently fake in production).
 * - Otherwise (local dev and tests) → the deterministic fake.
 */
import type { Db } from "@/db/client";
import { getChangesSince } from "@/domains/kitchen/queries";
import type { KitchenScope } from "@/shared/membership";
import { createFakeInterpreter, type RecentChangesLookup } from "./fake";
import type { Interpreter } from "./interpreter";
import { getMealAI } from "./meals";
import type { MealAI } from "./meals";
import { createRealInterpreter } from "./real";

export { handleChatTurn, handleChooseMeal, undoWithFollow, type ChatTurnInput, type ChooseMealInput } from "./turn";
export type { Interpreter, InterpretRequest, InterpretResult } from "./interpreter";

export const NOT_CONFIGURED_REPLY =
  "Kitchen's AI isn't set up on this server yet, so I can't read messages. The buttons still work.";

export const notConfiguredInterpreter: Interpreter = {
  async interpret() {
    return { kind: "answer", proposal: null, reply: NOT_CONFIGURED_REPLY };
  },
};

type Env = Record<string, string | undefined>;
export type InterpreterKind = "real" | "fake" | "not-configured";

export function selectInterpreterKind(env: Env = process.env): InterpreterKind {
  if (env.AI_MODE === "real") return env.ANTHROPIC_API_KEY?.trim() ? "real" : "not-configured";
  if (env.NODE_ENV === "production" && env.AI_MODE !== "fake") return "not-configured";
  return "fake";
}

/** How many recent change sets the fake looks through for "undo". */
const RECENT_CHANGES = 30;

let real: Interpreter | undefined;

/** Ideas and recipes, from the same server setting as the interpreter (0020). */
export function getMeals(env: Env = process.env): MealAI {
  return getMealAI(selectInterpreterKind(env));
}

export function getInterpreter(ctx: { db: Db; scope: KitchenScope }, env: Env = process.env): Interpreter {
  switch (selectInterpreterKind(env)) {
    case "real":
      real ??= createRealInterpreter();
      return real;
    case "not-configured":
      return notConfiguredInterpreter;
    case "fake":
      return createFakeInterpreter(recentChangesFor(ctx));
  }
}

/** For the stand-in's "undo": the speaker's own recent change sets, newest first. */
export function recentChangesFor(ctx: { db: Db; scope: KitchenScope }): RecentChangesLookup {
  return async (req) => {
    const recent = await getChangesSince(ctx.db, ctx.scope, Math.max(0, req.version - RECENT_CHANGES));
    return recent.filter((c) => !("missing" in c.actor) && c.actor.id === req.userId).reverse();
  };
}
