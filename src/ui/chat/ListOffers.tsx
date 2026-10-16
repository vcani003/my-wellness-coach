"use client";
/**
 * The receipt's one-tap "Add fish sauce to my list" (SL3, 0054 SS4, 0055 KOS4-d): on EVERY Out or
 * Running-low receipt, chat and buttons alike. The backend puts the offer on the receipt as data
 * (`AppliedOp.listOffers`); this is the one place that draws it.
 * - Only an offer: nothing goes on the list until it's tapped.
 * - Shown while `isListOfferOpen` in the CURRENT kitchen, so it disappears once anyone puts it on
 *   the list (in chat, from Restock, or the other person) or the item is back in stock.
 * - A staple reads "Fish sauce is one of your staples · Add to my list", and the add goes under
 *   its usual store (SS5).
 * - After the tap: "Fish sauce is on your list." in place, and focus moves there (the button is
 *   gone). No separate Undo: the List has Remove. Failures say so in place (0018).
 * - Item buttons need a connection until KOS7 (0044), so it's off while offline.
 */
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { isListOfferOpen, type AppliedOp, type ListOffer } from "@/contracts/apply-result";
import { useAnnounce } from "@/ui/a11y/Announcer";
import { sentenceCase } from "@/ui/fallbacks";
import { useKitchenActions } from "@/ui/sync/KitchenActionsContext";
import { useKitchenData } from "@/ui/sync/KitchenDataContext";
import { useOnline } from "@/ui/sync/useOnline";

/** Every "Add X to my list" offer in a receipt, one per item. */
export function listOffersOf(applied: readonly AppliedOp[]): ListOffer[] {
  const seen = new Set<string>();
  return applied.flatMap((a) => a.listOffers ?? []).filter((o) => (seen.has(o.itemId) ? false : (seen.add(o.itemId), true)));
}

export function ListOffers({ offers }: { offers: ListOffer[] }) {
  return (
    <>
      {offers.map((offer) => (
        <ListOfferLine key={offer.itemId} offer={offer} />
      ))}
    </>
  );
}

type Phase = "idle" | "pending" | "added" | "failed";

function ListOfferLine({ offer }: { offer: ListOffer }) {
  const t = useTranslations("receipt.list");
  const announce = useAnnounce();
  const actions = useKitchenActions();
  const { snapshot } = useKitchenData();
  const online = useOnline();
  const [phase, setPhase] = useState<Phase>("idle");
  const resultRef = useRef<HTMLParagraphElement>(null);
  const focusResult = useRef(false);
  const name = offer.name;

  useEffect(() => {
    if (phase !== "added" || !focusResult.current) return;
    focusResult.current = false;
    resultRef.current?.focus();
  }, [phase]);

  if (phase === "added") {
    return (
      <p ref={resultRef} tabIndex={-1} data-list-offer={offer.itemId} data-list-offer-state="added" className="mt-2 text-small font-medium outline-none">
        {t("onList", { name: sentenceCase(name) })}
      </p>
    );
  }
  // Already on the list (anyone, anywhere) or back in stock: nothing to offer.
  if (!snapshot.state || !isListOfferOpen(offer, snapshot.state)) return null;

  const offline = !online || snapshot.status === "stale" || snapshot.status === "error";
  const pending = phase === "pending";
  const add = async () => {
    if (pending || offline) return;
    setPhase("pending");
    try {
      const res = await actions.addToList("stock-offer", [{ name, ...(offer.store ? { store: offer.store } : {}) }]);
      if (res.ok && res.result.applied.length) {
        actions.showOwn(res.result);
        focusResult.current = true;
        setPhase("added");
        announce(t("onList", { name: sentenceCase(name) }));
        return;
      }
    } catch {
      // fall through: say so in place
    }
    setPhase("failed");
    announce(t("failed"));
  };

  const label = t("addLabel", { name });
  return (
    <div data-list-offer={offer.itemId} className="mt-2 flex flex-wrap items-center gap-2">
      {offer.stapleId && <span className="text-small">{t("staple", { name: sentenceCase(name) })}</span>}{" "}
      <button
        type="button"
        onClick={() => void add()}
        disabled={offline}
        aria-disabled={pending || undefined}
        aria-label={offer.stapleId ? label : undefined}
        className="btn btn-small"
      >
        {pending ? t("adding") : offer.stapleId ? t("addShort") : label}
      </button>
      {phase === "failed" && <span className="text-small text-error-text">{t("failed")}</span>}
    </div>
  );
}
