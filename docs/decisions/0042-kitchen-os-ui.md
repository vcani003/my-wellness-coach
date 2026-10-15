# 0042: Kitchen OS look and layout, with RecipeCat's cream art

**Status:** Accepted · 2026-10-15 · Decided by Vero. Supersedes [0024](0024-visual-direction-clay-and-honey.md) (Clay & Honey). Changes [0034](0034-layout-option-2.md) and [0017](0017-shared-kitchen-and-layout.md) "Theming" where they differ.

- **Look and feel come from the `recipe-cat` repo.** Two parts of it are used:
  - **Layout and navigation:** the "Kitchen OS" phone app. It has five places in a bottom dock (Today, Kitchen, Plan, Meals, List), a header with household avatars, and the chat (reply, chips and message box) above the dock, plus a "What changed" bar with Undo.
  - **Visual system:** the RecipeCat cream style. This means its tokens, sticker art, stitched cards and washi tape, the cat mascot, the Fredoka + Nunito fonts, and **light and dark themes**.
- **Only the UI is ported, never the core.** recipe-cat works out changes on the phone. This app keeps its own core, where the server checks every change first. The ported views are rewired to this app's contracts (`src/contracts/`) and server actions. recipe-cat's model, sync, household, Lumi agent and push/timer backend are **not** brought over.
- **Files are ported by hand onto the branch `ui/kitchen-os`.** The git histories are not merged, and none of recipe-cat's `.env` files or keys are copied.
- **Rules that still hold:**
  - semantic tokens only (0017, 0031);
  - WCAG 2.2 AA in proportion (0002), with 44px or larger tap targets;
  - never crash (0018);
  - all text goes through translations (0015);
  - an allergy-only colour (question KOS15).
- **Before any push:** this repo is public (0037) and recipe-cat is private, so Vero confirms the ported art and code may be published.
