/** The calm passphrase hint (SU1 Rec; `src/ui/auth/strength.ts`) and its match with the server's rules. */
import { describe, expect, it } from "vitest";
import { PASSPHRASE_MAX as SERVER_MAX, PASSPHRASE_MIN as SERVER_MIN, passphraseProblem } from "@/lib/auth/passphrase";
import { PASSPHRASE_MAX, PASSPHRASE_MIN, passphraseHint, passphraseProblemKey } from "@/ui/auth/strength";

describe("passphraseHint", () => {
  it("uses the server's limits", () => {
    expect(PASSPHRASE_MIN).toBe(SERVER_MIN);
    expect(PASSPHRASE_MAX).toBe(SERVER_MAX);
  });

  it("counts down to 12, then 'ok', then 'strong' at 20 characters or 4 words", () => {
    expect(passphraseHint("")).toEqual({ key: "start" });
    expect(passphraseHint("olive")).toEqual({ key: "more", count: 7 });
    expect(passphraseHint("olive lemon")).toEqual({ key: "more", count: 1 });
    expect(passphraseHint("olive lemons")).toEqual({ key: "ok" });
    expect(passphraseHint("a b c dddddddd")).toEqual({ key: "strong" });
    expect(passphraseHint("olivelemonwindowsill")).toEqual({ key: "strong" });
  });

  it("counts characters the way the server does (code points after NFKC)", () => {
    for (const value of ["", "short", "élan vital ok", "🍋🍋🍋🍋🍋🍋🍋🍋🍋🍋🍋🍋", "ﬁﬁﬁﬁﬁﬁ", "x".repeat(256), "x".repeat(257)]) {
      const server = passphraseProblem(value);
      const client = passphraseProblemKey(value);
      expect(client, value).toBe(server === "tooShort" ? "passphraseTooShort" : server === "tooLong" ? "passphraseTooLong" : null);
    }
  });
});
