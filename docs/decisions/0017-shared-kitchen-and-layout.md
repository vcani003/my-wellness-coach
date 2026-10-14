# 0017 — Shared-kitchen rules and the main layout

**Status:** Accepted · 2026-10-14 · Decided by Vero

## Shared kitchen
- **Chats are private (H2).** The kitchen, the plan, ticks and "who changed what" are shared.
- **Undo covers only your own changes (H3).** You fix someone else's change in chat, and the fix is recorded as yours.
- **Kitchen inventory view (K1):** the same Kitchen widget, expanded through "See all". Grouped by fridge / freezer / pantry / not sure where, showing who added each item and when. **View-only in MVP 1**, apart from To review.

## Layout
- **Phone: chat docked at the bottom (UX3)**, with three states:
  - **Peek:** the latest reply and the message box
  - **Full:** the whole conversation
  - **Minimized:** hidden, with a floating **chat button** (like iPhone's AssistiveTouch) that brings it back, so app features get the full screen. The button's details are in OPEN-QUESTIONS **UX4**.
- **"What changed" is not its own widget (UX1).** The receipt under the reply, plus "New" / "Updated" highlights in the widgets, cover it.

## Sign-in (UX2)
- The sign-in email carries **both a link and a 6-digit code**, because an iPhone home-screen app doesn't share sign-in with Safari.
- **How it's built:** **Better Auth** (the sign-in library), with its magic-link plugin and its email one-time-code plugin. The code is 6 digits, valid for 5 minutes, with 3 tries. **Resend** sends the email.
  - Sending both in one email isn't a built-in Better Auth feature, so it gets tested first. The fallback is code-only.
  - It's written up in [backend-data.md §2](../architecture/backend-data.md) (sign-in row) and [frontend.md §5](../architecture/frontend.md) (the code field accepts paste and phone autofill).

## Theming (FE3)
- **No dark mode in MVP 1.** All colours, spacing and type come from **design tokens** (named values like `color.surface`, set in one place), and components use only tokens. Dark mode can be added later by supplying a second set of token values, with no component rewrites.
