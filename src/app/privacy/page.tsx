import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n";
import { PolicyPage } from "@/ui/settings/PolicyPage";

export const metadata: Metadata = { title: getMessages().policy.privacy.pageTitle };

/** `/privacy` (0015): placeholder policy text, linked from Settings. */
export default function PrivacyPage() {
  return <PolicyPage which="privacy" />;
}
