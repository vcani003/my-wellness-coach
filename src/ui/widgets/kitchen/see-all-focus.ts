"use client";
/**
 * Where focus lands when See all opens (CAT1): the search field after the compact widget's search
 * icon, else the heading. Set by the link's click and good for a few seconds, so a fresh load or a
 * later Back/Forward starts at the heading. Not used up on read: React runs a mount effect twice in
 * development (Strict Mode) and again when Next reveals a kept route, and each must agree.
 */
export type SeeAllFocus = "search" | "heading";

const VALID_MS = 3000;
let pending: { target: SeeAllFocus; at: number } | null = null;

export function requestSeeAllFocus(target: SeeAllFocus) {
  pending = { target, at: Date.now() };
}

/** The recently requested target; "heading" when nothing asked lately. */
export function seeAllFocusTarget(): SeeAllFocus {
  return pending && Date.now() - pending.at < VALID_MS ? pending.target : "heading";
}
