"use client";
/** Accessible menu (Base UI), wrapped so swapping the library touches only this folder (frontend.md §9). */
import type { ComponentProps } from "react";
import { Menu as Base } from "@base-ui/react/menu";

/**
 * A menu's popup pops in from its button and fades out, taking no taps while closing (globals.css
 * .pop-motion, 0059 PF13): menus are anchored to a button, so they pop rather than slide.
 */
function Popup({ className = "", ...props }: Omit<ComponentProps<typeof Base.Popup>, "className"> & { className?: string }) {
  return <Base.Popup {...props} className={`pop-motion ${className}`} />;
}

export const Menu = {
  Root: Base.Root,
  Trigger: Base.Trigger,
  Portal: Base.Portal,
  Positioner: Base.Positioner,
  Popup,
  Item: Base.Item,
  RadioGroup: Base.RadioGroup,
  RadioItem: Base.RadioItem,
  RadioItemIndicator: Base.RadioItemIndicator,
};
