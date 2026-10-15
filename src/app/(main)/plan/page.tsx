/** `/plan`: the meal plan, in order (0008: no dates yet). Drawn from the kitchen the layout loaded. */
import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n";
import { Place } from "@/ui/places/Place";

export const metadata: Metadata = { title: getMessages().places.pageTitle.plan };

export default function PlanPage() {
  return <Place id="plan" />;
}
