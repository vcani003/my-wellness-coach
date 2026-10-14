# Tester re-run: scenario `single`, 2026-10-14 (before deploy)

Target: local preview `http://localhost:3000` (stand-in AI, demo kitchen), tab "seed", acting as Vero (tester A), phone size 375×812. Reset with the dev bar first. Re-checks the failures and "felt wrong" items from `../2026-10-14-single/results.md`, and adds See all (By place | By type, search).

| # | Step | Result | What I did → what I saw |
|---|---|---|---|
| 1 | Reset → empty state | Pass | "Your kitchen is empty. Tell me what you've got."; chips "I bought…", "I froze the…", "We're running low on…"; composer in dock. (01) |
| 2 | Bought | Pass | "I bought eggs, chicken thighs, spinach and yogurt" → "All set: added eggs, chicken thighs, spinach, and yogurt."; receipt with 4 lines + Undo; all 4 "New"; composer kept focus. |
| 3 | Froze → Freezer | Pass | "I froze the chicken thighs" → "All set: moved the chicken thighs to the freezer." / "Chicken thighs → freezer"; chicken under **Freezer**, "Updated". (Grammar fixed.) |
| 4 | Undo | Pass | Undo → line struck through, "Undone"; chicken back under "Not sure where". |
| 5 | **Re-check:** undone receipt after reload | **Pass** (was Fail) | Reloaded right after Undo: receipt still struck through and "Undone", no Undo button. Still so at the end-of-run reload. (02) |
| 6 | List grouped by store | Pass | "add garlic and ginger to the list for MD Oriental" → "On your list: garlic and ginger." / "On your list, MD Oriental: garlic, ginger"; "MD ORIENTAL · 2". |
| 7 | Tick | Pass | Ticked both → "2 · 2 got", nothing moved, **Done shopping** appeared. |
| 8 | Done shopping → Kitchen; **re-check:** no duplicate "list is clear" | **Pass** (was felt-wrong) | Sheet "Add to your kitchen? / From your shopping list", GOT IT garlic + ginger → **Add 2 items** → "Added 2 to your kitchen. Your list is clear." + Undo, shown **once** (the only other copy is the screen-reader status). Kitchen 6 items incl. garlic, ginger. (03) |
| 9 | "What can I make tonight?" → ideas | Pass | 3 cards (Chicken thighs / Eggs / Spinach rice bowl) with why, Uses, Missing, Choose; basics note; Meal ideas on top. |
| 10 | Choose → recipe | Pass | Recipe: "Suggested recipe", "Use my own recipe", basics note, IN YOUR KITCHEN checklist, steps, dock visible. |
| 11 | Curry phrase → recipe with Need | Pass | "Chicken curry it is. I added potatoes. Here's a recipe."; IN YOUR KITCHEN chicken thighs, potatoes; NEED coconut milk, lemongrass; "Add Need items to shopping list". |
| 12 | Add to plan | Pass | → "In your plan". |
| 13 | Start cooking → Done cooking | Pass | "Cooking", button becomes **Done cooking**. |
| 14 | Update your kitchen (Low / Out / note) | Pass | "Update your kitchen · Cooked: Chicken thighs rice bowl"; Still have some / Running low / Out + note; Running low + "used half" → "Updated your kitchen after Chicken thighs rice bowl: 1 running low." + Undo. (04) |
| 15 | Kitchen reflects it | Pass | Chicken thighs "Running low". |
| 16 | 2 batches; **re-check:** one Undo per receipt, "1 batch left" | **Pass** (was felt-wrong) | "I bought eggs" → "Added eggs (2 batches)", "You also had eggs from Oct 14.", **Still have them · Those are gone**. Tapped Those are gone → line "Eggs: those are gone (1 batch left)", **one** Undo in the receipt. (05) |
| 17 | "the old eggs are gone" (phrase) | Pass | After a third "I bought eggs": "Got it: marked the older eggs as gone." / "Eggs: those are gone (1 batch left)". |
| 18 | **Re-check:** defrosted → Fridge | **Pass** (was felt-wrong) | "I defrosted the chicken thighs" → "Noted: marked the chicken thighs as defrosted."; chicken now under **Fridge**, tagged "Defrosted". (06) |
| 19 | Category correction | Pass | "I bought fish sauce", then "fish sauce goes under sauces" → "Done: the fish sauce is under Sauces & condiments now." / "Fish sauce → Sauces & condiments" + Undo. Also "I bought nước mắm" → "All set: added nước mắm." |
| 20 | See all from the widget | Pass | "See all (9)" → `/kitchen`, "Your kitchen", focus on the heading; search field, **By place** pressed. |
| 21 | By type groups | Pass | By type → caption "Kitchen sorted these itself. To move one, tell me in chat, like “fish sauce goes under sauces”." Groups Produce, Meat & seafood, Dairy & eggs, **Sauces & condiments** (Nước mắm, Fish sauce); rows show "· Not sure where" / "· Fridge". (07) |
| 22 | Toggle persists across reload | Pass | Reloaded `/kitchen`: **By type** still pressed. |
| 23 | Search "fish" | Pass | "2 matches": Nước mắm (via gloss, unmarked) and **Fish** sauce (marked). (08) |
| 24 | Search "nuoc mam" | Pass | "1 match": Nước mắm, both words marked. (09) |
| 25 | Clear | Pass | **Clear search** button empties the field, keeps focus, restores the groups; Esc does the same. "No matches for “…”" + "Try another word, or ask Kitchen in chat." also seen. Back returns to the Kitchen with focus on "See all (9)". |
| 26 | Settings sections render | Pass | Account, Kitchen ("Shared with Levi"), Allergies and preferences (Levi's seafood allergy "Added by you, needs Levi to confirm"), Your data, Privacy and terms. |
| 27 | "Send sign-in setup link" | Blocked (by design) | "Sign-in links aren't available in test kitchens." Needs a non-test kitchen. |
| 28 | Reload → chat history as it was | **Fail** (new, minor) | Full history and kitchen state are there, and the undone receipt is right. But the first repeat-eggs receipt lost its "Eggs: those are gone (1 batch left)" line after the reload: it now reads only "Added eggs (2 batches)", and its Undo is now labelled "Undo: Added eggs (2 batches)" (before the reload it was "Undo: Eggs: those are gone (1 batch left)"). So the tap on **Those are gone** leaves no trace in the history, and Undo's meaning seems to change on reload. (05 before, 10 after) |

**Total: 26 pass, 1 fail, 1 blocked (of 28).** All five re-checks pass.

## Felt wrong (passed anyway)
- Curry reply still says "Here's a recipe" twice ("…Here's a recipe." then "Here's a recipe for Chicken curry.").
- "You also had eggs from Oct 14." when that's today.
- See all on a phone: with the dock in Peek, it covers the lower half, so only one or two rows of the list show. I minimized the dock to see the groups; after a reload the dock was back in Peek.
- Next.js dev "N" badge and a "Rendering…" toast cover the start of the composer (dev only).

Screenshots: `01`–`11` in this folder.
