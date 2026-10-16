# Runbook: agent worktrees

For the orchestrating agent. The rules come from [decision 0049](../decisions/0049-agent-worktree-lifecycle.md). Agent worktrees live in `.claude/worktrees/agent-<id>/` on branches named `worktree-agent-<id>`, or on a named branch.

**The golden rule: if in doubt, preserve.** Never use `--force`, `rm -rf` a worktree, delete a branch, unlock a worktree, or use a bare `git stash`.

## 1. At session start: report only
Run `git worktree list`. For each agent worktree, report:

| Worktree | Branch @ sha | State | Uncommitted | Integrated? | Size |
|---|---|---|---|---|---|

State is one of:
- **active:** a live lock or process
- **finished:** the agent reported back
- **stale lock:** the lock's process is dead
- **unknown**

Don't remove anything at session start.

## 2. When assigning work
- If a task only touches docs, architecture plans or mockups, say **docs-only** in the brief. The specialist then doesn't install dependencies, run builds or run tests.
- If a task needs code checks, the specialist installs in its own worktree as usual.

## 3. When integrating an agent's branch
- **Prefer a real merge.** That keeps ancestry, so the check in §4 is automatic.
- **For a squash or cherry-pick,** use `git cherry-pick -x`, or end the commit message with `Integrates: <branch> @ <full sha>` (one line per source commit or branch tip).
- **If the agent's session ended with uncommitted work,** don't integrate it. Checkpoint it instead:
  1. Inspect the files. No secrets, local databases or generated output.
  2. `git add -- <the listed files>` (not `-A` blindly).
  3. `git commit -m "wip(<area>): <what>, unverified, do not merge"`
  4. `git bundle create ~/Desktop/code/_archive/<branch>-<sha>.bundle <branch>`, then `git bundle verify` it.

## 4. Cleanup eligibility: every check must pass
`<wt>` is the worktree path, `<int>` the integration branch it was merged into.

1. **Agent state.** The agent has finished and reported back. Check the lock with `cat .git/worktrees/<name>/locked`. If the pid in it is alive (`ps -p <pid>`), the worktree is active: **skip it**. If the pid is dead, it's a stale lock: **preserve and report**.
2. **Processes.** `lsof +D <wt>` prints nothing.
3. **Git status.** `git -C <wt> status --porcelain` is empty.
4. **Ignored files.** `git -C <wt> status --porcelain --ignored | grep '^!!'` lists only these: `node_modules/`, `.next/`, `.next-e2e/`, `.next-e2e-auth/`, `test-results/`, `tsconfig.tsbuildinfo`, `next-env.d.ts`, `.data/` (only if it holds nothing but `pglite-e2e*`). Anything else (`.env*`, other data, notes) means preserve and report.
5. **Provenance.** For every commit in `git rev-list <int>..<wt-HEAD>`, at least one of these holds:
   - the whole tip is an ancestor: `git merge-base --is-ancestor <wt-HEAD> <int>`;
   - a recorded trailer names it: `git log <int> --grep=<sha>` finds `Integrates:` or `cherry picked from commit`;
   - a patch-equivalent commit is in `<int>`: `git cherry <int> <wt-HEAD>` marks it `-`.

   If only "the files are identical" holds, the result is **uncertain**: preserve it, and list it separately for Vero to approve on its own.

## 5. Removing (after Vero approves the exact list)
1. Show Vero the list: path, branch @ sha, the evidence for each check, and size. Wait for approval.
2. Re-run §4 straight away. Skip anything that changed.
3. Run `git worktree remove <wt>` one at a time. If git refuses, **stop and report**; don't add `--force`.
4. Run `git worktree prune -v`.
5. Check: `git worktree list`, that the branches still exist, and `df -h /System/Volumes/Data`.

Auto mode blocks `git worktree remove`. That's expected: approve each removal when asked. Don't add a permission rule for it, because a prefix rule would also allow `--force`.
