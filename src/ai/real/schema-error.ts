/**
 * Recognising "the API won't compile our output schema" (ai.md §1, structured outputs). The API
 * rejects a schema that is too complex with a 400 `invalid_request_error`. The docs (claude-api
 * skill → structured-outputs page, checked 2026-10-19) name an explicit-limit error per limit
 * (strict tools, optional parameters, parameters with union types) and "Schema is too complex for
 * compilation" for the internal grammar-size limit; production on 2026-10-19 returned "The
 * compiled grammar is too large, which would cause performance issues. Simplify your tool schemas
 * or reduce the number of strict tools." There is no error code for these, so the message is the
 * signal. Matching is deliberately loose: a false match only costs one retry without the format,
 * and the answer is still validated by Zod.
 */
import Anthropic from "@anthropic-ai/sdk";

const SCHEMA_TOO_COMPLEX = /grammar|too complex|parameters with union|optional parameters|strict tools/i;

interface ErrorBody {
  error?: { message?: unknown };
}

/** True when the error is a 400 saying the output schema is too large or complex to compile. */
export function isSchemaTooComplex(error: unknown): boolean {
  if (!(error instanceof Anthropic.APIError) || error instanceof Anthropic.APIConnectionError) return false;
  if (error.status !== 400) return false;
  const inner = (error.error as ErrorBody | undefined)?.error?.message;
  return SCHEMA_TOO_COMPLEX.test(typeof inner === "string" ? inner : error.message);
}

/**
 * Pulls the JSON object out of a reply written without structured outputs: tolerates code fences
 * or a stray sentence around it. With structured outputs the text is already bare JSON.
 */
export function jsonText(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}
