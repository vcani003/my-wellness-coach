# 0016 — Team shape and who makes technical decisions

**Status:** Accepted · 2026-10-13 · Decided by Vero

## Decision
- **Accessibility moves to the Frontend specialist** for now. The team is: UI/UX, Frontend + Accessibility, Backend / Data, and AI / Application Intelligence. UI/UX still designs with familiar, accessible patterns, and Frontend owns making and checking it accessible.
- **Technical decisions are delegated to the specialists.** Vero doesn't need to pick every technology. Specialists decide with a written rationale, weighing **scalability, security, maintainability and libraries**, and prefer choices that are easy to reverse. Vero reviews the architecture as a whole.
- **Stack preference:** use **Next.js** if it fits; React is fine.
- **Uncertainty:** specialists don't assume answers to product questions. Where a design depends on an outstanding question, they design so that either answer works, name the question ID, and accept some risk rather than block.
- `AGENTS.md` is approved (C6). Agents read only the "Outstanding" section of OPEN-QUESTIONS (C8).
