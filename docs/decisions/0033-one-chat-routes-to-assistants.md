# 0033 — One chat; the AI routes to the right assistant

**Status:** Accepted · 2026-10-15 · Decided by Vero (AS1a). Context, not current scope: MVP 1 has only Kitchen.

- **You never choose an assistant to talk to.** There is one chat. When Fitness Coach or Health Tracker exist, the AI works out which assistant a message is for, and a message can involve more than one (for example, "had chicken for dinner" may matter to Kitchen and Health).
- **The workspace follows the conversation.** The widget for whatever you just talked about comes into focus, as the phone already does today ("the widget that changed opens").
- **No assistant switcher.** Looking at another area (for example a Fitness widget) is browsing the workspace, not picking who to talk to.
- **Nothing is built now.** Routing is the main work when a second assistant is planned (see the code-sectioning check, 2026-10-15: `src/ai/turn.ts` and the interpreter only know Kitchen today). Until then Kitchen is the only assistant, so every message goes to it.
