/**
 * Sorting "Not sure where" once (0041), run by the main layout on each load before it reads the
 * kitchen and chat. The first load after this ships puts unplaced items where they usually go, as
 * one change set (`applyPlacesSortOnce`), and saves a chat message with its "What changed" receipt
 * and Undo for the person whose load did it. Every later load is one small query, or none.
 *
 * Never throws (0018): a failure is logged and the page loads as before. If the sort saved but
 * the message didn't, the sort still stands (it's in the kitchen's history and the other member's
 * "Since your last visit"), and the "done" mark means it isn't repeated.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import type { Db } from "@/db/client";
import { saveAssistantMessage } from "@/domains/chat/commands";
import { applyPlacesSortOnce, placesSortProposalId, type PlacesSortOutcome } from "@/domains/kitchen/commands";
import type { KitchenScope } from "@/shared/membership";

export type SortOutcome = PlacesSortOutcome & { messageSaved?: boolean };

export async function sortUnplacedOnce(db: Db, scope: KitchenScope, options: { now?: Date } = {}): Promise<SortOutcome> {
  let outcome: PlacesSortOutcome;
  try {
    outcome = await applyPlacesSortOnce(db, scope, options);
  } catch (error) {
    console.error("kitchen.sort-places: couldn't sort; nothing changed", { error });
    return { ran: false };
  }
  if (!outcome.ran || !outcome.reply || !outcome.mine) return { ...outcome, ...(outcome.ran ? { messageSaved: false } : {}) };
  try {
    await saveAssistantMessage(db, scope, {
      id: randomUUID(),
      clientMessageId: placesSortProposalId(scope.kitchenId),
      text: outcome.reply,
      result: outcome.result,
      ...(options.now ? { now: options.now } : {}),
    });
    return { ...outcome, messageSaved: true };
  } catch (error) {
    console.error("kitchen.sort-places: sorted, but couldn't save the chat message", { error });
    return { ...outcome, messageSaved: false };
  }
}
