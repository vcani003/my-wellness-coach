/**
 * Recognising "the AI budget is used up" (decision 0020, N1). Only these errors get the calm
 * budget message; a temporary rate limit (429 with retry-after) or an overload (529) keeps the
 * normal "try again" fallback.
 *
 * What the API returns, per the Claude API docs (errors + rate limits pages, checked 2026-10-14
 * through the claude-api skill):
 * - Tier monthly spend cap: 429 `rate_limit_error` with `error.details.error_code`
 *   `"enforced_spend_limit_reached"` (and no retry-after). The error_code is the documented way to
 *   tell it apart from a real rate limit.
 * - A spend limit we set ourselves (org or workspace): 400 `invalid_request_error` whose message
 *   begins "You have reached your specified API usage limits" or "...specified workspace API usage
 *   limits". The docs give no error_code for this one, so the documented prefix is the signal.
 * - Billing / credits: 402 `billing_error`.
 */
import Anthropic from "@anthropic-ai/sdk";

export const BUDGET_EXHAUSTED_REPLY =
  "Kitchen's AI budget for this month is used up. It resets on the 1st. Your kitchen and list still work.";

export type BudgetReason = "tier_spend_cap" | "own_spend_limit" | "billing";

const SPEND_CAP_CODE = "enforced_spend_limit_reached";
const OWN_LIMIT_PREFIX = /^You have reached your specified (workspace )?API usage limits/;

interface ErrorBody {
  error?: { type?: unknown; message?: unknown; details?: { error_code?: unknown } | null };
}

/** Which budget limit this error means, or null when it's any other failure. */
export function budgetExhaustedReason(error: unknown): BudgetReason | null {
  if (!(error instanceof Anthropic.APIError) || error instanceof Anthropic.APIConnectionError) return null;
  const inner = (error.error as ErrorBody | undefined)?.error;
  if (error.status === 429 && inner?.details?.error_code === SPEND_CAP_CODE) return "tier_spend_cap";
  if (error.status === 400 && typeof inner?.message === "string" && OWN_LIMIT_PREFIX.test(inner.message)) {
    return "own_spend_limit";
  }
  if (error.status === 402 || error.type === "billing_error") return "billing";
  return null;
}
