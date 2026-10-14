/** Passphrase hashing and the link-page gate (SU1 Rec; backend-data.md §7). */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { gate, isLinkPage, isPublicPath } from "@/lib/auth/gate";
import { hashInviteToken, linkPath, newInviteToken } from "@/lib/auth/invites";
import {
  DEFAULT_SCRYPT,
  hashPassphrase,
  nameProblem,
  normalizeName,
  passphraseProblem,
  verifyPassphrase,
} from "@/lib/auth/passphrase";
import { parseEnv } from "@/lib/env";

const CHEAP = { ln: 10, r: 8, p: 1 };

describe("passphrase hashing (scrypt)", () => {
  it("round-trips with the real cost, and refuses a wrong passphrase", async () => {
    const stored = await hashPassphrase("correct horse battery staple");
    expect(stored).toMatch(new RegExp(`^scrypt\\$ln=${DEFAULT_SCRYPT.ln},r=8,p=1\\$`));
    expect(stored).not.toContain("horse");
    expect(await verifyPassphrase("correct horse battery staple", stored)).toBe(true);
    expect(await verifyPassphrase("correct horse battery stapler", stored)).toBe(false);
    expect(await verifyPassphrase("", stored)).toBe(false);
  });

  it("salts every hash, and reads the parameters stored with it", async () => {
    const a = await hashPassphrase("same passphrase here", CHEAP);
    const b = await hashPassphrase("same passphrase here", CHEAP);
    expect(a).not.toBe(b);
    expect(await verifyPassphrase("same passphrase here", a)).toBe(true);
    expect(await verifyPassphrase("same passphrase here", b)).toBe(true);
  });

  it("matches the same phrase however the accents were typed (NFKC)", async () => {
    const composed = "crème brûlée forever"; // é as one character
    const decomposed = composed.normalize("NFD"); // e + combining accent
    const stored = await hashPassphrase(composed, CHEAP);
    expect(await verifyPassphrase(decomposed, stored)).toBe(true);
  });

  it("never throws on a malformed stored hash", async () => {
    for (const bad of ["", "plain", "scrypt$ln=99,r=8,p=1$aaaaaaaaaaaaaaaaaaaaaa$bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "bcrypt$2b$..."]) {
      expect(await verifyPassphrase("whatever passphrase", bad)).toBe(false);
    }
  });

  it("needs 12 to 256 characters, spaces included", () => {
    expect(passphraseProblem("short")).toBe("tooShort");
    expect(passphraseProblem("eleven char")).toBe("tooShort");
    expect(passphraseProblem("twelve chars")).toBeNull();
    expect(passphraseProblem("x".repeat(256))).toBeNull();
    expect(passphraseProblem("x".repeat(257))).toBe("tooLong");
    expect(passphraseProblem("🍋🍋🍋🍋🍋🍋🍋🍋🍋🍋🍋🍋")).toBeNull(); // characters, not bytes
  });

  it("tidies names and refuses odd ones", () => {
    expect(normalizeName("  Levi   Le ")).toBe("Levi Le");
    expect(nameProblem("Levi")).toBeNull();
    expect(nameProblem("José María")).toBeNull();
    expect(nameProblem("O'Brien-Smith")).toBeNull();
    for (const bad of ["", "   ", "<script>", "a".repeat(41), "-dash", "tab\tname\u0000"]) expect(nameProblem(bad), bad).toBe("invalid");
  });
});

describe("link tokens", () => {
  it("are 32 random bytes; only their SHA-256 is kept", () => {
    const { token, tokenHash } = newInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(tokenHash).toBe(hashInviteToken(token));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).not.toContain(token);
    expect(newInviteToken().token).not.toBe(token);
    expect(linkPath("join", token)).toBe(`/join/${token}`);
  });
});

describe("gate: link pages", () => {
  const e = parseEnv({ NODE_ENV: "test", SESSION_SECRET: "test-session-secret-0123456789abcdef", ACCESS_CODES: "vero=vero-test-code-111" });
  const token = newInviteToken().token;

  it("lets /join/<token> and /reset/<token> through without a session, and nothing near them", () => {
    for (const p of [`/join/${token}`, `/reset/${token}`]) {
      expect(isPublicPath(p), p).toBe(true);
      expect(isLinkPage(p), p).toBe(true);
      const res = gate(new NextRequest(`http://localhost${p}`), e);
      expect(res.headers.get("x-middleware-next"), p).toBe("1");
    }
    for (const p of ["/join", "/join/", "/reset", `/join/${token}/more`, `/joinx/${token}`, `/api/join/${token}`, `/settings/join/${token}`, "/join/a.b", "/join/%2e%2e"]) {
      expect(isPublicPath(p), p).toBe(false);
      const res = gate(new NextRequest(`http://localhost${p}`), e);
      expect(res.headers.get("x-middleware-next"), p).toBeNull();
    }
  });

  it("keeps the token out of Referer headers, caches and search engines", () => {
    const res = gate(new NextRequest(`http://localhost/join/${token}`), e);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  });
});
