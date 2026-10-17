"use client";
/**
 * Accessible dialog (Base UI): traps focus, Esc closes, focus returns to the opener. Used for the
 * sheets (ux.md §5). Wrapped so swapping the library touches only this folder (frontend.md §9).
 */
import { useState, type ComponentProps } from "react";
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

type WithClass<T> = Omit<T, "className"> & { className?: string };

/**
 * A bottom sheet's scrim: fades in and out with its sheet and takes no taps while closing
 * (globals.css .scrim-motion, 0059 PF13). Every sheet uses this, so they all move alike.
 */
export function SheetBackdrop({ className = "", ...props }: WithClass<ComponentProps<typeof Base.Backdrop>>) {
  return <Base.Backdrop {...props} className={`scrim-motion fixed inset-0 z-40 bg-scrim ${className}`} />;
}

/**
 * A bottom sheet (phone) / centred dialog (desktop): white on the large soft shadow, rising on the
 * spring and dropping away, or popping in on a desktop (globals.css .sheet / .sheet-motion, 0059
 * PF11, PF13). The caller gives its place and size; never add `shadow-pop` (the motion owns the
 * shadow on a phone). Focus props (initialFocus, finalFocus) pass straight through.
 */
export function SheetPopup({ className = "", ...props }: WithClass<ComponentProps<typeof Base.Popup>>) {
  return <Base.Popup {...props} className={`sheet sheet-motion ${className}`} />;
}

/**
 * A key for a sheet's body that changes only when the sheet opens: a fresh body (empty form,
 * fresh pre-selection) each time it opens, but the same body while it closes, so its exit
 * transition plays and it doesn't blank as it leaves. (A key that also changed on close remounted
 * the popup already closed, which skipped the exit: 0059 PF13, sheet-motion.spec.ts.)
 */
export function useOpenKey(open: boolean): number {
  const [state, setState] = useState({ open, key: 0 });
  if (open !== state.open) setState({ open, key: open ? state.key + 1 : state.key });
  return open !== state.open && open ? state.key + 1 : state.key;
}

/** A confirm (role "alertdialog"): Esc and outside taps don't dismiss it by accident. Used for Remove (0030). */
export const AlertDialog = {
  Root: BaseAlert.Root,
  Portal: BaseAlert.Portal,
  Backdrop: BaseAlert.Backdrop,
  Popup: BaseAlert.Popup,
  Title: BaseAlert.Title,
  Description: BaseAlert.Description,
};
