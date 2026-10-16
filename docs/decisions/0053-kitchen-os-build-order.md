# 0053: Build order for the Kitchen OS features

**Status:** Accepted · 2026-10-16 · Decided by Vero (P4 and SS7: "go with recs"). Sets the order that [0043](0043-scope-from-kitchen-os.md) left to Vero. Reorder any time.

Each step is built one at a time on its own branch, and nothing is merged or deployed without Vero's go-ahead.

1. **KOS4:** stock levels plenty / some / low / out
2. **Smart staples** ([0054](0054-smart-staples.md))
3. **KOS16:** ask before removing more than 5 things at once
4. **KOS3:** tap an item to edit it. The unmerged item-actions backend from Epic A (0030/0036) is folded in here, along with the item "Staple" switch.
5. **KOS1:** dated week plan, then **KOS12:** add the week's missing ingredients
6. **KOS6:** History tab
7. **KOS5:** favorites in the recipe box
8. **KOS11:** rename yourself / leave the household
9. **KOS13:** cook-steps restyle
10. **KOS2:** food catalog + estimated use-by, then **KOS9:** shopping list by aisle
11. **KOS8:** the assistant moves the screen and suggests reply chips
12. **KOS7:** offline for all buttons
