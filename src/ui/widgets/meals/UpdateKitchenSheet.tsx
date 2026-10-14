"use client";
/**
 * "Update your kitchen" after cooking (ux.md §5, decision 0013, M8): a bottom sheet on a phone, a
 * centred dialog on desktop. "Cooked: <meal>", then each in-kitchen ingredient with **Still have
 * some** (the default) / **Running low** / **Out**, and an optional note. The meal is already done
 * either way.
 * - **Done** saves the Running low / Out choices and the note in one change set (one Undo).
 * - **Do later** puts it in the Kitchen's To review (from a To review card it just closes).
 *   Esc, swipe-down and tapping outside count as Do later, so nothing is lost.
 * - **Skip** changes nothing more (from a To review card it closes the card).
 */
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { useAnnounce } from "@/ui/a11y/Announcer";
import { sentenceCase } from "@/ui/fallbacks";
import { Dialog } from "@/ui/primitives/Dialog";
import { KITCHEN_WIDGET_ID } from "@/ui/widgets/kitchen";
import { ChoiceRadio } from "@/ui/primitives/RadioGroup";
import { useKitchenData } from "@/ui/sync/KitchenDataContext";
import { useMeals, type AfterCookingStock } from "./MealsContext";
import type { UpdateKitchenRequest } from "./session";

export function UpdateKitchenSheet() {
  const { session, dispatch } = useMeals();
  const request = session.updateKitchen;
  // Keep the last request while the sheet animates closed.
  const [shown, setShown] = useState<UpdateKitchenRequest | null>(request);
  // Focus goes back to what opened the sheet; if that's gone (Done cooking, a To review card that
  // just closed), to the workspace, so it's never lost (ux.md §5).
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  if (request && request !== shown) {
    setShown(request);
    // Read while the opener still has focus (before the dialog takes it).
    setOpener(typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  }
  const dismissRef = useRef<() => void>(() => dispatch({ type: "closeUpdateKitchen" }));
  const finalFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!request) {
      finalFocus.current = opener?.isConnected && !opener.closest("[hidden]") ? opener : document.getElementById("workspace");
    }
  }, [request, opener]);
  return (
    <Dialog.Root open={Boolean(request)} onOpenChange={(open) => !open && dismissRef.current()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-text-default/30" />
        {shown && <SheetBody key={`${shown.mealId}:${shown.reviewId ?? ""}`} request={shown} dismissRef={dismissRef} finalFocus={finalFocus} />}
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type Failure = "done" | "later" | "skip";

function SheetBody({
  request,
  dismissRef,
  finalFocus,
}: {
  request: UpdateKitchenRequest;
  dismissRef: RefObject<() => void>;
  finalFocus?: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("meals.update");
  const locale = useLocale();
  const announce = useAnnounce();
  const { actions, dispatch, setNotice } = useMeals();
  const { turn = 0 } = useKitchenData();
  const [choices, setChoices] = useState<Record<string, AfterCookingStock>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<Failure | null>(null);
  const errorId = useId();
  const noteId = useId();
  const fromReview = request.reviewId;

  const close = () => dispatch({ type: "closeUpdateKitchen" });
  const say = (text: string, undo?: { changeSetId: string; label: string }) => {
    setNotice({ text, ...(undo ? { undo } : {}), turn });
    announce(text);
  };

  /** Run a step; close when it saved, else keep the sheet open with a plain error. */
  const run = async (kind: Failure, step: () => Promise<boolean>) => {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    let ok = false;
    try {
      ok = await step();
    } catch {
      ok = false;
    }
    setBusy(false);
    if (ok) close();
    else setFailed(kind);
  };

  const done = () =>
    run("done", async () => {
      const items = request.items.map((i) => ({ itemId: i.itemId, stock: choices[i.itemId] ?? "have" }));
      const trimmed = note.trim();
      const changes = items.filter((i) => i.stock !== "have");
      if (!changes.length && !trimmed && !fromReview) {
        say(t("nothingChanged"));
        return true;
      }
      const res = await actions.submitUpdateKitchen({
        mealId: request.mealId,
        items,
        ...(trimmed ? { note: trimmed } : {}),
        ...(fromReview ? { reviewId: fromReview } : {}),
      });
      if (!res.ok || !res.result.applied.length) return false;
      actions.showSaved(res.result, { focus: KITCHEN_WIDGET_ID });
      const low = changes.filter((c) => c.stock === "low").length;
      const out = changes.filter((c) => c.stock === "out").length;
      const parts = [...(low ? [t("changesLow", { count: low })] : []), ...(out ? [t("changesOut", { count: out })] : [])];
      const text = parts.length
        ? t("saved", { title: request.title, changes: new Intl.ListFormat(locale, { type: "conjunction" }).format(parts) })
        : t("savedNoteOnly", { title: request.title });
      say(text, {
        changeSetId: res.result.changeSetId,
        label: t("undoLabel", { title: request.title }),
      });
      return true;
    });

  const later = () => {
    if (busy) return;
    if (fromReview) return close(); // it's still in To review
    return run("later", async () => {
      const res = await actions.updateKitchenLater({ mealId: request.mealId, items: request.items });
      if (!res.ok || !res.result.applied.length) return false;
      actions.showSaved(res.result);
      say(t("savedForLater"));
      return true;
    });
  };

  const skip = () => {
    if (!fromReview) {
      say(t("skipped"));
      return close();
    }
    return run("skip", async () => {
      const res = await actions.skipUpdateKitchen(fromReview);
      if (!res.ok || !res.result.applied.length) return false;
      actions.showSaved(res.result);
      say(t("skipped"));
      return true;
    });
  };

  useEffect(() => {
    dismissRef.current = () => void later();
  });

  const options = [
    { value: "have", label: t("have") },
    { value: "low", label: t("low") },
    { value: "out", label: t("out") },
  ];

  return (
    <Dialog.Popup
      finalFocus={finalFocus}
      aria-describedby={failed ? errorId : undefined}
      className="sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col gap-3 rounded-t-lg bg-surface-raised px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-dock desk:inset-x-auto desk:top-1/2 desk:bottom-auto desk:left-1/2 desk:w-[30rem] desk:-translate-x-1/2 desk:-translate-y-1/2 desk:rounded-lg"
    >
      <div>
        <Dialog.Title className="text-title font-strong">{t("title")}</Dialog.Title>
        <Dialog.Description className="text-small text-text-muted">{t("cooked", { title: request.title })}</Dialog.Description>
      </div>
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        {request.items.map((i) => (
          <ChoiceRadio
            key={i.itemId}
            label={sentenceCase(i.name.trim(), locale) || t("unknownItem")}
            value={choices[i.itemId] ?? "have"}
            options={options}
            disabled={busy}
            onChange={(v) => setChoices((c) => ({ ...c, [i.itemId]: v as AfterCookingStock }))}
          />
        ))}
        <div className="flex flex-col gap-1">
          <label htmlFor={noteId} className="text-body font-medium">
            {t("noteLabel")} <span className="font-regular text-text-muted">{t("optional")}</span>
          </label>
          <textarea
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            rows={2}
            disabled={busy}
            className="rounded-sm border border-border-strong bg-surface-raised px-3 py-2 text-body"
          />
        </div>
      </div>
      {failed && (
        <p id={errorId} role="alert" className="rounded-sm bg-error-bg px-3 py-2 text-small text-error-text">
          {t(failed === "done" ? "doneFailed" : failed === "later" ? "laterFailed" : "skipFailed")}
        </p>
      )}
      <button
        type="button"
        onClick={() => void done()}
        disabled={busy}
        className="min-h-tap w-full rounded-button bg-accent-default px-5 text-body font-strong text-text-inverse disabled:opacity-60"
      >
        {busy ? t("saving") : t("done")}
      </button>
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => void later()} disabled={busy} className="min-h-tap rounded-button px-3 text-body font-medium text-accent-text">
          {t("doLater")}
        </button>
        <button type="button" onClick={() => void skip()} disabled={busy} className="min-h-tap rounded-button px-3 text-body font-medium text-accent-text">
          {t("skip")}
        </button>
      </div>
    </Dialog.Popup>
  );
}
