# 0055: Stock level details (KOS4)

**Status:** Accepted · 2026-10-16 · Decided by Vero (KOS4-a to KOS4-c: "go with recs"). Refines [0045](0045-kitchen-os-features.md) KOS4.

- **KOS4-a. "Still have some" in the after-cooking sheet** stays a no-change for now. It switches to recording Some with the KOS13 cook-steps restyle.
- **KOS4-b. Buying more clears the level.** The new batch has no level, so the item shows none until someone sets one. This matches how Low already works.
- **KOS4-c. An Out item that's said to be there again** ("there's some rice left") comes back as a new batch with that level, in its old place. It's recorded without asking ([0011](0011-visible-changes-and-kitchen-fields.md)), and it can be undone.
- **KOS4-d. The "Add X to my list" offer on chat receipts** (e.g. "the rice is running low") is built with Smart staples, as [0054](0054-smart-staples.md) SS4 already says. For now, only button receipts have it.
- **KOS4-e. A single batch's level is set by button** in KOS3's edit sheet. Until then, the ⋯ button sets the whole item, and a single batch is set in chat.
