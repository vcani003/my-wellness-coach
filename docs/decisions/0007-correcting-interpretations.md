# 0007 — Correcting AI mistakes: save right away, undo, or fix in chat

**Status:** Accepted · 2026-10-13 · Decided by Vero

## Decision
- The assistant saves what it understood **right away**, with no confirmation step.
- Each change is **shown** to the user, with an **Undo**.
- The user can also **correct it in conversation** ("no, I froze the yogurt").

## Consequences
- Undo and corrections never delete history. They are new events that reverse or amend earlier ones, so the system keeps a record of how its understanding changed (spec §4).
- At least some widget or chat UI must be interactive (the Undo control).
- Asking before saving is still allowed when missing information blocks something useful (spec §6, "avoid interrogation").
