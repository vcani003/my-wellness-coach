# Decisions index

One line per decision. Read the full record only when it's relevant to your task. A decision overrides anything older that contradicts it.

| # | Decision |
|---|---|
| [0001](0001-platform-pwa.md) | MVP is a phone-first Progressive Web App |
| [0002](0002-accessibility-and-ux-conventions.md) | WCAG 2.2 AA, in proportion to the MVP; familiar UX patterns |
| [0003](0003-ai-interpretation-specialist.md) | AI interpretation has its own specialist; backend validates everything the AI proposes |
| [0004](0004-widgets-kitchen-first-not-coupled.md) | Widgets: Kitchen, Meal ideas, Meal plan. Kitchen-specific but not coupled |
| [0005](0005-primary-journey.md) | The primary journey the Epic is judged on |
| [0006](0006-users-and-sign-in.md) | Max 4 accounts (Vero, husband, 2 tester agents); shared kitchen; email login links |
| [0007](0007-correcting-interpretations.md) | Chat changes save right away; "What changed" + Undo; fix in chat |
| [0008](0008-meal-plan-depth.md) | Meal plan is a short list with no dates and no reserving |
| [0009](0009-meal-idea-detail.md) | Meal idea card: name, why, ingredients used and missing |
| [0010](0010-recipe-sources-and-basics.md) | Own recipe or AI-suggested; AI may assume basics but reminds the user |
| [0011](0011-visible-changes-and-kitchen-fields.md) | "What changed" shown; only item name required; fridge/freezer/pantry; "added X days ago"; Out drops off list; auto-Out |
| [0012](0012-allergies-and-preferences.md) | Allergies only when stated explicitly, never inferred; "Want me to remember that?" |
| [0013](0013-meal-lifecycle.md) | Meal lifecycle (idea → chosen → plan → cooking → done); suggested recipe by default; shared ticks; "Update your kitchen" after cooking |
| [0014](0014-project-setup.md) | Start fresh; Claude; own repo; vision is a stub (saved specialists: see 0023) |
| [0015](0015-language-units-policies-data.md) | English only, translation-ready; units as said; policies and data controls in Settings |
| [0016](0016-team-and-technical-delegation.md) | Accessibility folded into Frontend; technical decisions delegated to specialists; Next.js preferred |
| [0017](0017-shared-kitchen-and-layout.md) | Private chats; Undo own changes only; See all view-only; docked chat + minimize button (not draggable); link + code sign-in; 1-year rolling session; read-only offline; design tokens |
| [0018](0018-never-crash-fallbacks.md) | Never crash: isolated widgets, safe fallbacks, plain errors |
| [0019](0019-allergies-with-nuance-and-basics.md) | Every member's allergies always considered, with nuance notes; allergen dishes left out of unprompted ideas; others can add, owner verifies; no medical advice; assumed basics; allergen badge computed by code |
| [0020](0020-ai-cost-and-model.md) | $40 cap, $20 target; Opus 5.5; model is a per-task server setting; name "Kitchen" |
| [0021](0021-tester-agents.md) | Two tester agents on staging; single-person and household test kitchens; tests gate hand-off |
| [0022](0022-ux-owns-look-and-feel.md) | UX owns visual design (tone, mood, tokens); start calm |
| [0023](0023-saved-specialist-agents.md) | Architecture approved; specialists saved in `.claude/agents/`; build order decided with Vero per milestone |
| [0024](0024-visual-direction-clay-and-honey.md) | Visual direction C, Clay & Honey; plum reserved for allergy flags |
| [0025](0025-batches-and-use-it-up.md) | Up to 3 batches per item (oldest closes); oldest used first; "use it up" ranking; shelf-life prediction later |
| [0026](0026-success-criteria-and-first-real-test.md) | Success = testers pass + 2 weeks of real use; first real test is a grocery trip |
| [0027](0027-shopping-list-in-mvp.md) | Shopping list widget in MVP 1: shared, filled from chat, staples and recipes; ticked items go into the kitchen |
| [0028](0028-deploy-authority.md) | Routine deploys go without asking; major or risky ones need Vero's go; additive migrations run on deploy |
| [0029](0029-invites-and-passphrases.md) | Invite / setup links + own passphrase replace email sign-in; access codes are a backup |
| [0030](0030-item-actions.md) | ⋯ menu on items (Used up, Low, Move, Change type, Edit, Remove) + swipe-to-remove; Counter as a place |
| [0031](0031-desktop-layout-and-design-system.md) | Desktop layout epic (explore → decide → design system → build); own design system on Base UI; Figma benched |
| [0032](0032-categories-and-search.md) | By place (default) / By type, 12 types, search |
| [0033](0033-one-chat-routes-to-assistants.md) | One chat; the AI routes each message to the right assistant; no assistant switcher (future) |
| [0034](0034-layout-option-2.md) | Layout option 2 (nav, main view, chat) on desktop and phone; phone tab bar; floating chat button |
| [0035](0035-future-assistants-and-name.md) | "You & household" shared; household Kitchen-only; Fitness Coach / Health Tracker; never jump, show cue; "Kitchen" for MVP 1 |
| [0036](0036-item-action-details.md) | Item actions: whole-item Out, no chat echo, oldest batch, defrost on move-out, rename receipt |
| [0037](0037-public-repo-as-is.md) | Repo goes public as is (no history rewrite); secrets scan clean; fictional data from now on |
