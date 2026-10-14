# 0015 — Language, units, policies and tester data

**Status:** Accepted · 2026-10-13 · Decided by Vero

## Language and units (B11)
- MVP 1 is **English only**.
- Amounts are kept **as the user says them** ("2 lbs", "half a bag", "500 g"), with no conversion.
- **Translation-ready from day one:** no hard-coded on-screen text, and dates and numbers formatted by locale. This is a cheap technical default that keeps adding languages later small.

## Policies and tester data (B12)
- The account has a **Settings** section with **standard web policy boilerplate** (privacy policy and terms).
- Testers can **see and delete** their data from Settings.
- The boilerplate is a placeholder, not legal review. That's fine for 3 invited users, but it needs real review before any public launch.

## Rough effort to add more languages later (Vero asked)
- **If translation-ready from day one (the plan):** each new language is mostly translating the on-screen text, plus checking that the assistant replies in that language (Claude handles this well). That's days per language, not weeks.
- **The genuinely harder part is ingredient names across languages.** "Espinaca" and "spinach" must be the same item in one kitchen. This is solvable if every item has an internal standard name alongside what the user said, which the event model will already do.
- **Showing amounts in other units** (lbs ↔ g) is a moderate add-on later. It works only for amounts given in real units; "half a bag" stays as said.
- **If *not* prepared from day one:** retrofitting means touching every screen. That's weeks, not days, which is why the cheap preparation is the default.
