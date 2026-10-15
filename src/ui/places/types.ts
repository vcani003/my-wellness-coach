/**
 * What a place tells the shell about itself (Kitchen OS layout, 0042; decision 0004). The shell
 * knows nothing about food: it only reads these. A future assistant's place (Fitness) is one new
 * folder that exports a `PlaceDef`, plus one line in `registry.ts`; no Kitchen file changes.
 */
import type { ComponentType } from "react";
import type { ChangeRef } from "@/contracts/apply-result";
import type { IconComponent } from "@/ui/primitives/icons";

export interface PlaceProps {
  /** Ask the data layer to try again (used by the error state's Retry). */
  onRetry: () => void;
}

export interface PlaceDef {
  /** e.g. "kitchen" */
  id: string;
  /** Its route under `(main)`: "/kitchen". */
  href: string;
  /** Translation key of the short dock label ("List"). */
  labelKey: string;
  /** Translation key of the place's title: the header's h1 and the region's accessible name. */
  titleKey: string;
  /** Decorative dock icon. */
  Icon: IconComponent;
  /** Paths that belong to this place, so the dock marks it (the Recipe belongs to Meals). */
  owns(pathname: string): boolean;
  /**
   * Does this saved change show here? (item → Kitchen). Used for the "Kitchen updated · Show" cue
   * when your change concerns a place you're not looking at (0035 f: the page stays put).
   */
  wantsFocus(ref: ChangeRef): boolean;
  /** IDs the domain's screens use to name themselves (`focusWidget`, `touched`), mapped here. */
  hosts?: readonly string[];
  /** The place's screen. */
  Component: ComponentType<PlaceProps>;
  /** An optional card the place adds to Today (each in its own error boundary). */
  TodayCard?: ComponentType;
}
