# 0054: Smart staples

**Status:** Accepted · 2026-10-16 · Decided by Vero (SS1–SS7: "go with recs"). Plan: [plans/smart-staples.md](../plans/smart-staples.md). Builds on [0027](0027-shopping-list-in-mvp.md) and [0012](0012-allergies-and-preferences.md).

- **SS1. One staples list for the whole kitchen**, shared like the shopping list.
- **SS2. Staples are learned only when said, said yes to or tapped.** They're never guessed from buying. Staples saved in the old free-text preference line are offered back once, and nothing moves without a tap.
- **SS3. Restock pre-selects Out, Low and not in the kitchen.** Some and Plenty are shown unselected, and items already on the list are muted. One Restock is one change set with one Undo.
- **SS4. When a staple runs low or out, the app offers to add it and never adds it automatically.** Every Out/Low receipt gets the one-tap "Add X to my list" button (SL3).
- **SS5. A staple remembers its usual store** only when said or picked. Otherwise it's Anywhere, or grouped by aisle after KOS9. No amounts are stored.
- **SS6. "What staples do I need?"** is answered from the saved staples (computed by code), with an Add button. Lumi's general guess is used only when there are no saved staples yet, and it still leaves out members' allergens.
- **SS7. Built right after KOS4** ([0053](0053-kitchen-os-build-order.md)).
