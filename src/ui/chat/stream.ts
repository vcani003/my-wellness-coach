/**
 * Reads the turn stream (NDJSON: one JSON event per line, backend-data.md §6). Each line is
 * checked with the shared Zod schema; a line that fails is dropped and logged, never thrown
 * (0018).
 */
import { StreamEvent } from "@/contracts/stream";

export async function* readTurnStream(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        const event = parseLine(line);
        if (event) yield event;
      }
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

export function parseLine(line: string): StreamEvent | null {
  if (!line.trim()) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    console.warn("chat.stream: dropped a line that isn't JSON");
    return null;
  }
  const parsed = StreamEvent.safeParse(raw);
  if (!parsed.success) {
    console.warn("chat.stream: dropped an event that failed its schema", { issues: parsed.error.issues });
    return null;
  }
  return parsed.data;
}
