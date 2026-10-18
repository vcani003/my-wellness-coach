# Release check: scenario `household`, 2026-10-18 (feat/kitchen-os-next)

Target: the running local preview at `http://localhost:3000` (`feat/kitchen-os-next`, HEAD `6b7578b` when written), stand-in AI, demo kitchen. Playwright, headless Chromium, phone 375×812, one browser with two separate sessions: tester A = Vero, tester B = Levi in the dev "Acting as" bar. Run after the `single` scenario, started with the dev bar's **Reset**.

| # | Step | Result | What I did → what I saw |
|---|---|---|---|
| 0 | Reset | Pass | "Your kitchen is empty." B's Today: "Vero added your seafood allergy. Confirm or change it?" + **Not now**. (01) |
| 1 | A adds items | Pass | A: "I bought shrimp, milk and eggs" → "All set: added shrimp, milk, and eggs." + Undo. |
| 2 | B sees them live, with a cue | Pass | B's open Kitchen (no reload) showed Eggs, Milk, Shrimp under Fridge after **1.5 s**, each "added today · Vero · just now". (02) |
| 3 | A adds a list item | Pass | "add eggs and limes to the list for Publix" → "On your list, Publix: eggs, limes" + Undo. |
| 4 | Chats are private | Pass | B's chat: only Lumi's greeting and the three suggestion chips. |
| 5 | B can't Undo A's change | Pass | B had 0 Undo buttons for A's changes, before and after his own change. A had no Undo for B's change. |
| 6 | B ticks; A sees who ticked | Pass | B ticked Limes; A's open List (no reload) after **11.2 s**: "2 · 1 GOT", Limes with a "Levi" tag, checkbox "Limes, got it, ticked by Levi"; Done shopping appears. (03) |
| 7 | B's change shows as B's | Pass | B: "the milk is running low" → "Milk: running low" + Add milk to my list + Undo. A's open Kitchen at once: Milk "Running low · Levi · just now". (04) |
| 8 | Allergy "Added by …" for B | Pass | B Settings, YOURS: "Allergy / Seafood / Note: can eat shellfish if medicine is on hand / Added by Vero, needs you to confirm" + Confirm, Edit note, Remove. (05) |
| 9 | Read-only for A | Pass | A Settings, LEVI'S: "Added by you, needs Levi to confirm / Only Levi can change these."; no Confirm button. |
| 10 | Only B confirms | Pass | B → Confirm → "Added by Vero · you confirmed it". A after reload: "Added by you · Levi confirmed it". (06) |
| 11 | Staples are shared (SS1, new) | Pass | A: "rice is a staple". B → List → Restock staples: NEED "Rice / Not in yet", "Add 1 to my list". |
| 12 | Dated plan is shared (new) | Pass | A: "make me a sample recipe for curry", "plan the curry for thursday" → "Planned Sample recipe (stand-in): Curry for Thu, Oct 22". B's Plan: Thu 22 › the curry, "Added by Vero", Start cooking / Cancel. (07) |
| 13 | End state | Pass | No console errors or page errors in either session. (08, 09) |

Not run: "What can I make?" / "Shrimp tacos?" allergy flags (need the real AI, PF10), the "Since your last visit" line and Dismiss.

**Total: 13 pass, 0 fail (of 13).**

## Felt wrong / worth knowing (passed anyway)
- When B opened the List about 2 s after A added eggs and limes, it briefly said "Your list is clear. Tell me what you need." before the items arrived. ux.md §10 says that empty text shows only in the session where the list was emptied, so for a moment it looked wrong.
- The tick took about 11 s to reach A, which is within the 15 s target. Kitchen changes arrived in 1–2 s.
- List items still have no "who added" cue for the other person. Ticks do have one.

Screenshots: `01`–`09` in this folder.
