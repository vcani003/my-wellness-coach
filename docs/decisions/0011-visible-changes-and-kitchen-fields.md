# 0011 — What the user sees changing, and what the kitchen records

**Status:** Accepted · 2026-10-13 · Decided by Vero

## Decision
- **"What changed" is shown** after each message that changes the kitchen, for example "Added eggs, spinach · Chicken → freezer · Undo". It sits with the assistant's reply. There is no full history screen in MVP 1, but the full history is always stored.
- **Only the item name is required.** Quantity, unit, storage location (fridge / freezer / pantry), date added and frozen/opened are saved when the user mentions them and stay *unknown* otherwise.
- **Unknown items:** if the user mentions using something the kitchen never heard about, the assistant records it without asking and mentions it briefly in "What changed".
- **Food age:** the Kitchen widget shows "added X days ago" when the date is known. No freshness prediction.
