# 0020 — AI budget and model

**Status:** Accepted · 2026-10-14 · Decided by Vero

- **Budget (C2):** a **$40/month hard limit** ($30 production + $10 staging). **Target about $20/month** by the end of the first month, measured from real usage logs, not estimates.
- **Model:** Claude Opus 5.5 for now. **No cheaper model for re-wording replies (AI5)**: the saving is under $1/month and one model is simpler.
- **The model is a server setting per task** (interpreting, meal ideas, recipes), never a user-facing choice. Changing it needs no code change. Whether to *test* a cheaper model for some tasks is OPEN-QUESTIONS **C10**.
- **Name and voice (B10):** the assistant is called **"Kitchen"** for MVP 1. Its voice is warm, brief and practical, with no health or diet lecturing and no guilt about food waste. Naming across future assistants is decided later.
