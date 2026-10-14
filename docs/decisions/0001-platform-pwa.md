# 0001 — MVP platform: Progressive Web App

**Status:** Accepted · 2026-10-13 · Decided by Vero

## Decision
The MVP ships as a Progressive Web App (PWA): a website designed phone-first that can also be added to the home screen and opened like an app.

## Why
It's the fastest way to get the journey in front of testers. You share a link, with no app store review and no separate iPhone and Android builds.

## Consequences
- The layout is designed phone-first and also works on desktop (spec §2 and §7).
- No Siri integration, which is out of scope anyway (§10). If a native app is needed later, the backend and event model carry over unchanged. Only the frontend would change.
- On iPhone, some PWA features (like notifications) only work after the app is added to the home screen. The MVP doesn't need them.
