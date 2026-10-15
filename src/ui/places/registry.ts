/**
 * The places registry: the one seam between the shell and the assistants' screens (0004). The
 * order here is the dock's order (Kitchen OS: Today, Kitchen, Plan, Meals, List). A future place
 * (Fitness) is one new folder under src/ui/ plus one line here.
 */
import { kitchenPlace } from "@/ui/widgets/kitchen";
import { mealsPlace, planPlace } from "@/ui/widgets/meals";
import { listPlace } from "@/ui/widgets/shopping";
import { todayPlace } from "./today";
import type { PlaceDef } from "./types";

export const places: readonly PlaceDef[] = [todayPlace, kitchenPlace, planPlace, mealsPlace, listPlace];

export const TODAY_PLACE_ID = todayPlace.id;
