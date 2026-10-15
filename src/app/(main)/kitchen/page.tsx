/**
 * `/kitchen`: the Kitchen place (K1, 0017; CAT1): By place / By type, search, batches, To review.
 * The kitchen is already loaded by the layout, so this page only draws it.
 */
import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n";
import { Place } from "@/ui/places/Place";

export const metadata: Metadata = { title: getMessages().kitchen.seeAll.pageTitle };

export default function KitchenPage() {
  return <Place id="kitchen" />;
}
