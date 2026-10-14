# Tester re-run: scenario `household`, 2026-10-14 (before deploy)

Target: local preview `http://localhost:3000` (stand-in AI, demo kitchen), tab "seed", phone size 375×812. Dev "acting as" bar: Vero = tester A, Levi = tester B. Started with the dev bar's **Reset**. Re-checks `../2026-10-14-household/results.md`, using "I used the rest of the eggs" for Levi. Both testers share one tab, so each switch reloads the kitchen; the "while you're looking" live update (within ~15 s, no reload) was not exercised.

| # | Step | Result | What I did → what I saw |
|---|---|---|---|
| 0 | Reset | Pass | "Your kitchen is empty. Tell me what you've got." + chips. (01) |
| 1 | Vero adds items and a list item | Pass | "I bought eggs, chicken thighs, spinach and yogurt" → "All set: added eggs, chicken thighs, spinach, and yogurt." + Undo. "add garlic and ginger to the list for MD Oriental" → "On your list: garlic and ginger.", "MD ORIENTAL · 2". |
| 2 | Levi sees them with a cue | Pass | As Levi: all 4 items "added today · Vero · just now"; list "2 · 0 got" with Garlic, Ginger; banner "Vero added your seafood allergy. Confirm or change it?". (02) |
| 3 | Levi ticks; Vero sees who ticked | Pass | Levi ticked Garlic → "2 · 1 got", **Done shopping**. As Vero: Garlic with a "Levi" tag; checkbox named "Garlic, got it, ticked by Levi". |
| 4 | Levi can't Undo Vero's change | Pass | As Levi, `find "Undo"` → no matches; his chat shows only the greeting. |
| 5a | Levi: "I used the rest of the eggs" | Pass | "Got it: marked the eggs as used up." / "Eggs: out" + his own Undo. Also "the yogurt is running low" → "Noted: marked the yogurt as running low." |
| 5b | **Re-check:** Vero sees Levi's change on eggs | **Pass** (was Fail) | Switched to Vero: atop Kitchen, "**Since your last visit:** Levi got garlic, used up the eggs, and marked the yogurt running low." with a **Dismiss** (×). (03) |
| 5c | Vero sees Levi's cue on a visible item | Pass | Yogurt: "Running low · Levi · just now". |
| 5d | Dismiss | Pass | Dismiss → line gone; still gone after a reload. |
| 6a | Levi's allergy in Settings | Pass | As Levi, YOURS: "Allergy Seafood / Note: can eat shellfish if medicine is on hand / Added by Vero, needs you to confirm", with **Confirm**, **Edit note**, **Remove**. |
| 6b | Read-only for Vero | Pass | As Vero, LEVI'S: same allergy and note, "Only Levi can change these.", no Confirm / Edit note / Remove buttons. |
| 6c | Only Levi confirms | Pass | Levi → Confirm → "Confirmed Levi's allergy: seafood" + Undo; label "Added by Vero · you confirmed it". Vero then sees "Added by you · Levi confirmed it". (04) |
| 6d | "I'm allergic to peanuts" (Vero) | Blocked (expected) | Stand-in: "Sorry, I didn't catch that. I'm a simple stand-in for now…". (05) |
| 7 | Chats are private | Pass | Levi's full chat: only his two messages. Vero's: only her three. |

**Total: 13 pass, 0 fail, 1 blocked (of 14).** The 5a phrase and 5b now pass.

## Felt wrong (passed anyway)
- Confirm copy still speaks to Levi in the third person: "Confirmed **Levi's** allergy: seafood" instead of "your".
- Settings still suggests "I'm allergic to peanuts", which the local stand-in rejects (fine on the real AI).
- List items still carry no "who added" cue for the other person (kitchen items do); ticks do.
- Next.js dev "N" badge covers the start of the composer (dev only).

Screenshots: `01`–`05` in this folder.
