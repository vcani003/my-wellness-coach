# Tester run: scenario `single`, 2026-10-14

Target: local preview `http://localhost:3000` (stand-in AI, demo kitchen), acting as Vero (tester A), phone size 375×812. Reset with the dev bar first.

| # | Step | Result | What I did → what I saw |
|---|---|---|---|
| 1 | Reset → empty state | Pass | Reset → "Your kitchen is empty. Tell me what you've got."; suggestions "I bought…", "I froze the…", "We're running low on…"; composer in dock. (01) |
| 2 | Bought | Pass | "I bought eggs, chicken thighs, spinach and yogurt" → "All set: added eggs, chicken thighs, spinach, and yogurt." receipt with 4 lines + Undo; Kitchen shows all 4 "New"; composer kept focus. |
| 3 | Froze → Freezer | Pass | "I froze the chicken thighs" → "Chicken thighs → freezer"; chicken under **Freezer**, "Updated". |
| 4 | Undo | Pass | Undo → receipt struck through, "Undone"; chicken back under "Not sure where". (Re-froze it afterwards.) |
| 5 | List grouped by store | Pass | "add garlic and ginger to the list for MD Oriental" → "On your list, MD Oriental: garlic, ginger"; Shopping list on top, "MD ORIENTAL · 2". |
| 6 | Tick | Pass | Ticked both → struck through, "2 · 2 got", nothing moved, **Done shopping** appeared. |
| 7 | Done shopping → Kitchen | Pass | Sheet "Add to your kitchen? / From your shopping list", GOT IT garlic + ginger pre-selected → **Add 2 items** → "Added 2 to your kitchen. Your list is clear." + Undo; Kitchen 6 items incl. garlic, ginger. (02) |
| 8 | "What can I make tonight?" → ideas | Pass | 3 cards (name, why, Uses, Missing, Choose); Meal ideas on top, Kitchen a bar; basics note. Placeholders too quick to see. |
| 9 | Choose → recipe | Pass | Recipe page: "Suggested recipe", "Use my own recipe", basics note, IN YOUR KITCHEN checklist, steps, dock visible. Curry phrase also gave a recipe with IN YOUR KITCHEN + NEED groups and "Add Need items to shopping list". |
| 10 | Add to plan | Pass | Button → "In your plan". |
| 11 | Start cooking → Done cooking | Pass | "Cooking" label, button becomes **Done cooking**. |
| 12 | Update your kitchen (Low / Out / note) | Pass | Sheet "Update your kitchen · Cooked: Chicken thighs rice bowl"; Still have some / Running low / Out + optional note; chose Running low + note → "Updated your kitchen after Chicken thighs rice bowl: 1 running low." + Undo. (03) |
| 13 | Kitchen reflects it | Pass | Chicken thighs shows "Running low". |
| 14 | 2 batches | Pass | "I bought eggs" again → "Added eggs (2 batches)", "You also had eggs from Oct 14." **Still have them · Those are gone**; row "2 batches · oldest added today". Both "the old eggs are gone" and the button tap work. (04) |
| 15 | Defrosted | Pass | "I defrosted the chicken thighs" → "Chicken thighs: defrosted"; next ideas: "Uses the chicken thighs (defrosted today)". |
| 16 | Settings sections render | Pass | Account, Kitchen, Allergies and preferences (Levi's seafood allergy "Added by you, needs Levi to confirm"), Your data, Privacy and terms. |
| 17 | "Send sign-in setup link" → sheet with Copy | Blocked (by design) | No button. Kitchen section says "Sign-in links aren't available in test kitchens." The demo kitchen is a test kitchen, and a unit test expects exactly this. Needs a non-test kitchen to check. (05) |
| 18 | Reload → chat history | **Fail** (partial) | Full history and kitchen state are there; Meal ideas gone (expected). But the undone freeze receipt now shows a ✓ "Chicken thighs → freezer" with no "Undone" and no strikethrough, so it reads as if it's still in effect. (06) |

**Total: 16 pass, 1 fail, 1 blocked (of 18).**

## Felt wrong (passed anyway)
- Grammar: "the chicken thighs **is** in the freezer now", "the older eggs **is** gone", "the chicken thighs **is** defrosted".
- Defrosted chicken stays under **Freezer** (tagged "Defrosted"), which reads oddly.
- "Eggs: those are gone (1 left)" reads like 1 egg, not 1 batch. "You also had eggs from Oct 14" when that's today.
- Tapping "Those are gone" adds a second line and a second **Undo** in the same receipt (two Undo buttons stacked).
- After Done shopping, "Your list is clear" shows twice (banner + empty state).
- Curry reply says "Here's a recipe" twice.
- The Next.js dev "N" badge covers the start of the composer and "Do later" (dev only).
- The browser tool's screenshots were sometimes stale; checks used page text.
