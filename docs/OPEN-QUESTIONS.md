# Open Questions — Kitchen-Aware Assistant MVP

**This is the only place questions for Vero live.** Questions aren't asked through pop-up prompts or left only in chat. Chat will only say which question IDs were added or are waiting.

- Answer inline under "> Answer:", or in chat. Either works, and answers get recorded here.
- Answered questions move to the **Answered** table at the bottom, keep their ID, and become a decision record in [`decisions/`](decisions/).
- **Rec** = a recommendation (advice, not a decision). "Go with the rec" is a valid answer.
- ⛔ blocks architecture · 🟡 shapes design · ⚪ needed before build

---

## Outstanding

### P1. ⛔ What should come after the backend foundation? (asked as building starts)
✅ **Backend foundation is done** (65 tests passing, committed locally). UX's visual directions are ready (V1).
Built: **backend foundation** (project skeleton, event history, kitchen state, change checking, tests), plus **UX's calm visual direction** (you'll get a preview to pick from).
Pick the next milestone, or put them in order:
- **(a) The app on screen:** layout, chat dock (Peek / Full / Minimized + button), and the Kitchen widget, using a stand-in "fake AI" so it works without an AI key. It needs the visual direction (**V1**).
- **(b) The real AI:** Kitchen actually understanding your messages, plus the test set of example messages. This needs an Anthropic API key (S1).
- **(c) Sign-in:** email link + code. This needs Resend and a sign-in email (S1).

**Rec:** (a) → (b) → (c). You see and feel the app first; sign-in matters only once it's online.

> Answer:

### V1. 🟡 Which calm visual direction? (A, B or C)
Open [`design/preview.html`](design/preview.html) in a browser and switch between the three. The details are in [`design/visual-direction.md`](design/visual-direction.md).
- **A. Linen & Sage:** "A slow morning: linen light, a pot of herbs on the sill." Warm paper tones, a sage accent, and a soft serif for headings.
- **B. Still Water:** "Cool and clear, like a glass of water on a quiet table." Misty blue-grey, a teal accent, flat cards, and a very readable font.
- **C. Clay & Honey:** "Cosy and rounded: an afternoon with tea in a hand-thrown mug." Cream, a clay accent and pill-shaped buttons.

All three pass the accessibility contrast checks and use free fonts. You can also mix them, for example A's colours with C's rounded buttons.
**Rec (UX):** A. It feels warm without being sleepy, and sage stays far from the allergy and error colours, so those signals stay unmistakable.

> Answer:

### V2. ⚪ Plum for allergy flags?
Plum is used **only** for allergy flags, so it always means "allergy" and never anything else.
**Rec (UX):** yes. It's unmistakable without looking alarming.

> Answer:

### K3. 🟡 "I bought eggs" when eggs are already in the kitchen
*(From the Backend specialist, found while building)* Right now this creates a **second** "eggs" entry, which makes "use the eggs" ambiguous later.
**Rec:** one entry per item. Buying more of something you already have updates that entry (and clears "Low" / "Out"). Separate entries only when you say they're different ("eggs in the freezer" vs "eggs in the fridge").

> Answer:

### K4. ⚪ Using up a measured amount marks it "Out" automatically?
*(From the Backend specialist)* For example, you had "2 lbs chicken" and used 2 lbs.
**Rec:** yes, mark it Out automatically, with the usual "What changed" and Undo. You can always correct it.

> Answer:

### AI6. 🟡 Allergen dishes in meal ideas you didn't ask for?
Decision 0019: allergies are always considered and always flagged, with the person's own note (for example, [Husband]'s seafood allergy plus "can eat shellfish if medicine is on hand").
The open part is **unprompted** suggestions ("What can I make?"):
- **(a) Leave allergen dishes out** of unprompted ideas. If someone asks for one directly ("shrimp tacos?"), it's allowed and clearly flagged with the reminder.
- **(b) Include them, flagged,** alongside the others.

**Rec:** (a). It's the safe default, and the nuance still works the moment either of you asks for a dish like that.

> Answer:

### AI7. 🟡 Can you save your husband's allergy for him?
*(From the integration pass; follows from 0019)* Say you tell Kitchen "[Husband] is allergic to seafood."
**Rec:** Kitchen asks you, "Save this to [Husband]'s profile?". (Backend will record your "yes" with the allergy, as it does for preferences.) If you say yes, it's saved and starts being considered right away. In his Settings it shows as **"Added by Vero"**, and **only he** can edit its note or remove it.

> Answer:

### K2. ⚪ What happens to an item marked "Out"?
*(From the integration pass)*
**Rec:** it drops off the Kitchen list, so the list shows only what you have. Its history is kept, so the assistant still knows "you ran out of eggs on Tuesday". A "running low" item stays on the list with a "Low" label.

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

## Setup tasks for you (not blocking local building)
These need **your** accounts, so I won't create them for you. They're needed before the real AI (b) or going online.
- **S1. Anthropic Console:** create an API workspace for **production** and one for **staging**, set spend limits of **$30** and **$10** (0020), and create a key for each. Keep the keys private, and I'll tell you where to paste them (a local file that's never committed).
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
| C9 | First commit | Done: first local commit made (nothing pushed) |
| — | Technical defaults | Confirmed by Vero, 2026-10-14 |
