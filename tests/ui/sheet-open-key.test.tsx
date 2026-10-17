// @vitest-environment jsdom
/**
 * A sheet's body key changes only when it opens (0059 PF13): a key that also changed on close
 * remounted the popup already closed, which skipped its exit motion.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useOpenKey } from "@/ui/primitives/Dialog";

describe("useOpenKey", () => {
  it("changes on each open, never on close", () => {
    const { result, rerender } = renderHook(({ open }) => useOpenKey(open), { initialProps: { open: false } });
    const closed = result.current;
    rerender({ open: true });
    const first = result.current;
    expect(first).not.toBe(closed);
    rerender({ open: false });
    expect(result.current).toBe(first);
    rerender({ open: true });
    expect(result.current).not.toBe(first);
  });

  it("an already-open sheet keeps its key across renders", () => {
    const { result, rerender } = renderHook(({ open }) => useOpenKey(open), { initialProps: { open: true } });
    const key = result.current;
    rerender({ open: true });
    expect(result.current).toBe(key);
  });
});
