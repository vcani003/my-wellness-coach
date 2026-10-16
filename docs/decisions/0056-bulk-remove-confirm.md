# 0056: Asking before removing more than 5 things (KOS16 details)

**Status:** Accepted · 2026-10-16 · Decided by Vero (KOS16-a to KOS16-c: "go with recs"). Refines [0045](0045-kitchen-os-features.md) KOS16.

- **What it does.** When one chat message would remove more than 5 things, Lumi asks first: "Remove them all?", with Yes and No buttons. A yes applies exactly what she listed, as one change with one Undo. Buttons are never held.
- **What counts as a removal:**
  - removed or thrown out
  - used up, or set to Out
  - an older batch marked gone
  - a shopping-list entry removed
  - a staple removed

  These don't count:
  - a use that leaves some, or setting Low, Some or Plenty
  - ticks
  - Done shopping
  - moves and edits
  - Undo
- **KOS16-a. Mixed messages wait as a whole.** If a message removes more than 5 things and also does something else, nothing from it is saved until the yes. That keeps it one change with one Undo, and a "no" means nothing happened.
- **KOS16-b. Strict staleness.** Any kitchen change between the question and the yes cancels the yes, so it never removes something added in the meantime.
- **KOS16-c. An older batch marked gone counts as a removal**, even when newer ones stay.
