# 0020 — AI budget and model

**Status:** Accepted · 2026-10-14 · Decided by Vero

- **Budget (C2, revised by C12 on 2026-10-14):** the Anthropic spend limit starts at **$10/month** and is raised toward the **$20/month target** only if real usage shows a need. The original $40 was a ceiling, not expected spend. Each message costs about 3–6¢, and every call logs its real cost.
- **Per-person message limit:** 60 an hour, **100 a day** (C12), so a bug can't drain the cap.
- **Model:** Claude Opus 5.5 for now. **No cheaper model for re-wording replies (AI5)**: the saving is under $1/month and one model is simpler.
- **The model is a server setting per task** (interpreting, meal ideas, recipes), never a user-facing choice, and changing it needs no code change.
- **Switching tasks to a cheaper model (C10):** decided by tests, never on Vero and Levi. When the real AI exists, each task's test set runs on Opus and Sonnet. A task moves to Sonnet only if it scores as well. Ideas and recipes also get Vero's blind side-by-side taste test. **Interpreting stays on Opus** in MVP 1.
- **Build agents (C11):** Opus for core code, Sonnet for mechanical jobs (doc syncing, simple edits). The orchestrator notes which model each task used. **If Vero flags a problem traced to a cheaper model, she's told; after a few or consistent misses, that kind of task goes back to Opus.**
- **Name and voice (B10):** the assistant is called **"Kitchen"** for MVP 1. Its voice is warm, brief and practical, with no health or diet lecturing and no guilt about food waste. Naming across future assistants is decided later.
- **When the budget runs out (N1, 2026-10-14):** Kitchen shows a calm, specific message instead of a generic error: "Kitchen's AI budget for this month is used up. It resets on the 1st. Your kitchen and list still work." Buttons, ticks and the list keep working. **Later:** a quiet heads-up at about 80% of the monthly budget, based on the cost logs.

