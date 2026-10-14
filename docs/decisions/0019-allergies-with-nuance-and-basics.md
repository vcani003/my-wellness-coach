# 0019 — Allergies with nuance, and assumed basics

**Status:** Accepted · 2026-10-14 · Decided by Vero. Extends 0010 and 0012.

## Allergies (AI1)
- **Every member's allergies are always considered** in the shared kitchen, whoever is asking. Diets and preferences apply only to whoever is asking.
- **Allergies can carry nuance in the person's own words.** Use case: *Levi is allergic to seafood but likes crab and shrimp. He can eat them if his medicine is available. It should always be considered regardless.*
  - The profile stores the allergy plus the person's own note (for example "can eat shellfish if medicine is on hand").
  - A meal or recipe containing an allergen is **always flagged** with a **small allergen badge or icon** (plum, 0024). Tapping it shows whose allergy it is plus their own note ("Contains shrimp: Levi's seafood allergy. Medicine on hand?"). It stays consistent and quiet, never alarming (Vero, C10: Levi is relaxed about it, but the app must always be aware).
  - **The flag is computed by code, not the AI model,** so it's consistent whichever model is in use. Allergy handling is **not the main criterion** for choosing chat models (C10), and only a modest effort goes into it in MVP 1.
  - **The assistant never gives medical advice** (no dosing, no "it's safe"). It only reflects the person's own note.
  - **Unprompted meal ideas leave allergen dishes out (AI6 = a).** If someone asks for one directly ("shrimp tacos?"), it's allowed and flagged with the reminder. Whether a *use-it-up* allergen item is still suggested is OPEN-QUESTIONS **AI8**.
- **Saving another member's allergy (AI7):** Vero can tell Kitchen about Levi's allergy. Kitchen asks "Save this to Levi's profile?", and if yes it's **considered right away** and shown as "Added by Vero". **The next time Levi opens the app, Kitchen asks him to verify it**: keep, edit the note, or remove. Only Levi can change or remove it.
- Allergies are still **saved only when stated, never inferred** (0012).

## Assumed basics (AI3)
The assistant may assume you have: **salt, pepper, cooking oil, water, and dried herbs and spices.** Everything else counts as "Need" unless it's in the kitchen. A reminder is shown whenever a meal relies on an assumed basic (0010).
