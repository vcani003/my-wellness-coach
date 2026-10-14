# 0027 — The Shopping list is in MVP 1

**Status:** Accepted · 2026-10-14 · Decided by Vero after the first real test (resolves T2)

## Why
On the first grocery test, Vero gave Kitchen her list and "it took my list and did nothing with it". The app only tracked what's *in* the kitchen, so a list could only be answered in chat and was then lost. A list you can keep and tick off is core to the kitchen job, not a nice-to-have.

## Decision
- A **Shopping list widget** joins MVP 1 as the 5th widget (it extends 0004). It belongs to the **shared kitchen**, so Vero and Levi see and tick the same list.
- **Ways things get on it:** saying so in chat ("add fish sauce to the list", "we need eggs", or pasting a whole list), adding a staples answer with one tap, and adding a recipe's "Need" items with one tap.
- **Ticking an item means "got it"**, not bought or used. When shopping is finished, the ticked items can go into the kitchen through the existing "Add to your kitchen?" sheet (0013).
- The details are in OPEN-QUESTIONS **SL1–SL3**, built on the Recs unless Vero says otherwise.

## Approved details (2026-10-14)
- **SL1:** grouped by store, plus "Anywhere". **SL2:** Done shopping → the "Add to your kitchen?" sheet. **SL3:** Out/Low only *offers* to add to the list.
- **SL4:** ticks work offline. They're saved on the phone, marked "Not synced yet", and sync when the signal returns. Everything else stays read-only offline (0017).
- **SL5:** "I bought garlic" in chat adds it to the kitchen and takes it off the list in one change set, with one Undo.

