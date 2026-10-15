"use client";
/**
 * Place memory (Kitchen OS shell, 0042). On the old one-screen home every widget stayed mounted,
 * so an in-place result with Undo ("Added 3 to your kitchen · Undo", "Hoisin removed · Undo")
 * stayed where it was. Places are routes now and unmount when you leave, so a place keeps such
 * lines here instead: `usePlaceMemory` works like `useState`, but its value survives moving
 * between places (not a reload). Undo stays beside the change until your next message, as before.
 * Domain-free: keys are the place's own strings; the shell never looks inside (0004).
 * Without the provider (component tests), it is plain `useState`.
 */
import { createContext, useCallback, useContext, useState, type ReactNode, type SetStateAction } from "react";

const Ctx = createContext<Map<string, unknown> | null>(null);

export function PlaceMemoryProvider({ children }: { children: ReactNode }) {
  const [memory] = useState(() => new Map<string, unknown>());
  return <Ctx.Provider value={memory}>{children}</Ctx.Provider>;
}

export function usePlaceMemory<T>(key: string, initial: T): readonly [T, (next: SetStateAction<T>) => void] {
  const memory = useContext(Ctx);
  const [value, setValue] = useState<T>(() => (memory?.has(key) ? (memory.get(key) as T) : initial));
  const set = useCallback(
    (next: SetStateAction<T>) =>
      setValue((prev) => {
        const v = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        memory?.set(key, v);
        return v;
      }),
    [memory, key],
  );
  return [value, set] as const;
}
