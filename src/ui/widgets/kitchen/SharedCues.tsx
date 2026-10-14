"use client";
/**
 * The shared-kitchen lines at the top of the Kitchen widget (ux.md §6):
 * - **Since your last visit:** one calm, dismissible line ("Levi added milk and used up the
 *   eggs."), "and N more changes" past three, with See all for the full list.
 * - **While you're looking:** one quiet line when someone else used up or removed an item you
 *   could see ("Levi used up the eggs."). The app's one live region announces it; nothing here
 *   moves focus, reorders widgets or opens anything.
 */
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { CloseIcon } from "@/ui/primitives/icons";
import type { SharedCues as Cues } from "@/ui/sync/useSharedCues";
import { useCueWords } from "./cue-words";

export function SinceLastVisit({ cues, onDismissed }: { cues: Cues; onDismissed: () => void }) {
  const t = useTranslations("kitchen.since");
  const words = useCueWords();
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (!cues.since.length) return null;
  const { text, hidden } = words.summarize(cues.since);

  return (
    <section
      aria-label={t("title")}
      data-since-last-visit=""
      className="flex items-start gap-1 rounded-md bg-surface-sunken py-1 pl-3 text-small"
    >
      <div className="min-w-0 flex-1 py-2">
        <p>
          <span className="font-strong">{t("title")}:</span> {text}
          {hidden > 0 && (
            <>
              {" "}
              <button
                type="button"
                aria-expanded={open}
                aria-controls={listId}
                onClick={() => setOpen((o) => !o)}
                className="inline-flex min-h-tap items-center rounded-button font-medium text-accent-text underline"
              >
                {open ? t("hideAll") : t("seeAll")}
              </button>
            </>
          )}
        </p>
        {hidden > 0 && (
          <ul id={listId} hidden={!open} aria-label={t("listLabel")} className="mt-1 flex flex-col gap-1 text-text-muted">
            {cues.since.map((e, i) => (
              <li key={`${e.changeSetId}:${i}`}>{words.entry(e)}</li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        aria-label={t("dismiss")}
        onClick={() => {
          cues.dismissSince();
          onDismissed();
        }}
        className="flex size-tap shrink-0 items-center justify-center rounded-full text-text-muted"
      >
        <CloseIcon aria-hidden="true" className="size-icon-sm" />
      </button>
    </section>
  );
}

export function LiveRemovals({ cues }: { cues: Cues }) {
  const words = useCueWords();
  if (!cues.live.length) return null;
  return (
    <p data-live-removal="" className="px-3 text-small text-text-muted">
      {words.summarize(cues.live).text}
    </p>
  );
}
