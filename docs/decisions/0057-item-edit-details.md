# 0057: Item edit details (KOS3)

**Status:** Accepted · 2026-10-16 · Decided by Vero (KOS3-a to KOS3-d: "go with recs"). Refines [0045](0045-kitchen-os-features.md) KOS3, [0030](0030-item-actions.md), [0036](0036-item-action-details.md) and [0041](0041-infer-storage-place.md).

- **KOS3-a. Counter is guessed for counter food** (bananas, avocados, tomatoes and the like) on new adds, the same way other places are inferred ([0041](0041-infer-storage-place.md)). A place that was said or picked always wins.
- **KOS3-b. Renaming an item that's a staple renames the staple too**, in the same change set, keeping its store.
- **KOS3-c. Renaming onto a name you already have is allowed**, and you then have two rows. Merging is revisited after real use.
- **KOS3-d. Moving an item into the Freezer isn't remembered for that name**, because freezing is usually a one-off. Other picked places are remembered.

Also confirmed: anyone in the kitchen can edit any item ([0017](0017-shared-kitchen-and-layout.md)), and Undo stays with the person who edited. A stale edit is refused whole.
