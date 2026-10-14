# 0025 — Item batches, and "use it up" ideas

**Status:** Accepted · 2026-10-14 · Decided by Vero (K3, AI8)

## Batches (K3)
- An item can hold **up to 3 batches** (for example older eggs and newer eggs). It's one row on the Kitchen list, showing "2 batches · oldest 12 days". Tapping the row lists the batches, view-only.
- **Buying something you already have adds a batch.** The receipt offers one tap, never a required question: "You also had eggs from Oct 2: **Still have them** · **Those are gone**."
- **A 4th batch closes the oldest one automatically**, so the list never piles up. That change is still a normal event in history (spec §4), and nothing is erased.
- **Using an item takes the oldest batch first**, unless the user names one ("the new eggs").
- **Not in MVP 1:** hand-editing, splitting or merging batches, and expiry dates. These can expand later.

## "Use it up" priority (AI8)
- Meal ideas favour food that needs using up. That's ranked on data we already have: days since added, the oldest batch, **defrosted** (a new "defrosted on" date) and **Low**. The "why" line says so ("Uses the chicken you defrosted yesterday").
- A use-it-up item that's also an allergen **is still suggested, flagged** (0019).
- **Shelf-life prediction stays out of MVP 1** (spec §10). It's a candidate for next: typical shelf-life ranges from USDA FoodKeeper data, shown only as a gentle "use soon" nudge, **never as "safe to eat"**.
- **AI9 (2026-10-14):** only spoilage signals (oldest batch, defrosted, sitting long) can bring a member's allergen dish into unprompted ideas. **Low never does.**
