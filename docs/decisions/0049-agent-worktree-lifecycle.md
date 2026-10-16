# 0049: Agent worktree lifecycle and docs-only agents

**Status:** Accepted · 2026-10-15 · Decided by Vero. Procedure: [runbooks/agent-worktrees.md](../runbooks/agent-worktrees.md).

**Why:** in two days, 17 agent worktrees piled up under `.claude/worktrees/` and none were removed after merging. Each code agent's worktree had its own `node_modules` (about 770 MB) and up to three `.next*` builds. Together they took about 9.7 GB, the disk reached 97% full and the Mac had a swap-related kernel panic. One agent's unfinished work was also left uncommitted when its session ended.

- **Finished, integrated worktrees are removed, but only with Vero's approval.** The orchestrator lists the eligible worktrees and the evidence for each, and Vero approves the list. Then the orchestrator runs plain `git worktree remove` on each and `git worktree prune` at the end. Branches are kept.
- **A worktree is eligible only if every check passes:**
  - **Agent state:** the agent has finished and reported back. A worktree whose lock names a live process is active.
  - **Processes:** no process has files open inside it.
  - **Git status:** nothing uncommitted or untracked.
  - **Ignored files:** only disposable ones remain (dependencies, builds, test output, e2e test databases).
  - **Integration provenance:** every commit is recorded as integrated, either as an ancestor of the integration branch, through a recorded trailer, or as a patch-equivalent commit. Identical files alone don't count as proof.
- **If anything is uncertain, the worktree is preserved.** That covers a stale lock (dead process), unexpected files, missing provenance, or an agent that never reported back. The orchestrator reports it and Vero decides.
- **Never automatic, never forced.** No `--force`, no `rm -rf` of a worktree folder, no branch deletion, no unlocking, and no broad permission rule for deleting. Cleanup stays approval-based.
- **Session start only reports.** The orchestrator lists each worktree with its state and size and deletes nothing.
- **Provenance is recorded when work is integrated.** Prefer a real merge. A squash or cherry-pick carries an `Integrates: <branch> @ <full sha>` trailer, or uses `git cherry-pick -x`, so later checks don't rely on comparing file contents.
- **Unfinished work gets a checkpoint.** If an agent's session ends with uncommitted work, it's saved as a local `wip(...)` commit on its own branch, never merged or pushed, plus a bundle in `~/Desktop/code/_archive/`. The first was `ai/idea-refine` @ `0c4417c`.
- **Docs-only agents don't install anything.** For tasks limited to documentation, architecture plans or mockups that don't need the app to run, the specialist doesn't install dependencies, run builds or run tests in its worktree. The orchestrator labels these tasks "docs-only" and handles any checks after integrating.
- **Not decided here:** sharing or cloning `node_modules` between worktrees (APFS clones, symlinks). That needs a separate evaluation first.
