# 0054: Smart staples

**Status:** Accepted · 2026-10-16 · Decided by Vero (SS1–SS7: "go with recs"). Plan: [plans/smart-staples.md](../plans/smart-staples.md). Builds on [0027](0027-shopping-list-in-mvp.md) and [0012](0012-allergies-and-preferences.md).

- **SS1. One staples list for the whole kitchen**, shared like the shopping list.
- **SS2. Staples are learned only when said, said yes to or tapped.** They're never guessed from buying. Staples saved in the old free-text preference line are offered back once, and nothing moves without a tap.
- **SS3. Restock pre-selects Out, Low and not in the kitchen.** Some and Plenty are shown unselected, and items already on the list are muted. One Restock is one change set with one Undo.
- **SS4. When a staple runs low or out, the app offers to add it and never adds it automatically.** Every Out/Low receipt gets the one-tap "Add X to my list" button (SL3).
- **SS5. A staple remembers its usual store** only when said or picked. Otherwise it's Anywhere, or grouped by aisle after KOS9. No amounts are stored.
- **SS6. "What staples do I need?"** is answered from the saved staples (computed by code), with an Add button. Lumi's general guess is used only when there are no saved staples yet, and it still leaves out members' allergens.
- **SS7. Built right after KOS4** ([0053](0053-kitchen-os-build-order.md)).
- **SS8. "Offered once"** means the old "Staples:" line is offered until you tap Add them or Not now. After that it's never shown again, even after an Undo of Add them.
- **SS9. The "Add these to my list" button under a staples answer** isn't kept when the chat reloads, but typing "yes" still works. Saving it with chat history would be a later follow-up.
- **SS10. Out/Low in chat offers once.** When the receipt shows the "Add X to my list" button, Lumi no longer asks the same thing in her reply. This is a prompt change that ships with the staples UI.

SS8–SS10: Vero, "go with recs", 2026-10-16.
- **SS11. The "You told me these before" offer** shows at the top of the Restock sheet whenever there are names to offer, not only when the list is empty. It still shows only until Add them or Not now.
- **SS12. With no staples yet,** the sheet opens on the Edit view ("Edit staples"), with the empty message and the Add field.
- **SS13. The Restock receipt groups by store** ("On your list, Anywhere: eggs, jasmine rice"), matching the list itself.
- **SS14. Out/Low from the after-cooking sheet gets its "Add X to my list" button** when KOS13 restyles the cook steps and adds a receipt there.

SS11–SS14: Vero, "go with recs", 2026-10-16.
