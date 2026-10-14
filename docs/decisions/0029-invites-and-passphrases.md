# 0029 — Sign-in: invite links and your own passphrase

**Status:** Accepted · 2026-10-14 · Decided by Vero (SU1). Replaces the planned email sign-in (S4 / Resend not needed).

- **No open sign-up.** A kitchen member creates a **single-use link** in Settings that's valid for **24 hours**:
  - **"Send sign-in setup link"** for an existing member with no passphrase, like Levi, so he keeps his account and allergy
  - **"Invite someone new"** for a new person, up to the 4-account cap (0006; testers don't count)
- **Your own passphrase:** at least 12 characters, stored hashed (scrypt), never readable. Sign in with your **name + passphrase**.
- **Forgot it?** Another kitchen member sends a **reset link**. Resetting or changing a passphrase signs out your other devices.
- **Vercel access codes** stay as a backup only, and are used for testers on staging.
- Links, sign-in and resets are rate-limited, with generic failure messages. An expired or used link names whoever made it.
