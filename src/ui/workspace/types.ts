/**
 * What a widget tells the workspace about itself (frontend.md §2, decision 0004). The workspace
 * knows nothing about food: it only calls these.
 */
import type { ComponentType } from "react";
import type { ChangeRef } from "@/contracts/apply-result";
import type { KitchenState } from "@/contracts/kitchen-state";

export type Layout = "phone" | "desktop";

export interface WidgetProps {
  /** Ask the data layer to try again (used by the error state's Retry). */
  onRetry: () => void;
}

export interface WidgetDef {
  /** e.g. "kitchen.items" */
  id: string;
  /** e.g. "kitchen" */
  domain: string;
  /** `lasting` widgets stay once they have content; `session` ones can be closed (0013). */
  lifetime: "lasting" | "session";
  /** Translation key of the widget's title (also the region's accessible name). */
  titleKey: string;
  /** Has content to show? */
  isPresent(state: KitchenState | null): boolean;
  /** Does this saved change concern me? (item change → Kitchen) */
  wantsFocus(ref: ChangeRef): boolean;
  /** Short summary for the header / collapsed bar ("4 items"). */
  Summary?: ComponentType;
  Component: ComponentType<WidgetProps>;
}
