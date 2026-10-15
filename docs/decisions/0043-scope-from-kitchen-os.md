# 0043: Build the backend for Kitchen OS features this app lacks

**Status:** Accepted · 2026-10-15 · Decided by Vero. Reopens parts of [0008](0008-meal-plan-depth.md), [0013](0013-meal-lifecycle.md), [0017](0017-shared-kitchen-and-layout.md), [0020](0020-ai-cost-and-model.md), [0025](0025-batches-and-use-it-up.md), [0029](0029-invites-and-passphrases.md) and [0035](0035-future-assistants-and-name.md). Each one changes only once its KOS question is answered.

- **The Kitchen OS screens show features this app has no backend for. They are built, not dropped.**
- **Each feature is its own question in [OPEN-QUESTIONS](../OPEN-QUESTIONS.md):** KOS1–KOS6 and KOS8–KOS16. KOS7 is already answered in [0044](0044-offline-for-buttons.md). Each answer becomes a decision record.
- **A feature's backend is built only after its question is answered.** One milestone per feature, in the order Vero sets.
- **Until a feature's backend exists, its screen parts stay hidden.** No part of the UI pretends to work.
- **The first deliverable is the UI swap on today's backend, with no scope change.** It proves the new UI plugs into the existing core.
- **Reuse recipe-cat's backend where it's an easy lift** (Vero, 2026-10-15). That means pure, self-contained code: the food catalog (shelf life, aisle, emoji), the freshness and date helpers, and the AI safety rules (more than 5 removals asks first; plan dates from yesterday to 21 days ahead). Its world model, sync server, households, Lumi agent loop and push/timers are tied to its phone-first design, so those are rebuilt on this app's core instead.
