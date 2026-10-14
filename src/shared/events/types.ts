/**
 * The event envelope (backend-data.md §3): the fields every event has, in every domain.
 */
export type Via = "chat" | "button" | "system";

export interface EventEnvelope<TType extends string = string, TPayload = unknown> {
  id: string;
  /** `kitchen:<id>` or `user:<id>` */
  stream: string;
  /** Position in the stream. 0 until the event store assigns it on insert. */
  seq: number;
  type: TType;
  /** Payload schema version. */
  v: number;
  /** Who caused it; always set (0006). */
  actor: string;
  via: Via;
  /** ISO 8601: when we saved it. */
  recordedAt: string;
  /** ISO 8601: when the user says it happened, or null if unknown. */
  occurredAt: string | null;
  /** Groups everything from one message or tap: the unit of "What changed" and Undo. */
  changeSetId: string;
  sourceMessageId: string | null;
  /** The change set this event undoes. */
  reverses: string | null;
  /** The event this one fixes. */
  corrects: string | null;
  payload: TPayload;
}

export const kitchenStream = (kitchenId: string) => `kitchen:${kitchenId}`;
export const userStream = (userId: string) => `user:${userId}`;

export function streamKind(stream: string): "kitchen" | "user" | "unknown" {
  if (stream.startsWith("kitchen:")) return "kitchen";
  if (stream.startsWith("user:")) return "user";
  return "unknown";
}

/** `changeset.reverted` is shared by every stream: it restores each touched entity's prior value. */
export const CHANGESET_REVERTED = "changeset.reverted" as const;
export interface ChangesetRevertedPayload<TEntity = unknown> {
  changeSetId: string;
  /** Entity key (e.g. `item:<id>`) → its value before the change set, or null if it didn't exist. */
  restore: Record<string, TEntity | null>;
}

/** Fields every current-state entity carries (backend-data.md §4). Actor IDs, ISO timestamps. */
export interface AuditFields {
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export function entityKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

export function splitEntityKey(key: string): { kind: string; id: string } {
  const at = key.indexOf(":");
  return { kind: key.slice(0, at), id: key.slice(at + 1) };
}

/** Drop `undefined` properties so entities compare equal after a JSON round trip. */
export function compact<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}
