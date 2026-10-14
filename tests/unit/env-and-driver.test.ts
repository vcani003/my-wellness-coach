/** Production env validation and database driver selection (backend-data.md §2, §10). */
import { Pool } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";
import { openNeonDb, selectDriver } from "@/db/client";
import { parseEnv } from "@/lib/env";

const SECRET = "s3cr3t-value-that-must-never-be-printed-0123456789";
const CODES = "vero=vero-code-123456,levi=levi-code-654321";
const PROD = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:hunter2-password@ep-example.neon.tech/neondb?sslmode=require",
  SESSION_SECRET: SECRET,
  ACCESS_CODES: CODES,
};

const errorOf = (source: Record<string, string | undefined>) => {
  try {
    parseEnv(source);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("expected parseEnv to throw");
};

describe("production environment", () => {
  it("accepts a complete production environment", () => {
    const e = parseEnv(PROD);
    expect(e.DATABASE_URL).toBe(PROD.DATABASE_URL);
    expect(e.AI_MODE).toBe("fake");
  });

  it.each(["DATABASE_URL", "SESSION_SECRET", "ACCESS_CODES"])("requires %s, naming it without printing values", (name) => {
    const message = errorOf({ ...PROD, [name]: "" });
    expect(message).toContain(`${name} (required in production)`);
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain("hunter2");
    expect(message).not.toContain("vero-code");
  });

  it("refuses to start with the dev-only acting-as switch on", () => {
    expect(errorOf({ ...PROD, DEV_ACTING_AS: "vero" })).toContain("DEV_ACTING_AS");
    // Allowed outside production.
    expect(parseEnv({ NODE_ENV: "development", DEV_ACTING_AS: "tester-1" }).DEV_ACTING_AS).toBe("tester-1");
  });

  it("requires ANTHROPIC_API_KEY only when AI_MODE=real", () => {
    expect(errorOf({ ...PROD, AI_MODE: "real" })).toContain("ANTHROPIC_API_KEY (required when AI_MODE=real)");
    expect(parseEnv({ ...PROD, AI_MODE: "real", ANTHROPIC_API_KEY: "sk-test" }).AI_MODE).toBe("real");
    expect(errorOf({ ...PROD, AI_MODE: "maybe" })).toContain("AI_MODE");
  });

  it("checks secret length and code format without echoing them", () => {
    const short = errorOf({ ...PROD, SESSION_SECRET: "tooshort-secret" });
    expect(short).toContain("SESSION_SECRET (must be at least 32 characters)");
    expect(short).not.toContain("tooshort-secret");

    for (const bad of ["vero:abcdefghijkl", "vero=short", "vero=same-code-12345,levi=same-code-12345", "Vero=abcdefghijklm"]) {
      const message = errorOf({ ...PROD, ACCESS_CODES: bad });
      expect(message).toContain("ACCESS_CODES");
      expect(message).not.toMatch(/abcdefghijkl|short\b|same-code/);
    }
  });

  it("has no production requirements in development and test", () => {
    expect(() => parseEnv({ NODE_ENV: "test" })).not.toThrow();
    expect(() => parseEnv({})).not.toThrow();
  });
});

describe("blank values", () => {
  it("treat NAME= (as in a copied .env.example) as unset", () => {
    const blank = { PGLITE_DIR: "", AI_MODE: "", DATABASE_URL: "", SESSION_SECRET: "", ACCESS_CODES: "", ANTHROPIC_API_KEY: "", DEV_ACTING_AS: "" };
    const e = parseEnv(blank);
    expect(e).toMatchObject({ NODE_ENV: "development", PGLITE_DIR: ".data/pglite", AI_MODE: "fake" });
    expect(e.DATABASE_URL).toBeUndefined();
    expect(e.DEV_ACTING_AS).toBeUndefined();
  });
});

describe("driver selection", () => {
  it("uses Neon when DATABASE_URL is set, else PGlite", () => {
    expect(selectDriver(parseEnv(PROD))).toBe("neon");
    expect(selectDriver(parseEnv({ NODE_ENV: "development", DATABASE_URL: "" }))).toBe("pglite");
    expect(selectDriver(parseEnv({}))).toBe("pglite");
  });

  it("builds Neon on the WebSocket Pool driver (interactive transactions), without connecting", async () => {
    const { db, pool, close } = openNeonDb(PROD.DATABASE_URL);
    // The HTTP driver can't hold a transaction open for SELECT … FOR UPDATE; the Pool can.
    expect(pool).toBeInstanceOf(Pool);
    expect((db as unknown as { $client: unknown }).$client).toBe(pool);
    expect((db as unknown as { session: object }).session.constructor.name).toBe("NeonSession");
    expect(pool.totalCount).toBe(0); // lazy: nothing opened yet, so no network in tests
    await close();
  });
});
