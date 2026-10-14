/**
 * Streaming parts out of a structured-output answer while it's still being written. The JSON
 * arrives as text; we parse the prefix with the SDK's tolerant parser and hand out an array
 * element only once it's complete (a later element or the next key has started). The final,
 * validated answer is always authoritative: anything not streamed is sent from it at the end.
 *
 * Technical call: reuse the parser the SDK ships (exported as `_vendor/partial-json-parser`)
 * rather than hand-roll one. If a future SDK drops it, only `parsePrefix` changes.
 */
import { partialParse } from "@anthropic-ai/sdk/_vendor/partial-json-parser/parser";

export function parsePrefix(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null;
  try {
    const v = partialParse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Complete elements of `obj[key]`, given the key that follows it in the schema. */
export function completeElements(obj: Record<string, unknown>, key: string, nextKey: string): unknown[] {
  const arr = obj[key];
  if (!Array.isArray(arr)) return [];
  return nextKey in obj ? arr : arr.slice(0, -1);
}
