# 0057: Item edit details (KOS3)

**Status:** Accepted · 2026-10-16 · Decided by Vero (KOS3-a to KOS3-h: "go with recs"). Refines [0045](0045-kitchen-os-features.md) KOS3, [0030](0030-item-actions.md), [0036](0036-item-action-details.md) and [0041](0041-infer-storage-place.md).

- **KOS3-a. Counter is guessed for counter food** (bananas, avocados, tomatoes and the like) on new adds, the same way other places are inferred ([0041](0041-infer-storage-place.md)). A place that was said or picked always wins.
- **KOS3-b. Renaming an item that's a staple renames the staple too**, in the same change set, keeping its store.
- **KOS3-c. Renaming onto a name you already have is allowed**, and you then have two rows. Merging is revisited after real use.
- **KOS3-d. Moving an item into the Freezer isn't remembered for that name**, because freezing is usually a one-off. Other picked places are remembered.
- **KOS3-e. Moving an item out of the Freezer (defrosting) isn't remembered either**, because it's a one-off like freezing. Canned and processed forms ("canned tomatoes", "tomato paste", "banana chips") always go to the Pantry, never the Counter. Kitchens already sorted keep their current places; only new adds use the Counter guess.
- **KOS3-f. No swipe-to-remove on phone in MVP 1.** Remove in the edit sheet, with Undo, is enough.
- **KOS3-g. Tapping Out while typed edits are unsaved** closes the sheet and drops what was typed. Undo covers the Out.
- **KOS3-h. The edit sheet's helper text** ("Staples show up in Restock staples on your list.", "Saved as soon as you pick it.") is a draft for UX to review.

Also confirmed: anyone in the kitchen can edit any item ([0017](0017-shared-kitchen-and-layout.md)), and Undo stays with the person who edited. A stale edit is refused whole.
