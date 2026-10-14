"use client";
/**
 * Accessible dialog (Base UI): traps focus, Esc closes, focus returns to the opener. Used for the
 * sheets (ux.md §5). Wrapped so swapping the library touches only this folder (frontend.md §9).
 */
import { Dialog as Base } from "@base-ui/react/dialog";

export const Dialog = {
  Root: Base.Root,
  Portal: Base.Portal,
  Backdrop: Base.Backdrop,
  Popup: Base.Popup,
  Title: Base.Title,
  Description: Base.Description,
};
