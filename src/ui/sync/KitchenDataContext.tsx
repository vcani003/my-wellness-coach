"use client";
/**
 * What widgets read (0004: widgets read domain data, never chat text): the current state, the
 * sync status, who "I" am, and which rows to highlight.
 */
import { createContext, useContext } from "react";
import type { SyncSnapshot } from "./kitchen-sync";

export type ChangeMark = "new" | "updated";

export interface KitchenData {
  me: { id: string; name: string };
  snapshot: SyncSnapshot;
  /** Rows changed by YOUR last turn → "New" / "Updated", until your next message. */
  marks: Record<string, ChangeMark>;
  /** Rows the other person changed while you were looking → soft highlight. */
  remoteIds: ReadonlySet<string>;
  /** "Now" for relative times; refreshed every minute. */
  now: Date;
  /** Counts your sent messages: per-turn notes ("removed · Undo") last until the next one. */
  turn?: number;
}

const Ctx = createContext<KitchenData | null>(null);
export const KitchenDataProvider = Ctx.Provider;

export function useKitchenData(): KitchenData {
  const value = useContext(Ctx);
  if (!value) throw new Error("useKitchenData must be used inside KitchenDataProvider");
  return value;
}
