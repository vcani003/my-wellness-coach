/**
 * Environment validation (backend-data.md §2). Checked on first use; a bad value fails loudly
 * at startup rather than halfway through a request. Server code only: never import from UI code.
 */
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Local embedded Postgres folder. */
  PGLITE_DIR: z.string().min(1).default(".data/pglite"),
  /** Reserved for Neon (S2). Empty = use local PGlite. */
  DATABASE_URL: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v : undefined))
    .pipe(z.url().optional()),
});

export type Env = z.infer<typeof EnvSchema>;

/** Parse an environment object. Exported for tests. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const fields = result.error.issues.map((i) => i.path.join(".") || "(root)").join(", ");
    // Names only, never values: they may be secrets.
    throw new Error(`Invalid environment variables: ${fields}`);
  }
  return result.data;
}

let cached: Env | undefined;

export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
