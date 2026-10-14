# Open Questions — Kitchen-Aware Assistant MVP

**This is the only place questions for Vero live.** Questions aren't asked through pop-up prompts or left only in chat. Chat will only say which question IDs were added or are waiting.

- Answer inline under "> Answer:", or in chat. Either works, and answers get recorded here.
- Answered questions move to the **Answered** table at the bottom, keep their ID, and become a decision record in [`decisions/`](decisions/).
- **Rec** = a recommendation (advice, not a decision). "Go with the rec" is a valid answer.
- ⛔ blocks architecture · 🟡 shapes design · ⚪ needed before build

---

## Outstanding

### N1. 🟡 Being told when the AI budget runs out (you asked)
**(a)** When the monthly spend limit is hit, Kitchen shows a clear, calm message instead of a generic error: *"Kitchen's AI budget for this month is used up. It resets on the 1st. Your kitchen and list still work."*
**(b)** Optionally, a quiet in-app heads-up at about **80%** of the monthly budget, based on the cost Kitchen already logs for each message.
(The Anthropic Console's own email alert works today with no build.)
**Rec:** (a) now, since it's small. (b) later.

> Answer:

### SL4. 🟡 Ticking items at the store with bad signal
Offline is read-only in MVP 1 (0017), but stores often have poor signal, and ticking is exactly what you'd do there.
**Rec (UX):** a small exception just for ticks. They save on your phone and sync when the signal is back, and anything not yet synced is marked "Not synced yet". Everything else stays read-only offline.

> Answer:

### SL5. 🟡 "I bought garlic" in chat: does garlic leave the list?
**Rec (UX):** yes. It goes into the kitchen and comes off the list in one step, with one Undo for both. That matches "Done shopping" (SL2).

> Answer:

### T1. ⛔ Today: deploy a small version for your grocery trip (in progress)
**Goal:** live in about 2 hours, for you only. Levi is added tonight.
**Status: deployed 2026-10-14** (shopping list + new login page live the same afternoon) at https://my-wellness-coach-mu.vercel.app, behind the access code (strangers are redirected to /unlock, and the API refuses without a code). Previously: ready to deploy. The screens, the real AI and the online hosting are merged. All tests pass: 217 unit and integration, 8 in a real browser, plus a production build.
**Plan accepted (2026-10-14).** The home Wi-Fi fallback applies if time runs out. **Still needed:** S1–S3 (Vero is setting them up), then a final **"go"** right before the deploy.

**What today's version does:**
- You tell Kitchen what you have and what you made (pho), and the Kitchen widget updates.
- You ask "what staples do I still need?", grouped by MD Oriental / Publix, and "what do I have?".
- After shopping, you tell it what you bought.

**What it doesn't do yet:** email sign-in (a private **access code** for now), meal ideas, recipes, the meal plan, or batches.

> Answer:

## Setup tasks for you: do these now for today's deploy
These need **your** accounts. Keep every key and code private: you paste them yourself, and I'll never ask you to send them in chat.
- **S1. Anthropic (about 5 min):** at console.anthropic.com, create a workspace (for example "wellness-coach"), set its **monthly spend limit to $10** (see C12), and create an **API key**. Keep it somewhere safe for S3.
- **S2. Neon (about 5 min):** at neon.com, sign up (free), create a project "wellness-coach" in a US East region, and copy the **connection string** from the dashboard.
- **S3. Vercel (about 5 min):** at vercel.com, sign up for the free (Hobby) plan. Then, in the Terminal app, in the project folder, run `npx vercel login` and follow the browser prompt. When I ask, you'll add these settings in the Vercel dashboard (Project → Settings → Environment Variables):
  - `DATABASE_URL`: the Neon connection string (S2)
  - `ANTHROPIC_API_KEY`: your key (S1)
  - `AI_MODE`: `real`
  - `SESSION_SECRET`: generate one in Terminal with `openssl rand -base64 32`
  - `ACCESS_CODES`: `vero=` followed by a long passphrase only you know. Levi's code gets added tonight.
- **S3b. Set up the database (about 2 min, after S2):** in Terminal, in the project folder, run these two commands, pasting your Neon connection string between the quotes. Your string stays in your Terminal and is never saved to a file.
  - `DATABASE_URL='<neon string>' npm run db:migrate`
  - `DATABASE_URL='<neon string>' npm run db:bootstrap`
- **Then tell me "ready".** I'll link the Vercel project, you add the five settings above in the dashboard, and on your **"go"** I deploy and check it.
- **S4. Resend:** not needed today. It's for email sign-in later.

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
| T2 | Staples and shopping list | [0026](decisions/0026-success-criteria-and-first-real-test.md): staples answered in chat + "remember as a staple?"; a Shopping list widget is decided after today |
| C12 | Lower spend cap | [0020](decisions/0020-ai-cost-and-model.md): $10 limit to start, $20 target; 100 messages/day per person |
| T2 (revisited) | Shopping list | [0027](decisions/0027-shopping-list-in-mvp.md): in MVP 1 after the first real test |
| SL1–SL3 | Shopping list: stores, Done shopping, Out offers | [0027](decisions/0027-shopping-list-in-mvp.md): Recs approved |
| — | Deploy permission | [0028](decisions/0028-deploy-authority.md): routine deploys without asking |
| C9 | First commit | Done: first local commit made (nothing pushed) |
| — | Technical defaults | Confirmed by Vero, 2026-10-14 |
