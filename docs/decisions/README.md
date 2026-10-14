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
| [0011](0011-visible-changes-and-kitchen-fields.md) | "What changed" shown; only item name required; fridge/freezer/pantry; "added X days ago" |
| [0012](0012-allergies-and-preferences.md) | Allergies only when stated explicitly, never inferred; "Want me to remember that?" |
| [0013](0013-meal-lifecycle.md) | Meal lifecycle (idea → chosen → plan → cooking → done); shared ticks; after-cooking out/low/note |
| [0014](0014-project-setup.md) | Start fresh; Claude; own repo; no saved specialists yet; vision is a stub |
| [0015](0015-language-units-policies-data.md) | English only, translation-ready; units as said; policies and data controls in Settings |
| [0016](0016-team-and-technical-delegation.md) | Accessibility folded into Frontend; technical decisions delegated to specialists; Next.js preferred |
| [0017](0017-shared-kitchen-and-layout.md) | Private chats; Undo own changes only; See all is view-only; docked chat + minimize button; link + code sign-in; design tokens |
| [0018](0018-never-crash-fallbacks.md) | Never crash: isolated widgets, safe fallbacks, plain errors |
| [0019](0019-allergies-with-nuance-and-basics.md) | Every member's allergies always considered, with personal nuance notes; no medical advice; assumed basics list |
| [0020](0020-ai-cost-and-model.md) | $40 cap, $20 target; Opus 5.5; model is a per-task server setting; name "Kitchen" |
| [0021](0021-tester-agents.md) | Two tester agents on staging; single-person and household test kitchens; tests gate hand-off |
