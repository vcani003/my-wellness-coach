import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n";
import { UnlockForm } from "./unlock-form";

export const metadata: Metadata = { title: getMessages().unlock.pageTitle };

/** Interim access-code page (backend-data.md §7) until email sign-in (0017). */
export default function UnlockPage() {
  return (
    <main className="unlock-page">
      <UnlockForm />
    </main>
  );
}
