/**
 * The append-only event store. Callers must hold the stream's lock (the kitchen row, or the
 * user row for a profile stream) inside the same transaction, so `seq` never collides.
 */
import { and, asc, eq, inArray, max } from "drizzle-orm";
import { events } from "@/db/schema";
import type { Queryable } from "@/db/client";
import type { EventEnvelope, Via } from "./types";

type Row = typeof events.$inferSelect;

export function rowToEvent(row: Row): EventEnvelope {
  return {
    id: row.id,
    stream: row.stream,
    seq: row.seq,
    type: row.type,
    v: row.v,
    actor: row.actorId,
    via: row.via as Via,
    recordedAt: row.recordedAt.toISOString(),
    occurredAt: row.occurredAt ? row.occurredAt.toISOString() : null,
    changeSetId: row.changeSetId,
    sourceMessageId: row.sourceMessageId,
    reverses: row.reverses,
    corrects: row.corrects,
    payload: row.payload,
  };
}

/** Assign `seq` per stream (continuing from the stream's last one) and insert. Returns the stored events. */
export async function appendEvents(db: Queryable, pending: EventEnvelope[]): Promise<EventEnvelope[]> {
  if (pending.length === 0) return [];
  const streams = [...new Set(pending.map((e) => e.stream))];
  const lastRows = await db
    .select({ stream: events.stream, last: max(events.seq) })
    .from(events)
    .where(inArray(events.stream, streams))
    .groupBy(events.stream);
  const next = new Map(streams.map((s) => [s, 0]));
  for (const r of lastRows) next.set(r.stream, r.last ?? 0);

  const stored = pending.map((e) => {
    const seq = (next.get(e.stream) ?? 0) + 1;
    next.set(e.stream, seq);
    return { ...e, seq };
  });
  await db.insert(events).values(
    stored.map((e) => ({
      id: e.id,
      stream: e.stream,
      seq: e.seq,
      type: e.type,
      v: e.v,
      actorId: e.actor,
      via: e.via,
      recordedAt: new Date(e.recordedAt),
      occurredAt: e.occurredAt ? new Date(e.occurredAt) : null,
      changeSetId: e.changeSetId,
      sourceMessageId: e.sourceMessageId,
      reverses: e.reverses,
      corrects: e.corrects,
      payload: e.payload,
    })),
  );
  return stored;
}

export async function loadStream(db: Queryable, stream: string): Promise<EventEnvelope[]> {
  const rows = await db.select().from(events).where(eq(events.stream, stream)).orderBy(asc(events.seq));
  return rows.map(rowToEvent);
}

export async function loadChangeSetEvents(db: Queryable, changeSetId: string): Promise<EventEnvelope[]> {
  const rows = await db
    .select()
    .from(events)
    .where(eq(events.changeSetId, changeSetId))
    .orderBy(asc(events.stream), asc(events.seq));
  return rows.map(rowToEvent);
}

/** Does this event exist in one of these streams? (For `corrects` links.) */
export async function eventExistsInStreams(db: Queryable, eventId: string, streams: string[]): Promise<boolean> {
  if (streams.length === 0) return false;
  const rows = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.id, eventId), inArray(events.stream, streams)))
    .limit(1);
  return rows.length > 0;
}
