# 0012 — Allergies, diets and lasting preferences

**Status:** Accepted · 2026-10-13 · Decided by Vero

## Decision
- **Allergies and dietary restrictions** are saved only when the user states them explicitly ("I'm allergic to peanuts"). Once saved they are always respected in meal ideas and recipes, and they are **never inferred**.
- **Other lasting preferences** are never saved silently. The assistant may offer "Want me to remember that?" and saves only if the user says yes.
- One-off requests ("something Thai tonight") apply to that request only (spec §6).

## Note
Allergies and preferences belong in the **shared user context** (spec §5), because future assistants like Health and Fitness will need them too.
