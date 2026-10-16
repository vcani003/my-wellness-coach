"use client";
/**
 * Accessible dialog (Base UI): traps focus, Esc closes, focus returns to the opener. Used for the
 * sheets (ux.md §5). Wrapped so swapping the library touches only this folder (frontend.md §9).
 */
import { AlertDialog as BaseAlert } from "@base-ui/react/alert-dialog";
import { Dialog as Base } from "@base-ui/react/dialog";

export const Dialog = {
  Root: Base.Root,
  Portal: Base.Portal,
  Backdrop: Base.Backdrop,
  Popup: Base.Popup,
  Title: Base.Title,
  Description: Base.Description,
};

/** A confirm (role "alertdialog"): Esc and outside taps don't dismiss it by accident. Used for Remove (0030). */
export const AlertDialog = {
  Root: BaseAlert.Root,
  Portal: BaseAlert.Portal,
  Backdrop: BaseAlert.Backdrop,
  Popup: BaseAlert.Popup,
  Title: BaseAlert.Title,
  Description: BaseAlert.Description,
};
