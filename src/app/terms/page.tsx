import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n";
import { PolicyPage } from "@/ui/settings/PolicyPage";

export const metadata: Metadata = { title: getMessages().policy.terms.pageTitle };

/** `/terms` (0015): placeholder policy text, linked from Settings. */
export default function TermsPage() {
  return <PolicyPage which="terms" />;
}
