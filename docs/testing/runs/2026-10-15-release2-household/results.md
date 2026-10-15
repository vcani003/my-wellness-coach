# Release check 2: scenario `household`, 2026-10-15

Target: local preview of the main working tree at HEAD `32659b4` (includes 0041 "Kitchen infers where things go"), `http://localhost:3200` (ports 3000 and 3100 left alone), stand-in AI (`AI_MODE=fake`), demo kitchen, own PGlite folder and `.next-rel2-hh` build folder (both deleted afterwards; `tsconfig.json` restored). Playwright at phone size 375×812, two separate browser sessions: tester A = Vero, tester B = Levi in the dev "acting as" bar. Steps follow `../2026-10-15-release-household/results.md`, plus the 0041 checks. Started with the dev bar's **Reset**.

| # | Step | Result | What I did → what I saw |
|---|---|---|---|
| 0 | Reset | Pass | Dev bar **Reset** → "Your kitchen is empty. Tell me what you've got." (01) |
| 1 | A adds items and a list item | Pass | "I bought eggs, chicken thighs, spinach and yogurt" → "All set: added eggs, chicken thighs, spinach, and yogurt." + "Added eggs / Added chicken thighs / Added spinach / Added yogurt" + Undo. "add garlic and ginger to the list for MD Oriental" → "On your list, MD Oriental: garlic, ginger" + Undo. |
| 2 | B sees them with a cue, **in the right place (0041)** | Pass | B's first load: under **Fridge**: Chicken thighs, Eggs, Spinach, Yogurt, each "added today · Vero · just now". No "Not sure where" group. List "2 · 0 got". Banner "Vero added your seafood allergy. Confirm or change it?" with **Not now**. (02) |
| 2b | Live update while B is looking, places right (0041) | Pass | A: "I bought milk, rice and frozen peas". B's open page (no reload) showed them after **12.7 s**: Milk under **Fridge**, "Frozen peas" under **Freezer**, Rice under **Pantry**, each "Vero · just now"; status line "Vero updated the kitchen." (03) |
| 2c | One-time "sorted" receipt only for whoever's load triggered it (0041) | Pass (not triggered) | No "sorted" message or receipt in A's or B's chat at any point. Expected: after Reset nothing was unplaced, so the once-per-kitchen sort had nothing to do. The receipt itself was **not exercised**; it needs a kitchen with pre-0041 "Not sure where" items (e.g. a staging kitchen). |
| 3 | B ticks; A sees who ticked | Pass | B ticked Garlic → "2 · 1 got", **Done shopping**. A (reload): "Since your last visit: Levi got garlic."; Garlic with a "Levi" tag; checkbox named "Garlic, got it, ticked by Levi". (04, 04b) |
| 4 | B can't Undo A's change | Pass | B: 0 Undo buttons before his own changes; his chat shows only the greeting and chips. |
| 5a | B: "I used the rest of the eggs" / "the yogurt is running low" | Pass | "Got it: marked the eggs as used up." "Eggs: out" + Undo; "Noted: marked the yogurt as running low." "Yogurt: running low" + Undo (only his own). |
| 5b | A sees B's change, live | Pass | A's open page, no reload: "Levi used up the eggs." atop Kitchen within ~1 s of B finishing; Eggs gone; status "Levi used up the eggs. Levi updated the kitchen." (05) |
| 5c | Since your last visit | Pass | A, new page load: "Since your last visit: Levi got garlic, used up the eggs, marked the yogurt running low, and 1 more change. See all". |
| 5e | A sees B's cue on a visible item | Pass | Yogurt (Fridge): "Running low · Levi · just now". |
| 6a | B's allergy in Settings | Pass | YOURS: "Allergy / Seafood / Note: can eat shellfish if medicine is on hand / Added by Vero, needs you to confirm" with **Confirm**, **Edit note**, **Remove**. (06) |
| 6b | Read-only for A | Pass | LEVI'S: "Added by you, needs Levi to confirm", "Only Levi can change these.", 0 Confirm buttons. |
| 6c | Only B confirms | Pass | B → Confirm → "Confirmed Levi's allergy: seafood" + Undo; "Added by Vero · you confirmed it". A then sees "Added by you · Levi confirmed it". (07) |
| 7 | Chats are private | Pass | A's chat: only her 3 messages and receipts; B's: only his 2. (08, 09) |

Not run this time: 5d (Dismiss; the "Since your last visit" line wasn't shown in the fresh browser session I used, so no Dismiss button), 6d ("I'm allergic to peanuts", known stand-in limitation).

**Total: 15 pass, 0 fail (of 15 run); 2c passed only in the sense that no stray receipt appeared — the sort receipt itself wasn't exercised.**

## Felt wrong / worth knowing (passed anyway)
- "I bought … frozen peas" saves an item named **"Frozen peas"** in the Freezer; the word "frozen" stays in the name (minor).
- B's own changes show no "· Levi" cue on his side (Yogurt "Running low" without a name), which is right, but A's items on B's side age to "Vero · 1 minute ago" quickly; fine.
- Confirm copy still speaks to Levi in the third person: "Confirmed Levi's allergy: seafood".
- Settings still suggests "I'm allergic to peanuts", which the local stand-in rejects.
- List items still carry no "who added" cue for the other person; ticks do.
- No console errors recorded in either session this run (the earlier hydration mismatch didn't recur).

Screenshots: `01`–`09` in this folder.
