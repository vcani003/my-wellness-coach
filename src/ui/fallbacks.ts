/**
 * Safe display fallbacks (0018): nothing renders blank. A missing person → "Someone", someone who
 * deleted their data → "a former member" (D1, 0015), a missing item → "Unknown item", no
 * location → "Not sure where" (in the Kitchen widget's groups).
 */
import type { ActorRef } from "@/contracts/common";

type T = (key: string) => string;

export function actorName(ref: ActorRef | undefined, t: T): string {
  if (ref && "former" in ref && ref.former) return t("fallback.formerMember");
  if (!ref || "missing" in ref) return t("fallback.someone");
  return ref.name.trim() || t("fallback.someone");
}

/** Did someone other than `meId` do this? A former member or an unknown person counts as someone else. */
export function byOther(ref: ActorRef | undefined, meId: string): boolean {
  return !ref || "missing" in ref || ref.id !== meId;
}

export function itemName(name: string | undefined, t: T, locale = "en"): string {
  const n = name?.trim();
  return n ? sentenceCase(n, locale) : t("fallback.unknownItem");
}

/** "chicken thighs → freezer" → "Chicken thighs → freezer". */
export function sentenceCase(text: string, locale = "en"): string {
  return text ? text.charAt(0).toLocaleUpperCase(locale) + text.slice(1) : text;
}
