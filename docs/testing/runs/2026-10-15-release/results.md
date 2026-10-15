# Release check: scenario `single`, 2026-10-15 (before tonight's deploy)

Target: local preview of the main working tree at HEAD `1a572d9`, `http://localhost:3100` (port 3000 left alone), stand-in AI (`AI_MODE=fake`), demo kitchen, acting as Vero (tester A), phone size 375×812, own empty local database. Reset with the dev bar's Reset first. Driven with Playwright the way a person would use it.

| # | Step | Result | What I did → what I saw |
|---|---|---|---|
| 1 | Reset → empty state | Pass | "Your kitchen is empty. Tell me what you've got."; chips "I bought…", "I froze the…", "We're running low on…". (01) |
| 2 | Bought | Pass | "I bought eggs, chicken thighs, spinach and yogurt" → "All set: added eggs, chicken thighs, spinach, and yogurt."; receipt with 4 lines + Undo; all "New"; composer kept focus. |
| 3 | Froze → Freezer | Pass | "I froze the chicken thighs" → "Chicken thighs → freezer"; Freezer: "Chicken thighs · Updated". |
| 4 | Undo | Pass | Receipt "Undone"; Freezer group gone. |
| 5 | Undone receipt after reload | Pass | Still "Undone", no Undo button. (02) |
| 6 | List grouped by store | Pass | "add garlic and ginger to the list for MD Oriental" → "On your list, MD Oriental: garlic, ginger"; "MD ORIENTAL · 2". |
| 7 | Tick | Pass | "2 · 2 got"; **Done shopping** appears. |
| 8 | Done shopping → Kitchen | Pass | Sheet → **Add 2 items** → "Added 2 to your kitchen. Your list is clear." + Undo, shown once. Kitchen "6 items" (it collapses after this on a phone; garlic and ginger seen in it later). (03) |
| 9 | "What can I make tonight?" → ideas | Pass | "Here are some ideas from your kitchen."; Chicken thighs rice bowl, Eggs rice bowl, Spinach rice bowl. |
| 10 | Choose → recipe (release item 2) | Pass | Choose → `/recipe/…`: "Suggested recipe", "Use my own recipe", "Assumes salt and cooking oil…", IN YOUR KITCHEN, Steps. (04) |
| 11 | Refinement "no oven please" (release item 2) | Blocked (stand-in) | Reply: "Sorry, I didn't catch that. I'm a simple stand-in for now, so I only understand things like “I bought eggs and milk”…". Recipe unchanged, no new version. No error on screen, no console errors. The stand-in interpreter never routes a refinement (unchanged in this release), so this needs the real AI. (05) |
| 12 | Curry phrase → recipe with Need | Pass | "Chicken curry it is. I added potatoes. Here's a recipe. Here's a recipe for Chicken curry."; IN YOUR KITCHEN chicken thighs, potatoes; NEED coconut milk, lemongrass. |
| 13 | Add to plan | Pass | "In your plan". |
| 14 | Start cooking → Done cooking | Pass | Sheet "Update your kitchen / Cooked: Chicken curry" with Still have some / Running low / Out per item + note. |
| 15 | Update your kitchen (Low / Out / note) | Pass | Running low + Out + "used half" → "Updated your kitchen after Chicken curry: 1 running low and 1 out." (07) |
| 16 | Kitchen reflects it | Pass | Chicken thighs "Running low"; potatoes gone. |
| 17 | 2 batches | Pass | "I bought eggs" → "Added eggs (2 batches) / You also had eggs from Oct 15. / Still have them / Those are gone". |
| 18 | Those are gone | Pass | "Eggs: those are gone (1 batch left)", one Undo labelled "Undo: Eggs: those are gone (1 batch left)". (08) |
| 19 | Defrosted → Fridge | Pass | "Noted: marked the chicken thighs as defrosted."; Fridge: chicken thighs, "Defrosted". |
| 20 | Category correction | Pass | "fish sauce goes under sauces" → "Done: the fish sauce is under Sauces & condiments now." + Undo. |
| 21 | See all | Pass | "See all (7)" → `/kitchen`. |
| 22 | By type + persists over reload | Pass | Groups Produce, Meat & seafood, Dairy & eggs, Sauces & condiments; By type still pressed after reload. (09) |
| 23 | Search "fish" | Pass | "1 match". |
| 24 | Clear search | Pass | Clear search works. |
| 25 | Settings | Pass | Account, Kitchen ("Shared with Levi"), Allergies and preferences (Levi's: "Added by you, needs Levi to confirm"), Your data, Privacy and terms. (10) |
| 26 | Reload → chat history and saved "Those are gone" (release item 1) | Pass | Full history there; eggs receipt still "Added eggs (2 batches) / Eggs: those are gone (1 batch left) / Undo", Undo label unchanged. Same after a second reload. (11, 13) |
| 27 | End state | Pass | (12) |

**Total: 26 pass, 0 fail, 1 blocked (of 27).** No browser console errors.

## Felt wrong (passed anyway, all known)
- Curry reply still says "Here's a recipe" twice.
- "You also had eggs from Oct 15." when that's today.
- On a phone, Done shopping collapses the Kitchen widget, so you don't see garlic and ginger arrive without tapping it open.
