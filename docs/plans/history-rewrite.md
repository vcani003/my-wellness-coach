# Plan: rewrite git history so the repo can go public (GH3)

**Status:** Not needed · 2026-10-15. Superseded by [0037](../decisions/0037-public-repo-as-is.md): the repo goes public as it is. Kept for reference.

## What's in the history today
- **92 commits.** 84 are on GitHub (`vcani003/my-wellness-coach`: private, 0 forks, 0 pull requests).
- **Every commit's author and committer is `veronicacanido@gmail.com`.** This is the one thing that is definitely personal.
- The names "Vero" and "Levi" and the seafood allergy appear in about 80–145 files across history, including 60 screenshots. Vero says these are **example data she provided**, so they're optional to scrub.
- 12 local branches and worktrees, including 4 finished agent branches not yet merged (Epic A spec, Epic A backend, Epic C, B1 mockups).

## The risk of making it public as it is
- **Email:** bots scrape public GitHub commits for emails within hours, which brings spam and phishing. Once public, it's effectively permanent, because clones and caches outlive any later fix. This is the main risk.
- **Names, allergy and stores:** low, since they're examples. Screenshots show them too.
- **Secrets:** none are in git (keys live in git-ignored files). The plan re-checks this anyway.

## Scope options
| | What changes | Size | Agent time | Your time |
|---|---|---|---|---|
| **A. Email only (Rec)** | Every commit's email becomes your GitHub no-reply address. File contents stay byte-for-byte the same. | Small | ~1–1.5 h, mostly tests | ~15–20 min |
| B. Email + example data | A, plus replacing names in all past files and dropping screenshot folders from history | Medium | ~3 h | ~30 min |

**Rec: A.** The names and allergy are examples, so this is the lowest risk: we can *prove* no code changed, because every commit's file tree stays identical.

## Steps
1. **Freeze.** Merge or park the 4 finished branches first. Rewritten history gives every commit a new ID, so open branches would need rebasing. No agents run during the rewrite.
2. **Back up.** Make a mirror clone and a tarball of `.git`, kept outside the repo.
3. **Rewrite** a fresh clone with `git filter-repo --mailmap`, mapping the Gmail address to `<id>+vcani003@users.noreply.github.com`. The `Co-Authored-By` lines stay.
4. **Verify** (see below). If any check fails, stop and keep the backup.
5. **GitHub.** After a force-push, GitHub can still serve old commits by their ID. So **delete and recreate the repo** (same name, still private), push the clean history, then re-link the deploy integration and re-add any repo secrets. *Needs your go, because this is hard to undo.*
6. **Local copies.** Re-clone, remove the old worktrees, recreate `kitchen-preview`, and set `git config user.email` to the no-reply address.
7. **Prevent a repeat.** On GitHub, turn on "Keep my email addresses private" and "Block command line pushes that expose my email".
8. **Go public** only after you've looked at the result (GH1).

## Regression test
- **Same history:** the same number of commits (92) and branches.
- **Same code, every commit:** each rewritten commit's tree hash equals the original's, checked with filter-repo's commit map. This proves no file changed in any version.
- **Email gone:** no match for the Gmail address in author, committer or message fields on any ref, in `git grep` across every revision, or in tags.
- **Still works:** typecheck, lint, all unit and integration tests (839), the e2e suite, and both tester runs (single-person and household) on the new HEAD.
- **Deploys:** a preview deploy from the recreated repo succeeds.
- **Docs:** list any commit IDs quoted in docs and update them using the commit map.

## Downtime
None for the app. Deploys are paused from step 5 until the integration is re-linked.
