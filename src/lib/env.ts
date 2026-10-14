/**
 * Environment validation (backend-data.md §2, §10). Checked on first use and at server start
 * (`src/instrumentation.ts`); a bad value fails loudly at startup rather than halfway through a
 * request. Error messages name the variable and the problem, never the value: values may be
 * secrets. Server code only: never import from UI code.
 */
import { z } from "zod";
import { parseAccessCodes } from "./auth/access-codes";

const optionalText = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

/** An empty value (`NAME=` in a copied .env.example) means "not set", so the default applies. */
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const EnvSchema = z
  .object({
    NODE_ENV: z.preprocess(blankToUndefined, z.enum(["development", "test", "production"]).default("development")),
    /** Local embedded Postgres folder. Used only when `DATABASE_URL` is empty. */
    PGLITE_DIR: z.preprocess(blankToUndefined, z.string().default(".data/pglite")),
    /** Neon connection string. Set = Neon (production); empty = local PGlite. */
    DATABASE_URL: optionalText.pipe(z.url({ error: "must be a postgres:// connection URL" }).optional()),
    /** Signs the session cookie (interim access-code gate). At least 32 characters. */
    SESSION_SECRET: optionalText.pipe(z.string().min(32, { error: "must be at least 32 characters" }).optional()),
    /** `vero=<code>,levi=<code>`: each code unlocks that user (interim gate). */
    ACCESS_CODES: optionalText,
    /** `fake` = fixed answers, no AI calls (default); `real` = Claude via ANTHROPIC_API_KEY. */
    AI_MODE: z.preprocess(blankToUndefined, z.enum(["fake", "real"], { error: "must be fake or real" }).default("fake")),
    ANTHROPIC_API_KEY: optionalText,
    /** Dev-only "acting as" switch: a user ID. The server refuses to start in production with it set. */
    DEV_ACTING_AS: optionalText,
  })
  .superRefine((e, ctx) => {
    const fail = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (e.ACCESS_CODES) {
      try {
        parseAccessCodes(e.ACCESS_CODES);
      } catch (err) {
        fail("ACCESS_CODES", (err as Error).message);
      }
    }
    if (e.AI_MODE === "real" && !e.ANTHROPIC_API_KEY) fail("ANTHROPIC_API_KEY", "required when AI_MODE=real");
    if (e.NODE_ENV === "production") {
      if (!e.DATABASE_URL) fail("DATABASE_URL", "required in production");
      if (!e.SESSION_SECRET) fail("SESSION_SECRET", "required in production");
      if (!e.ACCESS_CODES) fail("ACCESS_CODES", "required in production");
      if (e.DEV_ACTING_AS) fail("DEV_ACTING_AS", "the dev-only acting-as switch must not be set in production");
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/** Parse an environment object. Exported for tests. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    // Names and our own reasons only, never values.
    const problems = result.error.issues.map((i) => `${i.path.join(".") || "(root)"} (${i.message})`).join("; ");
    throw new Error(`Invalid environment variables: ${problems}`);
  }
  return result.data;
}

let cached: Env | undefined;

export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** True when the dev-only "acting as" switch is on. Never true in production (parseEnv refuses). */
export function devActingAsEnabled(e: Env): boolean {
  return e.NODE_ENV !== "production" && Boolean(e.DEV_ACTING_AS);
}
