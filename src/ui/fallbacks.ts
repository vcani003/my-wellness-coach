/**
 * Safe display fallbacks (0018): nothing renders blank. A missing person → "Someone", a missing
 * item → "Unknown item", no location → "Not sure where" (in the Kitchen widget's groups).
 */
import type { ActorRef } from "@/contracts/common";

type T = (key: string) => string;

export function actorName(ref: ActorRef | undefined, t: T): string {
  if (!ref || "missing" in ref) return t("fallback.someone");
  return ref.name.trim() || t("fallback.someone");
}

export function itemName(name: string | undefined, t: T, locale = "en"): string {
  const n = name?.trim();
  return n ? sentenceCase(n, locale) : t("fallback.unknownItem");
}

/** "chicken thighs → freezer" → "Chicken thighs → freezer". */
export function sentenceCase(text: string, locale = "en"): string {
  return text ? text.charAt(0).toLocaleUpperCase(locale) + text.slice(1) : text;
}
