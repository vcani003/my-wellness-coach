/**
 * Passphrases (SU1 Rec; backend-data.md §7). Pure node:crypto, no new dependency.
 *
 * - **Stored scrambled** with scrypt (a deliberately slow, memory-hungry hash, so guessing is
 *   expensive) and a random 16-byte salt per person. The stored string carries its own
 *   parameters, `scrypt$ln=17,r=8,p=1$<salt>$<hash>`, so they can be raised later and older
 *   hashes still check. ln=17 (N = 131072), r=8, p=1 is OWASP's scrypt baseline: about 0.3 s and
 *   128 MiB per check.
 * - **Rules:** 12 to 256 characters (counted as characters, not bytes). Unicode is normalised
 *   (NFKC) first, so the same phrase typed on a phone and a laptop matches. Spaces count.
 * - A passphrase never appears in a log, an error or a return value.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

export const PASSPHRASE_MIN = 12;
export const PASSPHRASE_MAX = 256;

export interface ScryptParams {
  /** log2 of the cost N. */
  ln: number;
  r: number;
  p: number;
}

export const DEFAULT_SCRYPT: ScryptParams = { ln: 17, r: 8, p: 1 };
const KEY_LEN = 32;
const SALT_LEN = 16;

function scrypt(passphrase: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  const N = 2 ** params.ln;
  const opts: ScryptOptions = { N, r: params.r, p: params.p, maxmem: 128 * N * params.r * 2 + 1024 * 1024 };
  return new Promise((resolve, reject) =>
    scryptCb(passphrase.normalize("NFKC"), salt, KEY_LEN, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export type PassphraseProblem = "tooShort" | "tooLong";

/** Why this passphrase can't be used, or null if it's fine. */
export function passphraseProblem(passphrase: string): PassphraseProblem | null {
  const length = [...passphrase.normalize("NFKC")].length;
  if (length < PASSPHRASE_MIN) return "tooShort";
  if (length > PASSPHRASE_MAX) return "tooLong";
  return null;
}

/** Scramble a passphrase for storage. */
export async function hashPassphrase(passphrase: string, params: ScryptParams = DEFAULT_SCRYPT): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await scrypt(passphrase, salt, params);
  return `scrypt$ln=${params.ln},r=${params.r},p=${params.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

const STORED = /^scrypt\$ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9_-]{16,})\$([A-Za-z0-9_-]{32,})$/;

/** Does `passphrase` match the stored hash? False (never a throw) for a malformed hash. */
export async function verifyPassphrase(passphrase: string, stored: string): Promise<boolean> {
  const m = STORED.exec(stored);
  if (!m) return false;
  const params = { ln: Number(m[1]), r: Number(m[2]), p: Number(m[3]) };
  if (params.ln < 10 || params.ln > 20 || params.r < 1 || params.p < 1) return false;
  const expected = Buffer.from(m[5], "base64url");
  let key: Buffer;
  try {
    key = await scrypt(passphrase.slice(0, PASSPHRASE_MAX * 4), Buffer.from(m[4], "base64url"), params);
  } catch {
    return false;
  }
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/**
 * A fixed hash with the default parameters, checked when a sign-in names nobody, so a wrong name
 * takes as long as a wrong passphrase and timing doesn't reveal which names exist.
 */
let dummy: Promise<string> | undefined;
export async function burnPassphraseCheck(passphrase: string): Promise<void> {
  dummy ??= hashPassphrase("not-a-real-passphrase-just-timing");
  await verifyPassphrase(passphrase, await dummy);
}

// ─── Display names (sign-in is by name) ───────────────────────────────────────────────

export const NAME_MAX = 40;

/** Trim, normalise and collapse spaces. Comparison is case-insensitive (`lower()` in Postgres). */
export function normalizeName(name: string): string {
  return name.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

/** Null if fine. Letters, numbers, spaces and a little punctuation; 1–40 characters. */
export function nameProblem(name: string): "invalid" | null {
  const n = normalizeName(name);
  if (n.length === 0 || [...n].length > NAME_MAX) return "invalid";
  if (!/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .'’-]*$/u.test(n)) return "invalid";
  return null;
}
