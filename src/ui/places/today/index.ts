/**
 * Today (Kitchen OS home, `/`): Lumi's greeting, the allergy confirmations banner, and a card from
 * each place that has one (the Kitchen's shared cues, To review and Use it up). It owns no data.
 */
import { TodayIcon } from "@/ui/primitives/icons";
import type { PlaceDef } from "../types";
import { TodayPlace } from "./TodayPlace";

export const todayPlace: PlaceDef = {
  id: "today",
  href: "/",
  labelKey: "places.today",
  titleKey: "today.title",
  Icon: TodayIcon,
  owns: (path) => path === "/",
  // Today summarises; a change always belongs to the place that holds it.
  wantsFocus: () => false,
  Component: TodayPlace,
};
