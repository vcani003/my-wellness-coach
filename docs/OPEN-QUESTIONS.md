# Open Questions — Kitchen-Aware Assistant MVP

**This is the only place questions for Vero live.** Questions aren't asked through pop-up prompts or left only in chat. Chat will only say which question IDs were added or are waiting.

- Answer inline under "> Answer:", or in chat. Either works, and answers get recorded here.
- Answered questions move to the **Answered** table at the bottom, keep their ID, and become a decision record in [`decisions/`](decisions/).
- **Rec** = a recommendation (advice, not a decision). "Go with the rec" is a valid answer.
- ⛔ blocks architecture · 🟡 shapes design · ⚪ needed before build

---

## Outstanding

### ARCH1. ⛔ Approve the architecture and start the first UI build?
Read the [one-page overview](architecture/README.md). The four specialist sections hold the detail, and you don't need to read them unless you want to.
Approving means:
- the build follows [frontend.md §10](architecture/frontend.md), step by step
- each outstanding question is needed only **by the build step that uses it**
- the specialists make technical calls as they go (decision 0016)
- **nothing is pushed or deployed online** without your go-ahead

Your latest answers are being written into the specialist sections now. Approve after that, or approve now "subject to those updates".
**Rec:** approve.

> Answer:

### M8. 🟡 The after-cooking step (refines your M7 answer)
Proposed wording: **"Update your kitchen"**, with "Cooked: Spinach omelette" underneath. For each ingredient the meal used, one choice:
- **Still have some** (nothing changes)
- **Running low**
- **Out**

Below that, an optional note: **"Anything to remember about what you used?"** It's saved with that cooking session. Then **Done**, **Skip** or **Do later**.

**Rec:** nothing is pre-selected; every ingredient starts at "Still have some". You tap only what's low or out, so you never claim "used up" by accident. Skipping records the ingredients as "used in this meal, amount unknown", consistent with not faking precision.

> Answer:

### R2. 🟡 Recipe: suggest by default, or ask?
You said "ask the user if they want to provide their own, or if they want help creating one."
The specialist suggests a version with **no question each time**: choosing a meal opens a **suggested recipe** (labelled AI-written), with a small **"Use my own recipe"** link. You refine it in chat ("no oven", "make it spicier").
The alternative is to ask once, on your first meal, and remember the answer.

**Rec:** suggested by default with a "Use my own recipe" link. It's one less step every time, and your own option is always one tap away. *This differs from your wording, so it's your call.*

> Answer:

### AI6. 🟡 Allergen dishes in meal ideas you didn't ask for?
Decision 0019: allergies are always considered and always flagged, with the person's own note (for example, [Husband]'s seafood allergy plus "can eat shellfish if medicine is on hand").
The open part is **unprompted** suggestions ("What can I make?"):
- **(a) Leave allergen dishes out** of unprompted ideas. If someone asks for one directly ("shrimp tacos?"), it's allowed and clearly flagged with the reminder.
- **(b) Include them, flagged,** alongside the others.

**Rec:** (a). It's the safe default, and the nuance still works the moment either of you asks for a dish like that.

> Answer:

### UX4. ⚪ The floating chat button (from your UX3 answer)
**Rec:** a round button in the bottom-right corner, with a dot when the assistant has replied since you minimized the chat. It's **not draggable in MVP 1**: dragging is more to build and harder to make accessible, and it could come next.

> Answer:

### FE1. ⚪ Signing out: why have it at all? (you asked)
You never *have* to sign out. "Session length" only means how long the app trusts a phone without seeing you. With a **rolling** session, every time you open the app the clock resets, so as long as you use it now and then, you're **never asked to sign in again.**
Some limit still exists for safety:
- **A lost or stolen phone:** the app eventually stops trusting it.
- **Forgotten devices:** an old laptop you used once doesn't stay signed in forever.

A **"Sign out everywhere"** button in Settings covers the urgent case.

**Rec:** a rolling **1 year**, in practice "never" for daily users, plus "Sign out everywhere" in Settings. (The earlier rec was 60 days, which is stricter than a kitchen app needs.)

> Answer:

### FE2. ⚪ Offline: a local AI model as a fallback? (you asked)
**Short answer:** it's feasible in theory but not worth it for MVP 1. It would be scope creep.
- **iPhone:** a web app can't use Apple's built-in on-device AI. That's only open to native iPhone apps. A downloadable model in the browser means a large download (around 1–4 GB), it runs slowly on phones, and it's much worse at the careful interpreting this app depends on.
- **Syncing is the hard part, not the chatting.** Changes made offline can clash with your husband's changes made online, and reconciling those is real work.
- **Cost:** a local model is free per message, but it would cost far more in build time than it saves.

**Options:**
- **(a) MVP 1:** offline is **read-only**. You can see your kitchen, plan and recipes, and Send is disabled.
- **(b) Next MVP:** **queued messages.** You type offline, and the message is sent when you're back. The assistant then reads it against the *latest* kitchen, so nothing clashes. This is cheap, safe, and covers most of the need.
- **(c) Later:** if the app ever goes native on iPhone, Apple's on-device AI could handle simple offline chat.

**Rec:** (a) now, (b) next.

> Answer:

### C10. 🟡 Model quality vs cost (you asked)
| Model | Price vs Opus | Quality for this app |
|---|---|---|
| **Opus 5.5** (current) | 1× | Best at the hard parts: "the rest of the spinach", corrections, allergy nuance |
| **Sonnet 5.5** | ½× | Strong, and likely fine for meal ideas and recipes. Slightly more risk on tricky interpretation. |
| **Haiku 5.5** | ~1/40× | Fast and very cheap. Too weak for interpreting and allergy nuance; fine only for tiny jobs. |

- **Your $20 target:** the estimate on Opus is already about $15–18/month, so **no downgrade is needed to hit it.** Real usage will tell.
- **Choosing the model inside the app** (a setting you flip) **is scope creep.** It's also unnecessary, because the model is already a **per-task server setting** (0020) that I can change for you without code.
- **The proposal:** once real messages exist, run the test set (about $2–4 a run) on **Sonnet** for meal ideas and recipes, and compare the results side by side. **You decide** from that, not from guesses.

**Rec:** yes to the comparison after the first 2 weeks of real use. Keep Opus until then.

> Answer:

### D1. ⚪ Deleting your data: what happens to items you added to the shared kitchen?
*(From the Backend specialist, extending decision 0015)*
**Rec:** the items stay in the kitchen, shown as added by "a former member". The kitchen itself is deleted only when its last member deletes their data.

> Answer:

### B15. ⚪ How we judge MVP 1 a success (the remaining half of B14)
**Rec:** MVP 1 succeeds when (1) both tester agents pass (0021), and (2) you and your husband use it for real for **2 weeks** and still find it useful. Your judgment is the verdict, plus a short note on what worked and what didn't.

> Answer:

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
| C9 | First commit | Done: first local commit made (nothing pushed) |
| — | Technical defaults | Confirmed by Vero, 2026-10-14 |
