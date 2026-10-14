/**
 * Per-task model settings (decision 0020): a server setting, never a user choice. The effort
 * can be overridden per task by env var without a code change. Switching model is Vero's call (C10).
 */
export type Effort = "low" | "medium" | "high";

export interface TaskSettings {
  model: string;
  effort: Effort;
  /** Hard cap on output tokens (thinking counts toward it). */
  maxTokens: number;
  /** Per-attempt timeout. */
  timeoutMs: number;
}

/** Claude Opus 5.5 list prices, USD per million tokens (claude-api skill, cached 2026-10-06). */
export const PRICES_PER_MTOK = { input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5 } as const;

const MODEL = "claude-opus-5-5";

function effortFrom(value: string | undefined, fallback: Effort): Effort {
  return value === "low" || value === "medium" || value === "high" ? value : fallback;
}

export function taskSettings(
  task: "interpret" | "reword",
  source: Record<string, string | undefined> = process.env,
): TaskSettings {
  if (task === "interpret") {
    // Medium is the design default (ai.md §7); `low` is the first thing to try if it's slow.
    return { model: MODEL, effort: effortFrom(source.AI_INTERPRET_EFFORT, "medium"), maxTokens: 8000, timeoutMs: 40_000 };
  }
  return { model: MODEL, effort: effortFrom(source.AI_REWORD_EFFORT, "low"), maxTokens: 1500, timeoutMs: 20_000 };
}

export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Estimated cost of one call, in USD, at Opus 5.5 list prices (a fallback model may differ). */
export function estimateCostUsd(u: UsageLike): number {
  const p = PRICES_PER_MTOK;
  const cost =
    (u.input_tokens * p.input +
      u.output_tokens * p.output +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead +
      (u.cache_creation_input_tokens ?? 0) * p.cacheWrite5m) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
