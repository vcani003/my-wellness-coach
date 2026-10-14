"use client";
/**
 * Shared-kitchen cues (ux.md §6), the React part:
 * - **Since your last visit:** on the first state this screen shows you, ask `/changes` what
 *   the other members did after the version this device last showed you. The line stays until
 *   you dismiss it, even across a reload: while it's showing, the stored version stays put.
 *   Otherwise the stored version follows whatever is on screen, so the next visit starts there.
 *   Without storage there's simply no line (0018).
 * - **While you're looking:** `liveRemovals(change)` turns a sync that took items off the list
 *   into "Levi used up the eggs", kept until your next message (`clearLive`).
 * Lives in the screen, not the widget, so collapsing the Kitchen doesn't lose it. Switching who
 * you are (the dev bar) starts over for that person.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { KitchenSync, RemoteChange } from "./kitchen-sync";
import { othersChanges, readLastSeen, REMOVAL_CODES, sinceBaseline, writeLastSeen, type CueEntry } from "./shared-cues";

export interface SharedCues {
  /** "Since your last visit", oldest first; empty = no line. */
  since: CueEntry[];
  dismissSince: () => void;
  /** The other members' removals while you were looking, until your next message. */
  live: CueEntry[];
}

const NONE: CueEntry[] = [];

interface Session {
  who: string;
  /** True once there's no line to keep: the stored version then follows the screen. */
  following: boolean;
}

export function useSharedCues(opts: { kitchenId: string; meId: string; sync: KitchenSync; version: number | null }) {
  const { kitchenId, meId, sync, version } = opts;
  const who = `${kitchenId}\n${meId}`;
  // Keyed by person, so a switch never shows the previous person's lines.
  const [since, setSince] = useState<{ who: string; entries: CueEntry[] }>({ who, entries: NONE });
  const [live, setLive] = useState<{ who: string; entries: CueEntry[] }>({ who, entries: NONE });
  const session = useRef<Session | null>(null);
  const versionNow = useRef(version);

  useEffect(() => {
    versionNow.current = version;
    if (version === null) return;
    if (session.current?.who === who) {
      if (session.current.following) writeLastSeen(kitchenId, meId, version);
      return;
    }
    const s: Session = { who, following: false };
    session.current = s;
    const base = sinceBaseline(readLastSeen(kitchenId, meId), version);
    if (base === null) {
      s.following = true;
      writeLastSeen(kitchenId, meId, version);
      return;
    }
    // Only up to what this first screen shows: later changes get the live cue instead.
    void sync.changesSince(base).then((changes) => {
      if (session.current !== s || !changes) return; // switched away, or try again next visit
      const entries = othersChanges(changes, meId, { since: base, through: version });
      if (entries.length) {
        setSince({ who, entries });
        return;
      }
      s.following = true;
      writeLastSeen(kitchenId, meId, versionNow.current ?? version);
    });
  }, [kitchenId, meId, who, sync, version]);

  const dismissSince = useCallback(() => {
    setSince({ who, entries: NONE });
    if (session.current?.who === who) session.current.following = true;
    if (versionNow.current !== null) writeLastSeen(kitchenId, meId, versionNow.current);
  }, [kitchenId, meId, who]);

  const clearLive = useCallback(() => setLive({ who, entries: NONE }), [who]);

  /** Who took items off the list in this sync; null if `/changes` couldn't say. Never throws. */
  const liveRemovals = useCallback(
    async (change: RemoteChange): Promise<CueEntry[] | null> => {
      if (!change.removedIds.length) return [];
      const changes = await sync.changesSince(change.fromVersion);
      if (!changes) return null;
      const entries = othersChanges(changes, meId, { since: change.fromVersion, through: change.toVersion, only: REMOVAL_CODES });
      if (entries.length) setLive((prev) => ({ who, entries: [...(prev.who === who ? prev.entries : NONE), ...entries] }));
      return entries;
    },
    [sync, meId, who],
  );

  const cues: SharedCues = {
    since: since.who === who ? since.entries : NONE,
    dismissSince,
    live: live.who === who ? live.entries : NONE,
  };
  return { cues, liveRemovals, clearLive };
}
