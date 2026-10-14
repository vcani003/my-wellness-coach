# 0023 — Specialists saved as reusable agents; the build begins

**Status:** Accepted · 2026-10-14 · Decided by Vero. Replaces C5 ("not now").

## Decision
- **The architecture is approved (ARCH1).** Building starts with the specialists' plans, step by step. Nothing is pushed or deployed without Vero's go-ahead.
- **The four specialists are saved as project agents** in `.claude/agents/`: `ux`, `frontend`, `backend`, `ai`. Every future session uses the same briefs. Each brief points to the docs rather than copying them, so it stays current.
- **The build order is decided with Vero.** After each milestone, the orchestrator asks what's next through OPEN-QUESTIONS (P-questions).
- **First milestone:** the backend foundation (project skeleton, event store, kitchen state, contract validation and tests), alongside UX's calm visual direction.
