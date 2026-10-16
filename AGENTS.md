# AGENTS.md

Instructions for any AI agent working in this repo.

## Current phase
**Building MVP 1, one milestone at a time** (architecture approved, decision 0023). Build only the milestone the orchestrator assigns; Vero sets the order (OPEN-QUESTIONS P-questions). Specialist briefs are in `.claude/agents/`.

## Who decides
- **Vero is the Product Owner.** She owns product decisions, MVP boundaries, and accepting or rejecting recommendations.
- **The orchestrating agent** is Vero's single point of contact. It briefs the specialists and brings their recommendations back to her.
- **Specialists advise; they don't decide.** The roles are UI/UX, Frontend (which also owns accessibility), Backend / Data, and AI / Application Intelligence (see [0003](docs/decisions/0003-ai-interpretation-specialist.md) and [0016](docs/decisions/0016-team-and-technical-delegation.md)). Never silently redefine a requirement.

## What to read
1. [`docs/epics/kitchen-assistant-mvp.md`](docs/epics/kitchen-assistant-mvp.md): the MVP spec.
2. [`docs/decisions/README.md`](docs/decisions/README.md): a one-line index of every decision. Open a full record only when it's relevant. **Decisions override the spec** where they're more specific.
3. [`docs/architecture/README.md`](docs/architecture/README.md): one-page architecture overview. Open a specialist section only when it's relevant; [`backend-data.md` §6](docs/architecture/backend-data.md) is the single shared contract.
4. [`docs/OPEN-QUESTIONS.md`](docs/OPEN-QUESTIONS.md), "Outstanding" section only: **anything listed there is undecided. Don't assume an answer.**
5. [`docs/product-vision.md`](docs/product-vision.md): background only, never scope.

## Rules
- **Product questions go to Vero, and only through `docs/OPEN-QUESTIONS.md`**, with a stable ID, a status (⛔ / 🟡 / ⚪) and a **Rec** where you have one. Don't make product assumptions.
- **Technical calls are delegated to specialists** ([0016](docs/decisions/0016-team-and-technical-delegation.md)). Make them with a stated rationale, prefer choices that are easy to reverse, and explain them in plain language. Vero reviews the architecture as a whole and can veto anything.
- **An answer becomes a decision record** in `docs/decisions/`, gets added to the index, and the question moves to the "Answered" table.
- **Scope:** don't add features because they'd be useful eventually (spec §12). The out-of-scope list is in spec §10.
- **No pushing or deploying** without Vero's go-ahead.
- **Docs-only tasks don't install anything** ([0049](docs/decisions/0049-agent-worktree-lifecycle.md)). If a task is limited to documentation, architecture plans or mockups and doesn't need the app to run, don't install dependencies, run builds or run tests in your worktree. The orchestrator handles any checks later.
- **Agent worktrees are cleaned up only with Vero's approval** ([0049](docs/decisions/0049-agent-worktree-lifecycle.md), procedure in [`docs/runbooks/agent-worktrees.md`](docs/runbooks/agent-worktrees.md)). At session start, the orchestrator only reports worktree status. Never force-remove, and if in doubt, preserve.
