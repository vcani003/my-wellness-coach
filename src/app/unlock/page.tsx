import type { Metadata } from "next";
import { UnlockForm } from "./unlock-form";

export const metadata: Metadata = { title: "Unlock · Kitchen" };

/**
 * Interim access-code page (backend-data.md §7) until email sign-in (0017). Deliberately plain:
 * the Frontend restyles it.
 */
export default function UnlockPage() {
  return (
    <main>
      <h1>Kitchen</h1>
      <p>Enter your access code to continue. You&apos;ll stay signed in on this device.</p>
      <UnlockForm />
    </main>
  );
}
