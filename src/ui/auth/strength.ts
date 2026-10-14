/**
 * The passphrase hint under a new-passphrase field (SU1 Rec). Pure, so it's unit-tested.
 *
 * Calm on purpose: it counts down to the 12-character minimum, then says "that works" and
 * suggests (never demands) another word. It never says "weak" and never turns red; the only rule
 * enforced is the server's (12–256 characters, `src/lib/auth/passphrase.ts`).
 */

/** Mirrors `PASSPHRASE_MIN` in `src/lib/auth/passphrase.ts` (server-only); a unit test keeps them equal. */
export const PASSPHRASE_MIN = 12;
export const PASSPHRASE_MAX = 256;

/** At this length, or with this many words, the hint says "strong". */
const STRONG_LENGTH = 20;
const STRONG_WORDS = 4;

export type PassphraseHint = { key: "start" } | { key: "more"; count: number } | { key: "ok" } | { key: "strong" };

/** Characters as the server counts them (NFKC, by code point). */
export const passphraseLength = (value: string) => [...value.normalize("NFKC")].length;

export function passphraseHint(value: string): PassphraseHint {
  const length = passphraseLength(value);
  if (length === 0) return { key: "start" };
  if (length < PASSPHRASE_MIN) return { key: "more", count: PASSPHRASE_MIN - length };
  const words = value.trim().split(/\s+/u).filter(Boolean).length;
  return length >= STRONG_LENGTH || words >= STRONG_WORDS ? { key: "strong" } : { key: "ok" };
}

/** The client-side check before sending: the same two problems the server reports. */
export function passphraseProblemKey(value: string): "passphraseTooShort" | "passphraseTooLong" | null {
  const length = passphraseLength(value);
  if (length < PASSPHRASE_MIN) return "passphraseTooShort";
  if (length > PASSPHRASE_MAX) return "passphraseTooLong";
  return null;
}
