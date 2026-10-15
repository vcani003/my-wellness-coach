# 0037 — The repo goes public as it is, with no history rewrite

**Status:** Accepted · 2026-10-15 · Decided by Vero (GH3). Replaces the plan in `plans/history-rewrite.md`.

- **No history rewrite and no separate public copy.** Vero's commit email is already public on her other repos. The names, allergy and stores in the docs are example data she provided.
- **Secrets check, 2026-10-15:** a pattern scan of every revision (API keys, database URLs with passwords, private keys, GitHub tokens, `.env` files) found only dummy test values. Every version of `.env.example` has empty fields. Real keys live in git-ignored files.
- **From now on,** docs, tests, screenshots and mockups use fictional people (Ana, Ben) and generic stores.
- **Flipping the repo to public** is an outward-facing step: it happens on Vero's go, or she does it herself in GitHub settings.
