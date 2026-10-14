/**
 * `/kitchen`: Kitchen "See all" (frontend.md §1; K1, 0017; CAT1), inside the main layout so the chat
 * dock stays. The kitchen is already loaded by the layout, so this page only draws it.
 */
import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n";
import { KitchenSeeAll } from "@/ui/widgets/kitchen/KitchenSeeAll";

export const metadata: Metadata = { title: getMessages().kitchen.seeAll.pageTitle };

export default function KitchenPage() {
  return <KitchenSeeAll />;
}
