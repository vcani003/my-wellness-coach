/** `/list`: the shared shopping list, by store (0027). Drawn from the kitchen the layout loaded. */
import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n";
import { Place } from "@/ui/places/Place";

export const metadata: Metadata = { title: getMessages().places.pageTitle.list };

export default function ListPage() {
  return <Place id="list" />;
}
