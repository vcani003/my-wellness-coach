/** The NDJSON turn-stream reader: split across chunks, bad lines dropped (0018). */
import { describe, expect, it, vi } from "vitest";
import { readTurnStream } from "@/ui/chat/stream";

function streamOf(chunks: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

describe("readTurnStream", () => {
  it("reassembles events split across chunks and drops lines that fail the schema", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const events = [];
    for await (const e of readTurnStream(
      streamOf([
        '{"type":"ack","turnId":"t","messageId":"m"}\n{"type":"te',
        'xt","delta":"Hi"}\nnot json\n{"type":"mystery"}\n',
        '{"type":"done","turnId":"t","assistantMessageId":"a"}',
      ]),
    )) {
      events.push(e.type);
    }
    expect(events).toEqual(["ack", "text", "done"]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
