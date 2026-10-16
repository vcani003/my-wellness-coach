# Open Questions — Kitchen-Aware Assistant MVP

**This is the only place questions for Vero live.** Questions aren't asked through pop-up prompts or left only in chat. Chat will only say which question IDs were added or are waiting.

- Answer inline under "> Answer:", or in chat. Either works, and answers get recorded here.
- Answered questions move to the **Answered** table at the bottom, keep their ID, and become a decision record in [`decisions/`](decisions/).
- **Rec** = a recommendation (advice, not a decision). "Go with the rec" is a valid answer.
- ⛔ blocks architecture · 🟡 shapes design · ⚪ needed before build

---

## Outstanding

*Nothing outstanding.*

## Setup tasks
*All done (S1–S3 and S5–S7, 2026-10-14). S4 isn't needed (0029).*

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
| T1, S1–S3 | First deploy for the grocery trip | Done 2026-10-14: Anthropic (dedicated workspace, $10 limit), Neon and Vercel set up; live at https://my-wellness-coach-mu.vercel.app |
| SL4, SL5 | Offline ticks; "I bought X" clears the list | [0027](decisions/0027-shopping-list-in-mvp.md): both Recs approved and live |
| N1 | Budget-exhausted notice | [0020](decisions/0020-ai-cost-and-model.md): calm message now; 80% heads-up later |
| GH2 | Push the Do-later fix | Approved 2026-10-14; pushed after a clean-copy check (317 tests) |
| P2 | Next builds | Order: (a) chat history → (d) meal ideas to cooking → (b) Settings → (e) staging + testers → (c) batches |
| MI1 | Named dish goes straight to its recipe | [0013](decisions/0013-meal-lifecycle.md): approved 2026-10-14 |
| AI9 | Low vs allergens | [0025](decisions/0025-batches-and-use-it-up.md): Low never brings allergen dishes back |
| D2 | Returning after deletion | [0015](decisions/0015-language-units-policies-data.md): yes, as a fresh start with a new code |
| SU1 | Levi signs up himself | [0029](decisions/0029-invites-and-passphrases.md): invite / setup links + own passphrase; deployed 2026-10-14 |
| ST1 | How testers use staging | [0021](decisions/0021-tester-agents.md): local-copy testers before every deploy; Vero signs in to staging before bigger changes; both locks kept |
| IA1 | Item actions | [0030](decisions/0030-item-actions.md) |
| DL1, DL2 | Desktop layout; design system | [0031](decisions/0031-desktop-layout-and-design-system.md): Figma benched |
| P3 | Next features | Order: smart staples → recipe box → budget heads-up → voice input → the rest ([plan](plans/next-epics.md)) |
| SM1 | Releases and real-AI check | [0028](decisions/0028-deploy-authority.md): scoped releases; staging key in place |
| CAT1 | Types and search | [0032](decisions/0032-categories-and-search.md): defaults |
| DF1 | Defrosted food | [0011](decisions/0011-visible-changes-and-kitchen-fields.md): to Fridge unless said |
| SL6 | Do later details | [0027](decisions/0027-shopping-list-in-mvp.md) |
| CL1 | On the go | Remote Control for now; cloud later |
| GH1 | Public repo | Yes, with fake details; how is GH3 |
| B2 | Layout | [0034](decisions/0034-layout-option-2.md): option 2 on desktop and phone (tab bar); floating chat button when minimized |
| AS1a | One chat or one per assistant | [0033](decisions/0033-one-chat-routes-to-assistants.md): one chat, AI routes |
| AS1 b,c,e,f | Shared settings, household, names, focus | [0035](decisions/0035-future-assistants-and-name.md) |
| NM1 | App name | [0035](decisions/0035-future-assistants-and-name.md): "Kitchen" for MVP 1 |
| IA2–IA6 | Item action details | [0036](decisions/0036-item-action-details.md): all Recs |
| GH3 | Making the code public safely | [0037](decisions/0037-public-repo-as-is.md): public as is, no rewrite; secrets scan clean |
| RB1–RB9 | Past recipes | [0040](decisions/0040-recipe-box.md): all Recs |
| RBX1–RBX3 | Recipe box details | [0040](decisions/0040-recipe-box.md): all Recs |
| C9 | First commit | Done: first local commit made (nothing pushed) |
| — | Technical defaults | Confirmed by Vero, 2026-10-14 |
| KOS7 | Offline edits | [0044](decisions/0044-offline-for-buttons.md): offline for buttons; chat online-only |
| KOS1–KOS16 | Kitchen OS features | [0045](decisions/0045-kitchen-os-features.md): all Recs, except KOS10: the assistant is Lumi |
| V-KOS1–V-KOS2 | Cream style details | [0046](decisions/0046-cream-style-details.md): both Recs |
| KOS17–KOS18 | App name; chips per place | [0047](decisions/0047-app-name-and-place-chips.md): both Recs |
| BRT1–BRT3 | Bright look details | [0050](decisions/0050-bright-look-details.md): all Recs |
| IR1–IR4 | Refining a meal idea in chat | [0051](decisions/0051-refining-meal-ideas-in-chat.md): all Recs |
| IR5–IR6 | Undo for a recipe changed in chat; mixed messages | [0052](decisions/0052-undo-for-recipe-changed-in-chat.md): add the Undo box, button only; mixed messages keep one receipt (Rec) |
| P4 | Kitchen OS build order | [0053](decisions/0053-kitchen-os-build-order.md): Rec |
| SS1–SS14 | Smart staples | [0054](decisions/0054-smart-staples.md): all Recs |
| KOS4-a–e | Stock level details | [0055](decisions/0055-stock-level-details.md): all Recs |
| KOS16-a–c | Asking before >5 removals | [0056](decisions/0056-bulk-remove-confirm.md): all Recs |
| KOS3-a–h | Item edit details | [0057](decisions/0057-item-edit-details.md): all Recs |
| KOS1-a–f | Week plan details | [0058](decisions/0058-week-plan-details.md): all Recs |
