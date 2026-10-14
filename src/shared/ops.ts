/** Shapes shared by every domain's operation validators. */
import type { BatchOffer, ChangeRef } from "@/contracts/apply-result";
import type { Msg } from "@/contracts/common";
import { msg } from "./messages";
import type { EventEnvelope } from "./events/types";

export type OpOutcome =
  | { ok: true; events: EventEnvelope[]; summary: Msg; refs: ChangeRef[]; batchOffers?: BatchOffer[] }
  | { ok: false; reason: Msg };

export const reject = (code: string, params: Msg["params"] = {}): OpOutcome => ({
  ok: false,
  reason: msg(code, params),
});

/** Builds a full envelope for the change set being planned. `seq` is assigned by the event store. */
export type EventFactory = (
  stream: string,
  type: string,
  payload: unknown,
  extra?: { occurredAt?: string | null; reverses?: string | null },
) => EventEnvelope;
