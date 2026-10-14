"use client";
/**
 * Accessible expand/collapse (Base UI). Wrapped here so swapping the primitives library touches
 * only `src/ui/primitives/` (frontend.md §9).
 */
import { Collapsible as Base } from "@base-ui/react/collapsible";

export const Collapsible = {
  Root: Base.Root,
  Trigger: Base.Trigger,
  Panel: Base.Panel,
};
