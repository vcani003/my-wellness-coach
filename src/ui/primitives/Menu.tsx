"use client";
/** Accessible menu (Base UI), wrapped so swapping the library touches only this folder (frontend.md §9). */
import { Menu as Base } from "@base-ui/react/menu";

export const Menu = {
  Root: Base.Root,
  Trigger: Base.Trigger,
  Portal: Base.Portal,
  Positioner: Base.Positioner,
  Popup: Base.Popup,
  Item: Base.Item,
  RadioGroup: Base.RadioGroup,
  RadioItem: Base.RadioItem,
  RadioItemIndicator: Base.RadioItemIndicator,
};
