/**
 * Translation setup (0015: English only, translation-ready). All UI text lives in
 * `messages/en.json`; components read it with next-intl's `useTranslations`.
 * One locale for MVP 1, so there's no locale routing: adding a language is one more JSON file
 * plus picking it here.
 */
import en from "./messages/en.json";

export const DEFAULT_LOCALE = "en";
export type Messages = typeof en;
export const messages: Record<string, Messages> = { en };

export function getMessages(locale: string = DEFAULT_LOCALE): Messages {
  return messages[locale] ?? en;
}
