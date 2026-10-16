# Plan: Smart staples

**Status:** Proposed · 2026-10-16 · UX for the orchestrator. Questions are **SS1–SS7** in [OPEN-QUESTIONS](../OPEN-QUESTIONS.md), and this plan follows their Recs. First in your P3 order and never built. Docs only: nothing has been built yet.

**The feature** ([next-epics](next-epics.md) #1): Kitchen remembers your usual staples. When one runs low or out, it offers to add it to the list, and a **Restock** button builds the list for you. The aim is a faster grocery trip.

---

## 1. What exists today, and what's new

| Already there | Where | What's missing |
|---|---|---|
| "What staples do I need?" gets a chat answer, which is Lumi's guess at a sensible pantry for you | AI prompt (`src/ai/real/prompt.ts`) | It doesn't know *your* staples, so the answer changes every time |
| "Want me to remember these as your staples?" → yes | Saved as **one line of free text** in the asker's personal preferences ("Staples: fish sauce, jasmine rice") | The app can't act on that line. It's personal, so Levi's Kitchen doesn't use it, and there's nowhere to see or edit it as a list |
| "Want me to add these to your list?" → yes adds them, tagged `staples` | AI + `shopping.add` with `source: staples` | This works in chat only |
| SL3: after Out or Low, Lumi *may* offer "Add fish sauce to your list?" | AI reply; adds tagged `stock-offer` | ux.md §10 designed a one-tap **Add fish sauce to my list** button in the receipt, but it was **never built** in the Kitchen OS UI |
| The one-tap add action `addToShoppingList {source, items}` | `src/app/actions.ts` → `addShoppingItems` in `src/domains/kitchen/commands.ts` | No screen calls it yet. Restock can reuse it as it is |
| Stock levels `low` / `out` | Items and batches | `plenty` / `some` come with **KOS4** |

**New in this feature:**
1. **A shared staples list** that belongs to the kitchen, as structured rows (name, plus an optional usual store), with Undo and history.
2. **A Restock sheet** on the List place that pre-selects what you need and adds it to the list in one tap.
3. **The one-tap buttons that were designed but never built:** **Add X to my list** on an Out/Low receipt, and **Add these to my list** under a staples answer.
4. **Lumi knows your staples.** She can save one when you say so, and her staples answer is built from your list.

---

## 2. What you'll see and do

### Restock (the main flow)
**Phone.** In the List place, under the list header, there's a white pill button: **Restock staples**. Tap it and a bottom sheet opens:

```
┌──────────────────────────────┐
│ Restock staples           ✕  │
│ Pick what to add to your list│
│ NEED                         │
│ ☑ 🐟 Fish sauce   Out        │
│ ☑ 🍚 Jasmine rice Running low│
│ ☑ 🥚 Eggs         Not in yet │
│ YOU HAVE SOME                │
│ ☐ 🧄 Garlic       Some       │
│ ☐ 🧅 Shallots     Plenty     │
│ ON YOUR LIST                 │
│   🍜 Rice noodles  (muted)   │
│                              │
│ [   Add 3 to my list   ]     │  ← coral pill
│ Edit staples                 │  ← quiet link
└──────────────────────────────┘
```
- **Need** (pre-selected): staples that are **Out**, **Running low**, or **not in the kitchen** at all ("Not in yet", SS3).
- **You have some** (not selected): Some, Plenty, or in the kitchen with no level set. You can tick any of them as an extra.
- **On your list:** already there, shown muted so you're not asked twice.
- **Add N to my list** adds them in one change set. Each goes under its usual store (SS5), or under Anywhere (and by aisle once KOS9 lands). The "What changed" card reads "On your list: fish sauce, jasmine rice, eggs" with **Undo** for all of them.

**Desktop.** It's the same content as a centred dialog over the List place, with chat staying on the side (0034). That's the familiar sheet-on-phone, dialog-on-desktop pattern (0002) that "Add to your kitchen?" already uses.

**From chat:** "restock", "what staples do I need?" or "build my list" gives an answer from your staples (SS6), plus **Add these to my list** under it. Tapping it adds what that answer named.

### Managing staples
**Edit staples** in the Restock sheet switches it to a simple list: each staple with its usual store if one is set (SS5: kept only when you say or pick one), a **⋯** (Store… · Remove), and an **Add a staple** field at the bottom. Removing needs no confirmation: it's low-stakes and has Undo.
- **In chat:** "fish sauce is a staple", "we always keep jasmine rice", "eggs aren't a staple any more".
- **On an item** (after KOS3, "tap an item to edit it"): a **Staple** switch in the item's edit sheet. The Kitchen OS UI has no item menu today, so this waits for KOS3 (§6).
- Kitchen rows don't get a staple badge. That keeps the Kitchen list calm, and the Restock sheet is where staples live.

### Out / Low → offer (SL3, now with its button)
When something is marked **Out** or **Running low** (by chat, after cooking, by auto-Out, and by the item buttons once KOS3 lands), the receipt adds a line: **Add fish sauce to my list**. It's never added automatically (SL3, SS4). It's hidden if the item is already on the list. For a staple the line reads "Fish sauce is one of your staples · **Add to my list**". **Some** never triggers it, only Low and Out.

### States
| State | What shows |
|---|---|
| **No staples yet** (empty) | Lumi (idle) and "No staples yet. Tell me 'fish sauce is a staple', or add one here." with the Add field open. If you once said yes to "remember these as your staples", there's an offer here: "You told me these before: fish sauce, jasmine rice, rice noodles. **Add them** · Not now" (§3) |
| **Everything's stocked** | "All your staples are stocked." The Need group is hidden, the button is off, and you can still tick extras |
| **Loading** | Three placeholder rows in the sheet. The button stays visible |
| **Error loading** | "Couldn't load your staples · Retry", inside the sheet. The rest of the List place is unaffected (0018) |
| **Add failed** | "Couldn't add those, so nothing changed. · Try again". The sheet stays open with your choices kept |
| **Offline** | The Restock button is disabled with "Back online to restock". Ticks still work (SL4). Once **KOS7** lands, Restock joins the offline queue (0044) |
| **Someone else changed something meanwhile** | Adds merge as they do today. Anything Levi already added shows as "Garlic's already on your list." Nothing is duplicated |

### Look (0048, 0050, 0038)
Only existing tokens are used: a white sheet on `shadow-pop`, emoji tiles (from the catalog once KOS2 lands; a generic tile until then), short caps group labels, the coral gradient pill with ink text, and the mint "What changed" card. Status words use the existing stock colours (`warning-text` for Running low, muted for the others). There's no new colour and no animation beyond the sheet's `motion.gentle` rise. **The focal point is the Add pill.** The Need group sits on top with the strongest contrast, and the rest is muted.

---

## 3. How staples are learned (SS2)

**Only from you, either said or tapped.** Kitchen never decides on its own that something is a staple (0012).
- **Saying it** counts as yes: "fish sauce is a staple", "we always keep rice". It's saved with a receipt and Undo, the same way "Remember that…" works today.
- **Lumi's offer:** after a staples or shopping answer, she may ask "Want me to remember these as your staples?". A yes saves them as **staples**, not as a line in your personal preferences. As today, ignoring the offer counts as no, and she doesn't ask again for 30 days (ai.md).
- **Tapping:** Add a staple in the sheet, or the Staple switch on an item (after KOS3).
- **Not included:** guessing from what you buy ("you've bought eggs 3 times, is that a staple?"). That's pattern prediction (spec §10). It's an easy add later if you want it (SS2 alternative).
- **Old "Staples: …" preferences:** they're shown once, as the "You told me these before" offer above. Code splits the line at commas, and nothing moves until you tap **Add them**. The old preference line stays where it is, and you can remove it in Settings.

## 4. Stock levels (KOS4) and the shopping list

| Staple's state | Restock | Out/Low offer |
|---|---|---|
| Out, or not in the kitchen | Need, pre-selected | Out: yes |
| Running low | Need, pre-selected | yes |
| Some / Plenty / no level | You have some, not selected | no |
| Already open on the list | On your list, muted | hidden |

- The status is **computed by code** from the kitchen and the list every time it's read, and never stored, so it can't drift.
- **The loop closes by itself:** a staple you tick and put away with **Done shopping** becomes a kitchen batch again, so the next Restock shows it under "You have some". No new step is needed.
- **Without KOS4**, everything still works with today's low/out: "You have some" just means "in the kitchen, not low".

## 5. Shared kitchen and Undo
- **One staples list per kitchen** (SS1). You and Levi see and edit the same list, just as you share the shopping list.
- **Someone else's change** shows a person tag in Edit staples ("Levi") and the usual live-update cue (ux.md §6). Your own changes have no tag.
- **Undo** (0007, 0017): every add, remove, store change and Restock gives a "What changed" card with **Undo** for your own changes only. One Restock is one Undo, which takes back every item it added. Undo never erases history.
- **Allergies:** staples are things you chose to keep, so they're never flagged or left out. When you have no staples yet, Lumi's guessed answer still leaves out other members' allergens unless you asked (0019).

## 6. Out of scope
- Guessing staples from buying patterns (SS2), and anything automatic: no auto-adding to the list (SL3) and no reminders or notifications (that's candidate #8).
- Usual amounts ("always 2 bottles"), restock schedules, par levels, prices or budgets. Only a usual store is kept.
- Separate staples lists for each person or each store.
- Aisle grouping (that's KOS9), and catalog emoji (KOS2) until they land.
- Offline Restock until KOS7.

---

## 7. Milestones

| # | Piece | Owner | Size |
|---|---|---|---|
| U | ux.md §10 addition: Restock sheet, Edit staples, the receipt line, states and copy, and two tester-script steps | UX | S |
| B | **Staples on the backend:** an additive migration for a `staples` table (kitchen, name as said, standard name, optional store `Fact`, who and when). Events `staple.added`, `staple.updated`, `staple.removed`, keyed `staple:<standardName>` so Undo works as it does for remembered places. Ops `staple.add`, `staple.update`, `staple.remove`; adding one that's already there is a no-change "already a staple". `KitchenState.staples` with a **computed** `need: out \| low \| missing \| have \| on-list`. Server actions `addStaple`, `updateStaple`, `removeStaple`. Restock **reuses** `addToShoppingList` with `source: staples` and each staple's store (no new op). Tests for merge, Undo, the computed status and the shared kitchen | Backend | S–M |
| A | **Lumi and staples:** new model actions `staple_add` / `staple_remove` (said, or a yes to her offer) that map to the ops; the "remember these as staples" yes now saves staples instead of a preference; a `<staples>` context block with each status; the staples answer built from saved staples when there are any (SS6); evals (about 8 cases: said, offer + yes, offer ignored, "not a staple", Vietnamese names, no staples, all stocked, allergen on the guess list) | AI | S |
| F | **Screens:** the Restock button and sheet (reusing the "Add to your kitchen?" sheet pattern), Edit staples, the "You told me these before" offer, the **Add X to my list** receipt line (SL3) and **Add these to my list** under a staples answer, all the states in §2, accessibility (44 px targets, named checkboxes such as "Fish sauce, out, add to list"), unit and end-to-end tests | Frontend | M |
| F2 | Staple switch in the item edit sheet | Frontend | XS, done inside KOS3 |

**Order:** U → B → A and F in parallel (both work against B's contract) → testers. **Overall size: M**, a bit above the original S–M estimate, because the SL3 and staples buttons from ux.md §10 were never built and land here too.

## 8. Dependencies, and where it fits in the P4 order

- **Needs nothing new first.** It runs on today's low/out and is better with **KOS4** (plenty/some).
- **Uses later:** KOS3 for the item switch, KOS2 for emoji, KOS9 for aisles and KOS7 for offline. Each slots in when it lands, and none of them blocks this feature.
- **Helps later:** **KOS12** ("add the week's missing ingredients to the list") can reuse the Restock sheet as it is.

**Recommendation (SS7): slot it in right after KOS4, as step 1b, before KOS16.** It's what you ranked first in P3, and KOS4 levels are its main input, so it's best built while that work is fresh. It's also the feature that most directly speeds up the grocery trip (0026). It doesn't change the order of the rest of P4.
