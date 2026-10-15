# Release check 2: scenario `single`, 2026-10-15 (before deploy)

Target: local preview of the main working tree at HEAD `32659b4`, `http://localhost:3100`, stand-in AI (`AI_MODE=fake`), demo kitchen, acting as Vero (tester A), phone 375×812, own empty local database. Driven with Playwright the way a person would use it. Reference: `../2026-10-15-release/results.md`.

## New in this release (decision 0041: Kitchen infers where things go)

| # | Step | Result | What I did → what I saw |
|---|---|---|---|
| P1 | Places inferred on add | Pass | "I bought milk, rice, spinach and frozen peas" → "All set: added milk, rice, spinach, and frozen peas." Fridge: Milk, Spinach · Freezer: Frozen peas · Pantry: Rice · no "Not sure where" group. (02) |
| P2 | Remembered place | Pass | "onions go in the pantry" → "Done: I'll put the onions in the pantry from now on." (receipt "I'll put onions in the pantry from now on"); then "I bought onions" → Pantry: Onions. (03) |
| P3 | One-time sort of existing "Not sure where" | Blocked (can't set up) | The demo Reset starts empty and the sort runs on page load before anything can be added, so there's no pre-existing unplaced item to sort. Did check: "I bought apples and a bottle of wine" → apples to Fridge, bottle of wine in "Not sure where"; after reload nothing re-sorted and no sort message appeared (correct: it never repeats and wine can't be placed). Not tested: the receipt with Undo. |
| — | Journey items placed | Pass (seen) | Eggs, chicken thighs, spinach, yogurt → Fridge; after Done shopping, Ginger → Fridge, Garlic → Pantry. Nothing ended up in "Not sure where". |

## Usual journey

| # | Step | Result | What I did → what I saw |
|---|---|---|---|
| 1 | Reset → empty state | Pass | "Your kitchen is empty. Tell me what you've got."; chips "I bought… / I froze the… / We're running low on…". (01) |
| 2 | Bought | Pass | "All set: added eggs, chicken thighs, spinach, and yogurt. Kitchen updated."; receipt shows 4 lines + Undo; all marked "New"; composer kept focus. |
| 3 | Froze → Freezer | Pass | "Chicken thighs → freezer"; Freezer: "Chicken thighs · Updated". |
| 4 | Undo | Pass | Receipt "Undone"; Freezer group gone. |
| 5 | Undone receipt after reload | Pass | Still "Undone", no Undo button. (04) |
| 6 | List grouped by store | Pass | "On your list, MD Oriental: garlic, ginger"; "MD ORIENTAL · 2". |
| 7 | Tick | Pass | "2 · 2 got"; Done shopping appears. |
| 8 | Done shopping → Kitchen | Pass (with a note) | Sheet → Add 2 items. On a phone the Kitchen widget collapses to "Kitchen / 6 items", so my script couldn't see garlic and ginger right away. Same known behaviour as the last release. Both showed up when the Kitchen was opened (step 16). (05) |
| 9 | What can I make tonight? | Pass | "Let me look at what you have. Here are some ideas from your kitchen."; Chicken thighs rice bowl, Eggs rice bowl, Spinach rice bowl. |
| 10 | Choose → recipe | Pass | `/recipe/…`: "Suggested recipe", "Use my own recipe", "Assumes salt and cooking oil…", IN YOUR KITCHEN, Steps. (06) |
| 11 | Refinement "no oven please" | Blocked (stand-in) | "Sorry, I didn't catch that. I'm a simple stand-in for now…". Recipe unchanged. Same as the last release: this needs the real AI. (07, 08) |
| 12 | Curry phrase → recipe with Need | Pass | "Chicken curry it is. I added potatoes. Here's a recipe. Here's a recipe for Chicken curry."; NEED: Coconut milk, Lemongrass. |
| 13 | Add to plan | Pass | "In your plan". |
| 14 | Start cooking → Done cooking | Pass | Sheet "Update your kitchen / Cooked: Chicken curry" with Still have some / Running low / Out per item and a note field. |
| 15 | Update your kitchen | Pass | Running low + Out + "used half" → "Updated your kitchen after Chicken curry: 1 running low and 1 out." (09) |
| 16 | Kitchen reflects it | Pass | Chicken thighs "Running low"; potatoes gone; Ginger (Fridge), Garlic (Pantry) present. |
| 17 | 2 batches | Pass | "Added eggs (2 batches) / You also had eggs from Oct 15. / Still have them / Those are gone". |
| 18 | Those are gone | Pass | "Eggs: those are gone (1 batch left)"; one Undo button. (10) |
| 19 | Defrosted | Pass | "Noted: marked the chicken thighs as defrosted."; Fridge: Chicken thighs "Defrosted". |
| 20 | Category correction | Pass | "Done: the fish sauce is under Sauces & condiments now." + Undo. |
| 21 | See all | Pass | "See all (7)" → `/kitchen`. |
| 22 | By type + reload | Pass | Produce, Meat & seafood, Dairy & eggs, Sauces & condiments; By type still selected after reload. (11) |
| 23 | Search "fish" | Pass | "1 match". |
| 24 | Clear search | Pass | |
| 25 | Settings | Pass | Account, Kitchen ("Shared with Levi"), Allergies and preferences (Levi's: "Added by you, needs Levi to confirm"), Your data, Privacy and terms. My script first flagged this as a fail because it looked for h2 headings and the sections are h3; a recheck confirmed it was fine. (12, 15) |
| 26 | Reload → chat history | Pass | Full history is still there; eggs receipt still "Eggs: those are gone (1 batch left)" with Undo. (13) |
| 27 | End state | Pass | (14) |

**Total: 29 pass, 0 fail, 2 blocked (of 31).** No browser console errors and no server errors.

## Felt wrong (passed anyway)
- Apples went to the Fridge. The 0041 commit says counter fruit stays in "Not sure where". The Fridge is a reasonable place for apples, but Vero may want to check it's what she intended.
- Known issues still there: "Here's a recipe" appears twice in the curry reply; "You also had eggs from Oct 15." when that's today; on a phone, Done shopping collapses the Kitchen widget.
