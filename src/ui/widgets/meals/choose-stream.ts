/**
 * Choose on an idea card, streamed (`POST /api/meals/choose`, backend §6): the same turn events as
 * chat (`ack`, `applied`, `recipe` parts, `recipe.saved`, `done` / `error`), but nothing goes to
 * the chat. Never throws: the outcome says how it ended (0018).
 */
import type { StreamEvent } from "@/contracts/stream";
import { readTurnStream } from "@/ui/chat/stream";

export type ChooseOutcome = "done" | "error" | "notSent" | "cut";

export async function streamChoose(opts: {
  kitchenId: string;
  /** The tap ID: a retry with the same ID can never choose twice. */
  key: string;
  target: { ideaId: string } | { mealId: string };
  onEvent: (event: StreamEvent) => void;
  fetchImpl?: typeof fetch;
}): Promise<ChooseOutcome> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch("/api/meals/choose", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/x-ndjson" },
      body: JSON.stringify({ kitchenId: opts.kitchenId, clientMessageId: opts.key, ...opts.target }),
    });
    if (!res.ok || !res.body) return "notSent";
  } catch {
    return "notSent";
  }
  let acked = false;
  try {
    for await (const event of readTurnStream(res.body)) {
      if (event.type === "ack") acked = true;
      opts.onEvent(event);
      if (event.type === "done") return "done";
      if (event.type === "error") return "error";
    }
  } catch {
    // the connection dropped: below
  }
  return acked ? "cut" : "notSent";
}
