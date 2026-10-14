/**
 * The AI layer's entry points (ai.md §9). `getInterpreter()` returns the FAKE interpreter unless
 * AI_MODE=real.
 */
import type { Db } from "@/db/client";
import { getChangesSince } from "@/domains/kitchen/queries";
import type { KitchenScope } from "@/shared/membership";
import { createFakeInterpreter } from "./fake";
import type { Interpreter } from "./interpreter";

export { handleChatTurn, type ChatTurnInput } from "./turn";
export type { Interpreter, InterpretRequest, InterpretResult } from "./interpreter";

/** How many recent change sets the fake looks through for "undo". */
const RECENT_CHANGES = 30;

export function getInterpreter(ctx: { db: Db; scope: KitchenScope }): Interpreter {
  if (process.env.AI_MODE === "real") {
    // TODO(AI specialist): register the real interpreter here (ai.md §1). Until then, AI_MODE=real
    // falls back to the fake so the app keeps working.
    console.warn("AI_MODE=real, but the real interpreter isn't registered yet; using the fake");
  }
  return createFakeInterpreter(async (req) => {
    const recent = await getChangesSince(ctx.db, ctx.scope, Math.max(0, req.version - RECENT_CHANGES));
    return recent.filter((c) => !("missing" in c.actor) && c.actor.id === req.userId).reverse();
  });
}
