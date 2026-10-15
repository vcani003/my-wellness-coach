/**
 * Pure rules for the places (Kitchen OS layout, 0042), easy to unit-test:
 * - which place a URL belongs to (the dock marks it; the Recipe belongs to Meals);
 * - where your own change shows, for the "Kitchen updated · Show" cue. The page you're looking at
 *   stays put (0035 f); the cue appears only when the change concerns another place.
 * - "reopen where you left off" (ux.md §10, the list waiting at the store): remembered per phone.
 */
import type { ChangeRef } from "@/contracts/apply-result";
import type { PlaceDef } from "./types";

type Places = readonly Pick<PlaceDef, "id" | "owns" | "wantsFocus" | "hosts">[];

/** The place a URL belongs to; null for Settings and anything else outside the dock. */
export function placeForPath<P extends Places[number]>(places: readonly P[], pathname: string | null): P | null {
  if (!pathname) return null;
  return places.find((p) => p.owns(pathname)) ?? null;
}

/** The places your saved changes concern, in dock order. */
export function placesFor<P extends Places[number]>(places: readonly P[], refs: readonly ChangeRef[]): P[] {
  return places.filter((p) => refs.some((r) => p.wantsFocus(r)));
}

/**
 * Where to point the "updated · Show" cue after your own change, or null when you're already
 * looking at a place it concerns (or it concerns none).
 */
export function cueTarget<P extends Places[number]>(places: readonly P[], refs: readonly ChangeRef[], currentId: string | null): P | null {
  const wanted = placesFor(places, refs);
  if (!wanted.length || wanted.some((p) => p.id === currentId)) return null;
  return wanted[0];
}

/** The place that hosts a domain screen ID ("meals.ideas" → Meals). */
export function placeForHost<P extends Places[number]>(places: readonly P[], hostId: string): P | null {
  return places.find((p) => p.id === hostId || p.hosts?.includes(hostId)) ?? null;
}

/** How long "where you left off" is worth reopening (a shopping trip). After that, Today. */
export const RESUME_WINDOW_MS = 3 * 60 * 60 * 1000;

export interface LastPlace {
  id: string;
  at: number;
}

export function parseLastPlace(raw: string | null): LastPlace | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === "object" && typeof (v as LastPlace).id === "string" && typeof (v as LastPlace).at === "number") return v as LastPlace;
  } catch {
    // Unreadable: start at Today.
  }
  return null;
}

/** On a fresh open of `/`, the place to reopen instead (null = stay on Today). */
export function resumePlace(last: LastPlace | null, now: number, knownIds: readonly string[], todayId: string): string | null {
  if (!last || last.id === todayId || !knownIds.includes(last.id)) return null;
  const age = now - last.at;
  return age >= 0 && age < RESUME_WINDOW_MS ? last.id : null;
}
