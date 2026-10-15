# Release check: scenario `household`, 2026-10-15 (before tonight's deploy)

Target: local preview of the main working tree at HEAD `1a572d9`, `http://localhost:3200` (ports 3000 and 3100 left alone), stand-in AI (`AI_MODE=fake`), demo kitchen, own PGlite folder and build folder (both deleted afterwards). Driven with Playwright at phone size 375×812, **two separate browser sessions** (tester A = Ana, tester B = Ben in the dev "acting as" bar), so unlike the 2026-10-14 re-run the live "while you're looking" update was exercised too. Steps follow `../2026-10-14-rerun-household/results.md`. Started with the dev bar's **Reset**.

| # | Step | Result | What I did → what I saw |
|---|---|---|---|
| 0 | Reset | Pass | Dev bar **Reset** → empty kitchen. (01) |
| 1 | Ana adds items and a list item | Pass | "I bought eggs, chicken thighs, spinach and yogurt" → receipt "Added eggs / Added chicken thighs / Added spinach / Added yogurt" + Undo. "add garlic and ginger to the list for MD Oriental" → "On your list, MD Oriental: garlic, ginger" + Undo. |
| 2 | Ben sees them with a cue | Pass | Ben's session: all 4 items "added today · Ana · just now"; list "2 · 0 got"; banner "Ana added your seafood allergy. Confirm or change it?" with **Not now**. (02) |
| 2b | Live update while Ben is looking (≤ ~15 s) | Pass | Ana: "I bought milk". Ben's open page (no reload) showed "Milk · added today · Ana · just now" after **10.9 s**. |
| 3 | Ben ticks; Ana sees who ticked | Pass | Ben ticked Garlic → "2 · 1 got", **Done shopping**. Ana: Garlic with a "Ben" tag; checkbox named "Garlic, got it, ticked by Ben". (03) |
| 4 | Ben can't Undo Ana's change | Pass | Ben: 0 Undo buttons; his chat shows only the greeting and chips. |
| 5a | Ben: "I used the rest of the eggs" / "the yogurt is running low" | Pass | "Eggs: out" + Undo; "Yogurt: running low" + Undo (only his own). |
| 5b | Ana sees Ben's change, live | Pass | Ana's open page, no reload: "Ben used up the eggs." atop Kitchen; Eggs gone. (04a) After a reload no "Since your last visit" line, which is right since she already saw it live. |
| 5c | Since your last visit | Pass | Same session, switched to Ben via dev bar, "I used the rest of the chicken thighs", switched back: "**Since your last visit:** Ben used up the chicken thighs." (04b). Still there after a reload. |
| 5d | Dismiss | Pass | Dismiss → gone; still gone after a reload. |
| 5e | Ana sees Ben's cue on a visible item | Pass | Yogurt: "Running low · Ben · just now". |
| 6a | Ben's allergy in Settings | Pass | YOURS: "Allergy / Seafood / Note: can eat shellfish if medicine is on hand / Added by Ana, needs you to confirm" with **Confirm**, **Edit note**, **Remove**. |
| 6b | Read-only for Ana | Pass | BEN'S: same allergy, "Added by you, needs Ben to confirm", "Only Ben can change these.", no Confirm / Edit note / Remove. |
| 6c | Only Ben confirms | Pass | Ben → Confirm → "Confirmed Ben's allergy: seafood" + Undo; "Added by Ana · you confirmed it". Ana then sees "Added by you · Ben confirmed it". (05) |
| 6d | "I'm allergic to peanuts" (Ana) | Blocked (expected) | Stand-in: "Sorry, I didn't catch that. I'm a simple stand-in for now…". |
| 7 | Chats are private | Pass | Ben's chat: only his messages and receipts; Ana's: only hers. (06, 07) |

**Total: 15 pass, 0 fail, 1 blocked (of 16).**

## Felt wrong / worth knowing (passed anyway)
- **Console error (new to this report):** React hydration mismatch on Ana's reload of the Kitchen: server rendered "Ben · 1 minute ago", client "Ben · just now" (`KitchenWidget.tsx` ItemRowView, relative time crossing the 1-minute boundary between server and client). Page recovered; Next dev overlay showed "1 Issue". Likely harmless to users but noisy.
- Confirm copy still speaks to Ben in the third person: "Confirmed Ben's allergy: seafood".
- Settings still suggests "I'm allergic to peanuts", which the local stand-in rejects.
- List items still carry no "who added" cue for the other person; ticks do.
- "Since your last visit" is per device: a brand-new browser session for Ana showed no line for a change Ben made while she was away (expected for a first visit on a device, but worth knowing).

Screenshots: `01`–`07` in this folder.
