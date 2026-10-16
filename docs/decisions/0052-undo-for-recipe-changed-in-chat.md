# 0052: Undo for a recipe changed in chat

**Status:** Accepted · 2026-10-16 · Decided by Vero (IR5). Completes [0051](0051-refining-meal-ideas-in-chat.md) IR2 ("Undo still applies").

- **A chat edit to a saved recipe shows a "What changed" box with Undo**, e.g. "Updated the curry recipe: removed yogurt · Undo". This applies only to edits of an existing recipe (IR2). A first-time recipe doesn't get one, so the chat stays quiet.
- **Undo is the button** (as in [0007](0007-correcting-interpretations.md)). It brings back the previous recipe version, and the idea card follows it (IR1).
- **Typing "undo" in chat isn't added here.** The real assistant can't undo any change by message today. That would be a separate change, only if wanted.
- **IR6. A single message that changes both the kitchen and a recipe** (e.g. "I'm out of yogurt, take it out of the curry") keeps one receipt, for the kitchen change. The recipe edit in that message has no Undo in chat. This stays as is for MVP 1 and is revisited only if testers hit it (Vero: "go with recs", 2026-10-16). The alternative was one box with both changes.
