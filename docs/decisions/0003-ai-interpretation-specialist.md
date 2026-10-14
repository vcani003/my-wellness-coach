# 0003 — AI interpretation gets its own specialist

**Status:** Accepted · 2026-10-13 · Decided by Vero

## Decision
AI interpretation and context behavior belong to a separate **AI / Application Intelligence specialist**, not the backend specialist (resolves spec §9 "Ownership still unresolved").

## Split of responsibilities
- **AI specialist:** turns chat messages into proposed kitchen events, decides when to ask for clarification versus leaving things unknown, shapes meal-idea reasoning, owns the test set of example messages, and owns prompt and model choices.
- **Backend / Data specialist:** owns the event store, the current-state model, validation, and the API. Any change the AI proposes must pass backend validation before it is saved.

## Why
Interpretation is the core of this MVP. It needs a dedicated owner and its own quality bar.
