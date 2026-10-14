# 0021 — Two tester agents, two test kitchens

**Status:** Accepted · 2026-10-14 · Decided by Vero (B14)

## Decision
- **Two tester agents** (AI testers that use the real app like a person would), both on **staging**, never on the live app.
- **Two test kitchens:**
  1. **Single-person kitchen:** one tester runs the full primary journey (0005).
  2. **Multi-person (household) kitchen:** both testers share it. These tests are **limited**: they only check that core shared functionality isn't broken. For example: one adds an item and the other sees it; ticks are shared; you can only Undo your own changes; allergies are considered across members.
- **Hand-off:** both kitchens' tests must pass **before** a build goes to Vero and her husband to use.
- **Accounts:** up to **4** (Vero, husband, 2 testers). This replaces the "max 3" in 0006. Tester accounts are restricted to test kitchens.
