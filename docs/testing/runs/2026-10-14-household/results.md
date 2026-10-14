# Tester run: scenario `household`, 2026-10-14

Target: the local preview at `http://localhost:3000` (stand-in AI, demo kitchen), phone size 375×812, browser tab "seed". I used the dev "acting as" bar with Vero as tester A and Levi as tester B, and started with the dev bar's **Reset**. Both testers share one tab, so each identity switch reloads the kitchen. That means the "while you're looking" live update (a cue appearing within about 15 seconds without a reload) wasn't exercised. Every cue below was seen straight after a switch.

| # | Step | Result | What I did → what I saw |
|---|---|---|---|
| 0 | Reset | Pass | Reset → "Your kitchen is empty. Tell me what you've got." plus the suggestion chips. (01) |
| 1 | Vero adds items and a list item | Pass | "I bought milk and eggs" → "All set: added milk and eggs.", receipt "Added milk / Added eggs", Undo. "add garlic to the list for MD Oriental" → "On your list: garlic.", list "MD ORIENTAL · 1". |
| 2 | Levi sees them with a cue | Pass | Switched to Levi. Eggs and Milk each show "added today · Vero · just now"; Shopping list "1 · 0 got" with Garlic under MD ORIENTAL. (02, 03) |
| 3 | Levi ticks; Vero sees who ticked | Pass | As Levi, ticked Garlic → struck through, "1 · 1 got", **Done shopping**. As Vero: Garlic struck through with a "Levi" tag; the checkbox's accessible name is "Garlic, got it, ticked by Levi". (04) |
| 4 | Levi can't Undo Vero's change | Pass | As Levi, `find "Undo"` returns no matches. His chat shows only the greeting, with no receipts from Vero. (05) |
| 5a | "I used the eggs" (phrase) | **Fail** | As Levi, the stand-in replied "Sorry, I didn't catch that. I'm a simple stand-in for now…", so this phrase from the orchestrator's list doesn't work. "I used the rest of the eggs" did work: "Got it: marked the eggs as used up.", "Eggs: out", and Levi got his own Undo. (06) |
| 5b | Vero sees Levi's change on eggs | **Fail** | As Vero (after the switch, a 16 s wait and a reload), eggs are gone from the Kitchen ("1 item"). There's no "Levi · just now" and no "Since your last visit" line (ux.md §6: "Levi … used the eggs"), so nothing says who removed them. (07) |
| 5c | Vero sees Levi's change on a visible item | Pass | As Levi, "the milk is running low" → "Noted: the milk running low." As Vero: Milk shows "Running low · Levi · just now", which later read "Levi · 2 minutes ago". (08) |
| 6a | Levi's allergy in Settings | Pass | As Levi, the Kitchen banner reads "Vero added your seafood allergy. Confirm or change it?" and links to Settings. Settings → YOURS: "Allergy Seafood / Note: can eat shellfish if medicine is on hand / Added by Vero, needs you to confirm", with **Confirm**, **Edit note** and **Remove**. (09) |
| 6b | Read-only for Vero | Pass | As Vero, under LEVI'S: the same allergy and note, "Added by you, needs Levi to confirm", "Only Levi can change these." There are no Confirm, Edit or Remove controls. (10) |
| 6c | Only Levi confirms | Pass | As Levi, Confirm → "Confirmed Levi's allergy: seafood · Undo"; the label now reads "Added by Vero · you confirmed it" and the banner is gone. Vero then sees "Added by you · Levi confirmed it". (11) Remove was not tapped. |
| 6d | "I'm allergic to peanuts" (Vero) | Blocked | Stand-in: "Sorry, I didn't catch that…". The stand-in doesn't support allergies. (12) |
| 7 | Chats are private | Pass | Levi's full chat holds only his own three messages; Vero's holds only her three. Neither shows the other's messages or receipts. (05, 13) |

**Total: 9 pass, 2 fail, 1 blocked (of 12).**

## Felt wrong (passed anyway)
- **List items carry no "who" cue.** As Levi, Vero's Garlic shows no "Vero · just now" (kitchen items do). ux.md §6 says ticks carry a tag, and that part works.
- **Layout jump on first load as Levi.** One tap on the Shopping list header expanded the list, moved it above the Kitchen and collapsed the Kitchen, and the allergy banner appeared at the same moment.
- **Confirm copy speaks in the third person to Levi.** As Levi the confirmation reads "Confirmed **Levi's** allergy: seafood" instead of "your".
- **Settings suggests a phrase the local stand-in rejects.** The empty-allergy hint says *Tell Kitchen in chat, for example "I'm allergic to peanuts"*, but the local stand-in rejects it.
- **Vero's receipt still offers Undo after Levi's change.** Her "Added milk / Added eggs" receipt still has Undo after Levi used the eggs. Undoing it might re-remove eggs that are already out; I didn't test that.
- **The chat dock covers Settings content.** It overlaps the Preferences section at phone size.
- **Dev-only overlays.** A "Compiling…" toast appeared at the end, so the dev server was rebuilding mid-run. The Next.js "N" badge covers the start of the composer.
- **Tool note.** The page's DOM text was sometimes stale until a screenshot forced a render, so I checked state with a screenshot each time.
