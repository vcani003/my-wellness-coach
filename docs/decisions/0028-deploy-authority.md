# 0028 — Who can deploy

**Status:** Accepted · 2026-10-14 · Decided by Vero

- **Routine deploys don't need Vero's go-ahead.** That covers finished, tested features and fixes, for example the shopping list and the login page restyle. The orchestrator deploys and tells her what went out.
- **Ask first when it's major or risky:** destructive or data-changing migrations, changes to sign-in or security, anything that could lose or expose data, new paid services or costs, or a deploy with known failing tests.
- **Migrations run automatically on deploy**, but only additive ones. That's so Vero doesn't have to run database commands with secrets in her Terminal. Anything that isn't additive counts as major (see above).
