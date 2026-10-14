# 0020 — AI budget and model

**Status:** Accepted · 2026-10-14 · Decided by Vero

- **Budget (C2):** a **$40/month hard limit** ($30 production + $10 staging). **Target about $20/month** by the end of the first month, measured from real usage logs, not estimates.
- **Model:** Claude Opus 5.5 for now. **No cheaper model for re-wording replies (AI5)**: the saving is under $1/month and one model is simpler.
- **The model is a server setting per task** (interpreting, meal ideas, recipes), never a user-facing choice, and changing it needs no code change.
- **Switching tasks to a cheaper model (C10):** decided by tests, never on Vero and Levi. When the real AI exists, each task's test set runs on Opus and Sonnet. A task moves to Sonnet only if it scores as well. Ideas and recipes also get Vero's blind side-by-side taste test. **Interpreting stays on Opus** in MVP 1.
- **Build agents (C11):** Opus for core code, Sonnet for mechanical jobs (doc syncing, simple edits). The orchestrator notes which model each task used. **If Vero flags a problem traced to a cheaper model, she's told; after a few or consistent misses, that kind of task goes back to Opus.**
- **Name and voice (B10):** the assistant is called **"Kitchen"** for MVP 1. Its voice is warm, brief and practical, with no health or diet lecturing and no guilt about food waste. Naming across future assistants is decided later.
