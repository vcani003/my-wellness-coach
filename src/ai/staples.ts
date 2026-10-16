/**
 * Smart staples in chat (0054), shared by the real and the fake interpreter. Code, never the
 * model, decides what saves and what a staples answer says:
 * - "What staples do I need?" is answered **from the saved staples** (SS6), with each one's need
 *   computed by the backend (`KitchenState.staples[].need`), plus the `staples` stream data for
 *   the "Add these to my list" button. With no saved staples, the model's general guess stands.
 * - Staples are saved only when the user says so, or says yes to Kitchen's offer (SS2).
 */
import { stapleNeedsBuying, type KitchenState, type StapleRow } from "@/contracts/kitchen-state";
import type { StaplesAnswer } from "@/contracts/stream";

/** The user's own words talk about staples: "fish sauce is a staple", "we always keep rice". */
export const STAPLE_WORDS =
  /\b(staples?|always (keep|have|buy|get|stock)|keep (it |them )?(stocked|on hand|in stock)|stock up on)\b/i;

/** Kitchen's turn offered to remember staples ("Want me to remember these as your staples?"). */
export const STAPLES_OFFER = /\bremember\b[^.?!]*\bstaples?\b/i;

/** The words after the need in a staples answer. */
const NEED_WORDS: Record<StaplesAnswer["items"][number]["need"], string> = {
  out: "out",
  low: "running low",
  missing: "not in the kitchen",
};

const list = (names: string[]) => new Intl.ListFormat("en", { type: "conjunction" }).format(names);

export const ALL_STOCKED_REPLY = "All your staples are stocked.";
export const ADD_THESE_OFFER = "Want me to add these to your list?";

/**
 * The staples answer from the saved staples, or null when there are none (then Lumi's general
 * guess is used, SS6). Needed ones are grouped by usual store when any has one ("Anywhere" last);
 * ones already on the list are named once at the end, never offered again (SS3).
 */
export function staplesAnswer(state: Pick<KitchenState, "staples">): { reply: string; staples?: StaplesAnswer } | null {
  const saved = state.staples ?? [];
  if (saved.length === 0) return null;
  const needed = saved.filter((s) => stapleNeedsBuying(s.need));
  const onList = saved.filter((s) => s.need === "on-list").map((s) => s.name.value);
  const listed = onList.length ? ` Already on your list: ${list(onList)}.` : "";
  if (needed.length === 0) return { reply: `${ALL_STOCKED_REPLY}${listed}` };

  const line = (s: StapleRow) => `${s.name.value} (${NEED_WORDS[s.need as keyof typeof NEED_WORDS]})`;
  let body: string;
  if (needed.some((s) => s.store)) {
    const groups = new Map<string, StapleRow[]>();
    for (const s of needed) {
      const key = s.store?.value ?? "";
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    const order = [...groups.keys()].filter((k) => k !== "").concat(groups.has("") ? [""] : []);
    body = order.map((k) => `${k || "Anywhere"}: ${groups.get(k)!.map(line).join(", ")}.`).join(" ");
  } else {
    body = `${list(needed.map(line))}.`;
  }
  return {
    reply: `From your staples, you need: ${body}${listed} ${ADD_THESE_OFFER}`,
    staples: {
      items: needed.map((s) => ({
        stapleId: s.id,
        name: s.name.value,
        ...(s.store ? { store: s.store.value } : {}),
        need: s.need as StaplesAnswer["items"][number]["need"],
      })),
    },
  };
}
