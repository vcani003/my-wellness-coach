# 0006 — MVP users: Vero + a few invited testers

**Status:** Accepted · 2026-10-13 · Decided by Vero

## Decision
MVP 1 is limited to **4 accounts at most**: Vero, Vero's husband, and **two tester agents** (see [0021](0021-tester-agents.md)). Signup is invite-only.

**Shared kitchen (H1):** Vero and husband share **one kitchen** and each signs in separately. Every change records who made it. The tester agents use their **own separate test kitchens**, so it never touches the real one. Each person gets their own kitchen, saved across sessions and devices. Sign-in uses email login links, so there are no passwords.

## Consequences
- Every event and every piece of state belongs to a user from day one. That's also the "user identity" anchor for the shared context in spec §5.
- A kitchen can have more than one member. Every event records **who** made the change as well as when.
- Testers' kitchen data is personal data, so basic privacy handling applies even at MVP scale.
