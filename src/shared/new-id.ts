/**
 * A random v4 UUID, in the browser and on the server.
 *
 * `crypto.randomUUID` only exists in secure contexts (https, localhost). A phone opening the local
 * preview by the Mac's Wi-Fi address (plain http) has `crypto.getRandomValues` but not
 * `randomUUID`, so calling it directly threw and every tap that needed an ID did nothing.
 */
export function newId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
