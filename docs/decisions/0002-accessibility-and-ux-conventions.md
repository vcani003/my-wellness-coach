# 0002 — Accessibility target and UX conventions

**Status:** Accepted · 2026-10-13 · Decided by Vero

## Decision
- **Accessibility target:** WCAG 2.2 AA. We build it in from the start, but in proportion to the MVP. It is a guide we iterate toward, not a heavy gate.
- **UX conventions:** prefer the most common, familiar patterns people already know from chat and messaging apps over novel interactions.

## What "in proportion" means for the MVP
The basics are built in from day one: proper labels, keyboard and screen-reader-friendly chat, readable contrast, tap targets big enough for fingers, and widget changes announced to screen readers. We won't spend MVP time on a formal audit or polishing edge cases. Those come in later iterations.

## Why
Accessibility stays first-class (spec §7) without slowing down the first test. Familiar patterns make the app easier to use and also tend to be more accessible.
