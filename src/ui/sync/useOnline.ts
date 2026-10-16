"use client";
/**
 * Whether the phone has a connection (`navigator.onLine`, kept fresh by the online/offline
 * events). Chat is online only (0044), and so are the item buttons until offline buttons (KOS7)
 * are built. The server render assumes online.
 */
import { useSyncExternalStore } from "react";

export function useOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("online", onChange);
      window.addEventListener("offline", onChange);
      return () => {
        window.removeEventListener("online", onChange);
        window.removeEventListener("offline", onChange);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}
