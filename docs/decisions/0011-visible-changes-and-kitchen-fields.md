# 0011 — What the user sees changing, and what the kitchen records

**Status:** Accepted · 2026-10-13 · Decided by Vero

## Decision
- **"What changed" is shown** after each message that changes the kitchen, for example "Added eggs, spinach · Chicken → freezer · Undo". It sits with the assistant's reply. There is no full history screen in MVP 1, but the full history is always stored.
- **Only the item name is required.** Quantity, unit, storage location (fridge / freezer / pantry), date added and frozen/opened are saved when the user mentions them and stay *unknown* otherwise.
- **Unknown items:** if the user mentions using something the kitchen never heard about, the assistant records it without asking and mentions it briefly in "What changed".
- **"Out" items (K2, 2026-10-14):** an item marked Out **drops off the Kitchen list** but stays in history, so the assistant still knows "you ran out of eggs on Tuesday". "Running low" items stay listed with a **Low** label.
- **Auto-Out (K4, 2026-10-14):** using up the full measured amount (2 lbs used of 2 lbs) marks the item Out automatically, with "What changed" and Undo.
- **Food age:** the Kitchen widget shows "added X days ago" when the date is known. No freshness prediction.
- **Defrosted food (DF1, 2026-10-15):** defrosting moves an item from the Freezer to the **Fridge**, as *inferred*, unless the user says where (for example the **Counter**, 0030).


> **Changed by [0041](0041-infer-storage-place.md) (2026-10-15):** storage place is now inferred when not said.
