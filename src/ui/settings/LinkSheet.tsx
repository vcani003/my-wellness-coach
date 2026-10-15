"use client";
/**
 * Settings → Kitchen: the sheet that shows a new sign-in link (SU1 Rec): a **sign-in setup link**
 * for a member who has no passphrase yet (a reset link, so they keep their account), a
 * **passphrase reset link**, or an **invite** for someone new (a join link).
 *
 * - The link is made when the sheet opens and lives only in this sheet's state: nothing is stored
 *   on the phone, and closing the sheet forgets it (the server can't show it again either).
 * - **Copy** (Clipboard API; if that's refused, it says to press and hold the link) and the
 *   system **Share** sheet where the Web Share API exists. "Valid for 24 hours, works once."
 * - Base UI Dialog: bottom sheet on a phone, centred on desktop; focus trapped; Esc closes; focus
 *   goes back to the button that opened it. Focus starts on Done, then moves to Copy once the
 *   link is ready. Failures say so plainly with Try again (0018).
 */
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CreateLinkResult } from "@/lib/auth/invites";
import { Dialog } from "@/ui/primitives/Dialog";
import { SpinnerIcon } from "@/ui/primitives/icons";

export interface LinkSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  body: string;
  /** Makes the link (a server action). */
  create(): Promise<CreateLinkResult>;
}

export function LinkSheet(props: LinkSheetProps) {
  return (
    <Dialog.Root open={props.open} onOpenChange={(open) => props.onOpenChange(open)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-scrim" />
        {/* Always rendered (Base UI needs its Popup to finish closing, or the backdrop stays and
            blocks the page); a new key on each open gives a fresh, empty sheet. */}
        <SheetBody key={props.open ? "open" : "closed"} {...props} />
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type State = { status: "making" } | { status: "ready"; url: string } | { status: "failed"; key: string };

const ERROR_KEYS = new Set(["full", "tooMany", "notAllowed"]);

function SheetBody({ open, onOpenChange, title, body, create }: LinkSheetProps) {
  const t = useTranslations("settings.kitchen.sheet");
  const [state, setState] = useState<State>({ status: "making" });
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const doneRef = useRef<HTMLButtonElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const make = useCallback(async () => {
    setState({ status: "making" });
    let res: CreateLinkResult;
    try {
      res = await create();
    } catch {
      res = { ok: false, error: { key: "failed" } };
    }
    if (res.ok) {
      setState({ status: "ready", url: new URL(res.path, window.location.origin).toString() });
      requestAnimationFrame(() => copyRef.current?.focus());
    } else {
      setState({ status: "failed", key: ERROR_KEYS.has(res.error.key) ? res.error.key : "failed" });
    }
  }, [create]);

  // Once per opening (a fresh body mounts each time the sheet opens).
  const started = useRef(false);
  useEffect(() => {
    if (!open || started.current) return;
    started.current = true;
    void make();
  }, [open, make]);

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  };

  const share = async (url: string) => {
    try {
      await navigator.share({ title, text: t("shareText"), url });
    } catch {
      // Cancelled, or not allowed: the link is still on screen with Copy.
    }
  };

  return (
    <Dialog.Popup
      initialFocus={doneRef}
      className="sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col gap-3 overflow-y-auto rounded-t-sheet bg-surface-raised px-5 pt-5 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-pop desk:inset-x-auto desk:top-1/2 desk:bottom-auto desk:left-1/2 desk:w-[30rem] desk:-translate-x-1/2 desk:-translate-y-1/2 desk:rounded-sheet"
    >
      <Dialog.Title className="font-heading text-title font-medium">{title}</Dialog.Title>
      <Dialog.Description className="text-body">{body}</Dialog.Description>

      {state.status === "making" && (
        <p role="status" className="flex items-center gap-2 text-body text-text-muted">
          <SpinnerIcon aria-hidden="true" className="size-icon motion-safe:animate-spin" />
          {t("making")}
        </p>
      )}

      {state.status === "ready" && (
        <>
          <div className="flex flex-col gap-1">
            <p id="link-sheet-label" className="text-caption font-strong text-text-muted">
              {t("linkLabel")}
            </p>
            <p
              aria-labelledby="link-sheet-label"
              data-testid="invite-link"
              className="rounded-md bg-surface-sunken px-3 py-2 text-small break-all select-all"
            >
              {state.url}
            </p>
            <p id="link-sheet-validity" className="text-small font-medium">
              {t("validity")}
            </p>
            <p className="text-small text-text-muted">{t("private")}</p>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <button
                ref={copyRef}
                type="button"
                onClick={() => void copyLink(state.url)}
                aria-describedby="link-sheet-validity"
                className="btn btn-primary flex-1"
              >
                {t("copy")}
              </button>
              {canShare && (
                <button
                  type="button"
                  onClick={() => void share(state.url)}
                  className="btn flex-1"
                >
                  {t("share")}
                </button>
              )}
            </div>
            {/* Always in the sheet while the link shows, so "Copied." is announced. */}
            <p role="status" className={`text-small empty:-mt-2 ${copy === "failed" ? "text-error-text" : "text-success-text"}`}>
              {copy === "copied" ? t("copied") : copy === "failed" ? t("copyFailed") : ""}
            </p>
          </div>
        </>
      )}

      {state.status === "failed" && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md bg-error-bg px-3 py-2 text-small text-error-text">
          <span>{t(`errors.${state.key}`)}</span>
          {state.key !== "full" && state.key !== "notAllowed" && (
            <button type="button" onClick={() => void make()} className="min-h-tap rounded-button px-3 font-medium text-accent-text underline">
              {t("retry")}
            </button>
          )}
        </div>
      )}

      <button
        ref={doneRef}
        type="button"
        onClick={() => onOpenChange(false)}
        className="btn w-full"
      >
        {t("done")}
      </button>
    </Dialog.Popup>
  );
}
