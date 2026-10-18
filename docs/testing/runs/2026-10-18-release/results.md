# Release check: scenario `single`, 2026-10-18 (feat/kitchen-os-next)

Target: the running local preview at `http://localhost:3000` (kitchen-preview working tree on `feat/kitchen-os-next`; HEAD was `6b7578b` when this was written), stand-in AI ("Stand-in AI · not Claude" badge shown), demo kitchen, acting as Vero (tester A). Playwright, headless Chromium, phone 375×812, one browser. Started with the dev bar's **Reset**. Per 0059 PF10, steps that need the real AI are recorded as "needs real AI (expected decline)".

## Usual journey

| # | Step | Result | What I did → what I saw |
|---|---|---|---|
| 1 | Reset → empty state | Pass | "Your kitchen is empty / Tell me what you've got, like "I bought eggs, milk and rice"." Chat starts minimized on phone (only the round chat button), per PF3. (01) |
| 2 | Bought | Pass | "I bought eggs, chicken thighs, spinach and yogurt" → "All set: added eggs, chicken thighs, spinach, and yogurt." + 4 "Added …" lines + Undo. Composer kept focus. |
| 3 | Froze → Freezer | Pass | "I froze the chicken" → "All set: moved the chicken to the freezer." / "Chicken thighs → freezer". Kitchen: Freezer › Chicken thighs "Updated". (02, 03) |
| 4 | Undo | Pass | Receipt → "Undone"; chicken back under Fridge. |
| 5 | List grouped by store | Pass | "add garlic and ginger to the list for MD Oriental" → "On your list, MD Oriental: garlic, ginger"; "add oatmilk to the list for Publix" → "Added oatmilk to the shopping list (Publix)". List: "MD ORIENTAL · 2", "PUBLIX · 1". (04) |
| 6 | Tick | Pass | Ticked Garlic and Ginger → "3 · 2 GOT", **Done shopping** appears. |
| 7 | Done shopping → Kitchen | Pass | Sheet "Add to your kitchen? / From your shopping list": GOT IT Garlic ✓, Ginger ✓; NOT TICKED Oatmilk unselected. **Add 2 items** → "Added 2 to your kitchen. 1 thing is still on your list." + Undo. Kitchen: Ginger (Fridge, "New"), Garlic (Pantry, "New"). (05) |
| 8 | What can I make tonight? | Needs real AI (expected decline) | "That needs the real AI (Claude). I'm only the stand-in." Nothing changed. (06) |
| 9 | Choose an idea card | Needs real AI (expected decline) | No cards without the real AI. |
| 10 | Sample recipe | Pass | "make me a sample recipe for curry" → "Here's a sample recipe from the stand-in: a template for trying the screens, not a real recipe." + "Chose Sample recipe (stand-in): Curry". Recipe page: "Suggested recipe", "Use my own recipe", basics note, IN YOUR KITCHEN (Chicken thighs 400 g; Salt/Cooking oil "assumed"), NEED (Onions, Curry paste, Coconut milk, Rice, all with amounts), 7 steps. (07) |
| 11 | Add to plan | Pass (note) | Tapped **Add to plan** → the button and "Plan for a day" disappeared; only a screen-reader announcement "Added Sample recipe (stand-in): Curry to your plan." Nothing visible confirms it on the recipe screen (see "Felt wrong"). Plan tab: NO DAY YET › Sample recipe (stand-in): Curry. (08, 09) |
| 12 | Start cooking → Done cooking | Pass | Plan › Start cooking → "Cooking" + **Done cooking** → sheet "Update your kitchen / Cooked: Sample recipe (stand-in): Curry", Chicken thighs: Still have some / Running low / Out, note field, Done / Do later / Skip. (12) |
| 13 | Update your kitchen (Low + note) | Pass | Running low + "used half the chicken" → "Updated your kitchen after Sample recipe (stand-in): Curry: 1 running low." + Undo. |
| 14 | Kitchen reflects it | Pass | Chicken thighs "Updated … Running low". (13) |
| 15 | Add-to-list offer after "Update your kitchen" | **Fail (minor)** | ux.md §10 / SL3: the Out/Low offer appears "including after 'Update your kitchen'". The cooking receipt has only Undo, no "Add chicken thighs to my list". The chat Low/Out receipts do have it (step 16). (13) |
| 16 | Out / Low in chat | Pass | "the yogurt is running low" → "Yogurt: running low" + **Add yogurt to my list** + Undo. "I used up the spinach" → "Spinach: out" + **Add spinach to my list**; tapping it → "Spinach is on your list." |
| 17 | 2 batches | Pass | "I bought eggs" → "Added eggs (2 batches) / You also had eggs from Oct 18. / Still have them / Those are gone". |
| 18 | Those are gone | Pass | → "Eggs: those are gone (1 batch left)" + one Undo. (22) |
| 19 | Reload → chat history | Pass | After reload, history is there; "Show earlier messages" loads back to the first message; the froze receipt still says "Undone". (23) |
| 20 | End state | Pass | No console errors or page errors in the whole run. (24) |

## New in this release

| # | Step | Result | What I did → what I saw |
|---|---|---|---|
| N1 | Plan a meal for a day (chat) | Pass | "plan the curry for tuesday" → "Done, it's on the plan." / "Moved Sample recipe (stand-in): Curry to Tue, Oct 20" + Undo. (10) |
| N2 | Plan week view | Pass | "THE NEXT 7 DAYS" Sun 18 (TODAY) … Sat 24; Tue 20 shows the curry with "Tue, Oct 20", Start cooking, Cancel; other days "Nothing planned". Before dating it sat under "NO DAY YET / Pick a day on a meal to put it in the week." (09, 10) |
| N3 | "What are we eating this week" | Pass | → "This week: Tue, Oct 20: Sample recipe (stand-in): Curry." |
| N4 | "Add this week's missing ingredients" sheet | Pass | Sheet: "This week's missing ingredients / From meals planned for the next 7 days, and ones with no day yet.", "Dated only" switch, MISSING: Onions, Curry paste, Coconut milk, Rice (each "For Sample recipe (stand-in): Curry", all pre-selected). Unticked Rice → button "Add 3 to my list" → "On your list, Anywhere: onions, curry paste, coconut milk" + Undo. (11) |
| N5 | Undo of N4 | Pass | Undo → "Undone"; list back to Oatmilk only. |
| N6 | "add what we need for this week's meals" (chat) + Undo | Pass | "Added 4 things for this week's meals: onions, curry paste, coconut milk, and rice." + Undo; Undo removed all 4. |
| N7 | Staple by chat | Pass | "I bought milk", "milk is a staple" → "Got it: milk is on your staples now." "eggs and rice are staples" → both saved. |
| N8 | Staple Out → offer | Pass | "we're out of milk" → "Milk: out / Milk is one of your staples · Add to my list" + Undo; nothing added until tapped. (14) |
| N9 | List → Restock staples | Pass | Sheet: NEED Milk "Out" ✓, Rice "Not in yet" ✓; YOU HAVE SOME Eggs "In your kitchen" unselected; "Add 2 to my list", "Edit staples". Added → "On your list, Anywhere: milk, rice". (15) |
| N10 | Undo of Restock | Pass | Undo → "Undone"; milk and rice gone from the list. |
| N11 | Tap item → edit sheet | Pass | "Edit ginger": Name, Amount (optional), How much is left? (Plenty / Some left / Running low / Out, "Saved as soon as you pick it."), Where is it? (Fridge / Freezer / Pantry / **Counter**), category, **Staple** switch, "Remove (added by mistake)". Footer "Done" + disabled "Save". (16) |
| N12 | Rename + place Counter + Undo | Pass | Typing a name → footer becomes Cancel / Save (PF12). "fresh ginger" + Counter + Save → Counter › Fresh ginger "Updated"; "Renamed ginger → fresh ginger / Fresh ginger → counter" + Undo. Undo → Ginger back in Fridge, "Undone". (17) |
| N13 | Level + Staple switch + Undo | Pass | Garlic: Some left (aria-pressed=true, saved at once), Staple switch on → footer a single "Done" (PF12); receipt "Garlic is one of your staples now" + Undo; Garlic shows "Some left". Undo → "Undone". (18) |
| N14 | Remove + Undo | Pass | Yogurt → Remove → confirm "Remove yogurt? / It'll stay in history." Cancel / Remove → "Removed yogurt" + Undo; Undo restored it. (19) |
| N15 | Throw out 6 → ask first, Yes | Pass | "throw out the apples, bananas, bread, cheese, butter and tomatoes" → "That would remove 6 things: apples, bananas, bread, cheese, butter, and tomatoes. Remove them all?" **Yes, remove them** / **No, keep them**. Yes → 6 "Removed …" lines + one Undo; Undo restored all 6. (20) |
| N16 | Throw out 6 → No | Pass | No → "Okay, I didn't remove anything."; still 12 items. (21) |
| N17 | Idea refine / recipe change / recipe question | Needs real AI (expected decline) | "give me a recipe for pad thai" and "how much rice do I need?" → "That needs the real AI (Claude). I'm only the stand-in." "something quicker, no oven please" → the general "Sorry, I didn't catch that. I'm only the stand-in AI…" help text. Nothing changed. |
| N18 | Motion (PF11/PF13/PF16) | Not judged | Headless run; sheets and chat opened and closed correctly, but smoothness/bounce can only be judged by eye on a phone. |

**Total: 33 pass, 1 fail (of 34 judged); 3 expected stand-in declines (steps 8, 9, N17); 1 not judged (motion).** No console errors.

## Felt wrong (passed anyway)
- **Add to plan gives no visible confirmation** on the recipe screen: both plan buttons just vanish (the confirmation is only in a screen-reader announcement). Earlier releases showed "In your plan".
- **Bulk-remove reply copy:** "Done: Removed apples; Removed bananas; Removed bread; …" reads like a log, not Lumi's voice.
- A compound list message ("…for MD Oriental, and oatmilk from Publix") made a store called "MD ORIENTAL, AND OATMILK FROM PUBLIX" and dropped oatmilk. Stand-in parser limit; Undo fixed it.
- Recipe-refine phrasing gets the generic "Sorry, I didn't catch that…" instead of the PF10 "That needs the real AI (Claude)…" line. Harmless, but inconsistent.
- After reload, old receipts all show Undo again (e.g. "Undo: Added milk") although they'd lost it during the session; fine if intended.
- Items show "added today" rather than "New" once another message has been sent.
- Missing-ingredients and Restock both put items under "Anywhere" (no aisle grouping, KOS9 not in this branch, as expected).

Screenshots: `01`–`24` in this folder.
