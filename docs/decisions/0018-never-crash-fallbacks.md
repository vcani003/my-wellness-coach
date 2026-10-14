# 0018 — Never crash: always fall back safely

**Status:** Accepted · 2026-10-14 · Decided by Vero (raised with H3)

## Decision
A failed lookup, a missing record or an unexpected response must **never crash the app**. Every part degrades on its own and safely:
- **Each widget is isolated.** If one widget fails, it shows its own "Couldn't load, Retry" state, and the chat and the other widgets keep working.
- **Missing or unknown data shows a safe fallback,** for example "Unknown item", "Someone", or "Not sure where", never a blank screen or an error page.
- **Failed actions** (Undo, Choose, a tick) explain themselves in place and leave state unchanged. The backend already applies each change all-or-nothing.
- **When the AI fails,** the chat says so plainly and nothing is saved.
- **Errors are logged** so they can be fixed. Every fixed bug gets a regression test.
