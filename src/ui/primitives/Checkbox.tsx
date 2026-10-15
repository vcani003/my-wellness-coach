"use client";
/**
 * A round "got it" check (Kitchen OS list box, cream colours). A real native checkbox sits on top,
 * invisible, so it keeps its role, name, keyboard and form behaviour; the drawn box shows the state
 * with a tick shape as well as colour (WCAG 1.4.1), and the focus ring appears on the box. The
 * browser's own tick colour isn't used, so it reads the same in both themes (visual-direction §6).
 */
import type { InputHTMLAttributes } from "react";
import { CheckIcon } from "./icons";

export function Checkbox({ className = "", ...input }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <span className={`check-box ${className}`}>
      <CheckIcon aria-hidden="true" weight="bold" className="check-mark pointer-events-none size-icon-sm" />
      {/* Last, so it sits on top and takes the tap; the drawn tick never catches the pointer. */}
      <input type="checkbox" {...input} className="absolute inset-0 m-0 cursor-pointer opacity-0 disabled:cursor-default" />
    </span>
  );
}
