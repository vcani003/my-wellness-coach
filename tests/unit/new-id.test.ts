import { afterEach, describe, expect, it, vi } from "vitest";
import { newId } from "@/shared/new-id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newId", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses crypto.randomUUID where it exists", () => {
    expect(newId()).toMatch(UUID);
  });

  it("still makes a v4 UUID on plain http, where randomUUID is missing (a phone on the preview's Wi-Fi address)", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: real.getRandomValues.bind(real) });
    const ids = new Set(Array.from({ length: 50 }, () => newId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(UUID);
  });
});
