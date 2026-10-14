# Open Questions — Kitchen-Aware Assistant MVP

**This is the only place questions for Vero live.** Questions aren't asked through pop-up prompts or left only in chat. Chat will only say which question IDs were added or are waiting.

- Answer inline under "> Answer:", or in chat. Either works, and answers get recorded here.
- Answered questions move to the **Answered** table at the bottom, keep their ID, and become a decision record in [`decisions/`](decisions/).
- **Rec** = a recommendation (advice, not a decision). "Go with the rec" is a valid answer.
- ⛔ blocks architecture · 🟡 shapes design · ⚪ needed before build

---

## Outstanding

### T1. ⛔ Today's grocery test: how to run it
Today's test needs the **real AI**. The stand-in can't answer "what staples do I need?". Two ways to run it:
- **(a) At home on your Wi-Fi, today.** The app runs on your Mac, and you and Levi open it on your phones over your home Wi-Fi.
  - **Needs from you:** only an **Anthropic API key** (S1).
  - **Limits:** it doesn't work at the store. Before you leave, ask Kitchen for the list and take a screenshot. When you're home, tell it what you bought.
  - **Security:** anyone on your Wi-Fi could open the page while it's running, so we stop it after the test.
- **(b) Online, usable anywhere** (at the store, Levi at work).
  - **Needs:** sign-in, a deploy, four accounts (S1–S4), and your go-ahead to publish.
  - **Timing:** realistically **not today** without rushing security.

**Rec:** (a) today, and (b) as the next milestones. What you enter today will carry over when we go online.

> Answer:

### T2. 🟡 Staples and a shopping list
"What staples do I need?" has two parts: knowing your **usual staples**, and keeping a **shopping list**.
- **Today, Rec:** Kitchen answers in chat. It uses what's in your kitchen, that you made pho, where you shop, and common staples for the dishes you make. When you mention a staple, it offers "Want me to remember fish sauce as one of your staples?". That uses the preferences design you already approved (0012), so it's not new scope.
- **Later, a choice for you:** a **Shopping list widget** (tick-off, shared with Levi). It's genuinely useful, but it's **new scope**: a 5th widget, beyond the spec's MVP set. **Rec:** decide after today's test, based on whether you missed it.

> Answer:

## Setup tasks for you (not blocking local building)
These need **your** accounts, so I won't create them for you. They're needed before the real AI (b) or going online.
- **S1. Anthropic Console (needed for today's test):** create an API workspace for **production** and one for **staging**, set spend limits of **$30** and **$10** (0020), and create a key for each. Keep the keys private, and I'll tell you where to paste them (a local file that's never committed).
- **S2. Neon:** a free account (two projects later: production and staging).
- **S3. Vercel:** a free account (only when we go online, with your go-ahead).
- **S4. Resend:** a free account, plus the email address sign-in emails come from.

---

## Technical defaults (confirmed by Vero 2026-10-14)

These are engineering calls, so they're not questions for you. Each will be explained in plain language in the architecture doc, and you can veto any of them.

- **Event log as the source of truth.** Every change ("bought", "froze", "used", "undo") is saved as a permanent event with a timestamp, **who** made it, and the source message it came from. "What's in the kitchen now" is computed from those events (spec §4, decision 0007).
- **Unknowns stored as unknown.** Fields can be empty with no made-up defaults. Each fact records whether the user said it or the assistant inferred it, plus how confident it was.
- **The AI proposes and the system decides.** The model turns messages into structured, validated event proposals and never writes to the database directly (§11, decision 0003).
- **Widgets are driven by state.** Widgets read domain data, not chat text, and a future assistant's widget can be added without changing the Kitchen ones (§3, decision 0004).
- **Shared context and domain context are kept separate.** Kitchen data stays separate from a small shared layer (user, events, provenance, allergies and preferences), and other assistants read it through an API rather than through prompts (§5, decision 0012).
- **Translation-ready text.** No hard-coded on-screen text, and dates and numbers formatted by locale (decision 0015).

---

## Answered

| ID | Question | Decision |
|---|---|---|
| A1 | Platform | [0001](decisions/0001-platform-pwa.md): PWA |
| A2 | Accessibility target | [0002](decisions/0002-accessibility-and-ux-conventions.md): WCAG 2.2 AA in proportion; familiar UX |
| A3 | AI ownership | [0003](decisions/0003-ai-interpretation-specialist.md): separate specialist |
| A4 | MVP widgets | [0004](decisions/0004-widgets-kitchen-first-not-coupled.md): Kitchen, Meal ideas, Meal plan; not coupled |
| A5 | Primary journey | [0005](decisions/0005-primary-journey.md): user explicitly selects a meal before "add that" |
| B1, B13, H1 | Who uses MVP 1; shared kitchen | [0006](decisions/0006-users-and-sign-in.md): max 3 (Vero, husband, tester agent); one shared kitchen; email login links |
| B2 | Where meals and recipes come from | [0010](decisions/0010-recipe-sources-and-basics.md): own recipes or AI; AI suggests from kitchen |
| B3 | Meal plan depth / reserving | [0008](decisions/0008-meal-plan-depth.md): short list, no reserving |
| B4 | Kitchen fields | [0011](decisions/0011-visible-changes-and-kitchen-fields.md): only name required; fridge/freezer/pantry |
| B5–B6 | Confirm vs undo, correcting | [0007](decisions/0007-correcting-interpretations.md): save right away + Undo + fix in chat |
| B7 | Items it never heard about | [0011](decisions/0011-visible-changes-and-kitchen-fields.md): record it, mention in "What changed" |
| B8 | Allergies and preferences | [0012](decisions/0012-allergies-and-preferences.md): explicit only; "Want me to remember that?" |
| B9 | Food age | [0011](decisions/0011-visible-changes-and-kitchen-fields.md): "added X days ago" |
| B11 | Language and units | [0015](decisions/0015-language-units-policies-data.md): English, units as said, translation-ready |
| B12 | Tester data and policies | [0015](decisions/0015-language-units-policies-data.md): policy boilerplate + see/delete data in Settings |
| Q2 | Is history visible | [0011](decisions/0011-visible-changes-and-kitchen-fields.md): show "What changed" |
| Q4 | Assumed basics | [0010](decisions/0010-recipe-sources-and-basics.md): assume basics, remind the user |
| M1–M4, R1 | Choosing, ticks, multiple meals, "I made it", recipes | [0013](decisions/0013-meal-lifecycle.md): decided in principle; exact lifecycle in M5 |
| C1, C3, C4, C5, C7 | Fresh start, Claude, own repo, no saved agents, vision stub | [0014](decisions/0014-project-setup.md) |
| C6, C8 | AGENTS.md; do agents use this file | [0016](decisions/0016-team-and-technical-delegation.md): AGENTS.md approved; agents read Outstanding only |
| — | Team and tech delegation | [0016](decisions/0016-team-and-technical-delegation.md): a11y folded into Frontend; specialists make tech calls |
| — | Meal idea detail | [0009](decisions/0009-meal-idea-detail.md): name, why, ingredients |
| M5, M6, M7 | Meal lifecycle; shared ticks; after cooking | [0013](decisions/0013-meal-lifecycle.md): approved; ticks shared; out / low / note (wording in M8) |
| K1, H2, H3, UX1, UX2, UX3, FE3 | Inventory view, private chats, Undo, layout, sign-in, theming | [0017](decisions/0017-shared-kitchen-and-layout.md) |
| (with H3) | Never crash | [0018](decisions/0018-never-crash-fallbacks.md): isolated widgets, safe fallbacks |
| AI1, AI3 | Allergies with nuance; assumed basics | [0019](decisions/0019-allergies-with-nuance-and-basics.md) |
| C2, AI5, B10 | Budget, model, name and voice | [0020](decisions/0020-ai-cost-and-model.md): $40 cap, $20 target; Opus; "Kitchen" |
| B14 | Tester agents | [0021](decisions/0021-tester-agents.md): 2 testers; single-person + household test kitchens |
| ARCH1 | Approve architecture | [0023](decisions/0023-saved-specialist-agents.md): approved; building begins |
| M8 | After-cooking step | [0013](decisions/0013-meal-lifecycle.md): "Update your kitchen"; Still have some / Running low / Out + note |
| R2 | Recipe default | [0013](decisions/0013-meal-lifecycle.md): suggested by default + "Use my own recipe" |
| C5 (revisited) | Saved specialists | [0023](decisions/0023-saved-specialist-agents.md): saved in `.claude/agents/` |
| — | Look and feel | [0022](decisions/0022-ux-owns-look-and-feel.md): UX owns visual design; start calm |
| P1 | Next milestone | (a) the app on screen with a stand-in AI: milestone 2 started |
| V1, V2 | Visual direction; plum | [0024](decisions/0024-visual-direction-clay-and-honey.md): C, Clay & Honey; plum for allergies only |
| K2, K4 | "Out" items; auto-Out | [0011](decisions/0011-visible-changes-and-kitchen-fields.md): Out drops off list; auto-Out with Undo |
| AI6, AI7 | Allergen ideas; Levi's allergy | [0019](decisions/0019-allergies-with-nuance-and-basics.md): left out unless asked; added by Vero, verified by Levi |
| UX4, FE1, FE2 | Chat button; sessions; offline | [0017](decisions/0017-shared-kitchen-and-layout.md): not draggable; 1-year rolling; read-only offline |
| K3 | Older and newer batches | [0025](decisions/0025-batches-and-use-it-up.md): up to 3 per item, oldest closes |
| AI8 | Use-it-up priority | [0025](decisions/0025-batches-and-use-it-up.md): yes; shelf-life prediction later |
| C10, C11 | Cheaper models | [0020](decisions/0020-ai-cost-and-model.md): decided by tests; interpreting stays Opus; back to Opus after misses |
| D1 | Deleting data in a shared kitchen | [0015](decisions/0015-language-units-policies-data.md): items stay as "former member" |
| B15 | Success criteria | [0026](decisions/0026-success-criteria-and-first-real-test.md): testers + 2 weeks; grocery test today |
| C9 | First commit | Done: first local commit made (nothing pushed) |
| — | Technical defaults | Confirmed by Vero, 2026-10-14 |
