# Architecture overview — Kitchen-Aware Assistant MVP

**Status:** Proposed, pending Vero's review (OPEN-QUESTIONS **ARCH1**) · 2026-10-13
Start here; it's a one-page summary. The four specialist sections hold the detail:

| Section | Owner | What's in it |
|---|---|---|
| [ux.md](ux.md) | UI/UX | Phone and desktop layout, widget behavior and states, sheets, shared-kitchen cues, the primary journey screen by screen |
| [frontend.md](frontend.md) | Frontend + Accessibility | App structure, the widget system, libraries, the PWA, the accessibility checklist, the **first UI build plan** |
| [backend-data.md](backend-data.md) | Backend / Data | Stack, the event history model, data model, security, and **§6, the single shared contract** every part follows |
| [ai.md](ai.md) | AI | How messages become kitchen changes, what the model sees, safety, cost, and the test set of example messages |

---

## The whole system in one picture

```
 Phone / desktop (PWA)                 One Next.js app (server)                       Stored
┌──────────────────────┐   message   ┌──────────────────────────────────────┐   ┌─────────────────┐
│ Widgets  (2/3)       │ ──────────► │ 1. Interpret  (Claude reads message,  │   │                 │
│ Kitchen · Ideas ·    │             │    proposes changes; never saves)     │   │  Event history  │
│ Recipe · Meal plan   │             │ 2. Check  (code validates each change,│──►│  (permanent)    │
│                      │ ◄────────── │    allergies, permissions)            │   │       │         │
│ Chat dock (1/3)      │  reply +    │ 3. Apply  (save as events → update    │   │       ▼         │
│ "What changed" +Undo │  what       │    "kitchen now")                     │   │  Kitchen now    │
└──────────────────────┘  changed    │ 4. Reply  (only what actually saved)  │   │  (fast copy)    │
         ▲                           └──────────────────────────────────────┘   └─────────────────┘
         └── every ~15 s: "did anything change?" (so you see your husband's changes)
```

This is spec §11's boundary: **conversation → interpretation → persistent events → domain services → widgets.**
- **The AI only proposes.** Code checks every change before anything is saved.
- **Buttons use the same path as chat.** So Undo, Choose and ticking a box can't bypass the checks.
- **History is never overwritten.** "What's in the kitchen now" is computed from it.

## Key choices (made by the specialists, decision 0016)

| Area | Choice | Why, in one line |
|---|---|---|
| App | **Next.js 16** (React, TypeScript): one app for screens + server | Your preference; one codebase, one deploy |
| Hosting | **Vercel** (free plan) | Made for Next.js. The free plan is for personal, non-commercial use, which fits an MVP. |
| Database | **Postgres on Neon** (free plan) | Standard, reliable, good for event history |
| Sign-in | **Better Auth** with email links (+ code if UX2), invite-only, max 3 accounts | Users stay in our own database, with no extra vendor |
| AI | **Claude Opus 5.5** with structured outputs | Reliable structured answers, plus allergy checks in code too |
| UI parts | **Base UI** components, **Tailwind** styling, **next-intl** text | Accessible building blocks; translation-ready from day one |
| Tests | Vitest, Playwright + automated accessibility checks, a fixed "fake AI" for repeatable runs | The tester agent uses the real AI on staging |
| Environments | **Production** (you + your husband) and **staging** (tester agent, previews) | The tester never touches your real kitchen |

**Future assistants (spec §5):** shared data (you, membership, allergies and preferences, the history format) is kept apart from Kitchen data. A future Fitness assistant reads it through a small defined interface and never through Kitchen's tables or prompts. Adding its widget means one new folder plus one line.

## Expected monthly cost

| | |
|---|---|
| AI | ~$15–18 production + a few $ staging (≈3¢ per kitchen update, 7¢ per set of meal ideas, 5¢ per recipe) |
| Hosting, database, email | $0 (free plans) |
| Safety net | Hard spend limits of $30 production and $10 staging, plus per-person message limits (C2) |

## The first UI build ([frontend.md §10](frontend.md))

1. **Skeleton:** styling, text setup, components, tests, app manifest
2. **Sign-in:** needs **UX2** and **FE1**
3. **Layout:** the phone chat dock and desktop split. Needs **UX3**. The iPhone keyboard is the riskiest part, so test it on a real iPhone early.
4. **Chat:** running on the fake AI, with "What changed", Undo and errors
5. **Kitchen widget:** journey steps 1–4
6. **Meal ideas → Choose → Recipe → Meal plan:** needs **M5, R2**, plus **AI3** for assumed basics
7. **Sync between you two and saving across sessions:** shaped by **H2, H3**
8. **The full journey test:** automated, with accessibility checks, plus a short screen-reader pass
9. **Then:** sheets, To review, Settings, shared-kitchen cues. Needs **M6, M7, K1, D1, AI1**

The real AI gets plugged in alongside steps 4–6, behind the same contract.
Questions are needed **by the step that uses them**, not all up front.

## Top risks and how we'd reverse them

| Risk | If it happens |
|---|---|
| The iPhone keyboard covers the chat dock | It's isolated in one small piece; there's a fallback approach ready |
| The iPhone home-screen app doesn't share sign-in with Safari | The 6-digit code (UX2) avoids it |
| Free database hours run out | Slower background checking, or about $5–19/month |
| The AI misreads messages | A test set of example messages runs on every change; Undo and corrections are always available |
| Vercel's free plan is non-commercial | Move to Pro (about $20/month) or another host; it's a standard Next.js app |

## Not yet verified
Everything below gets checked on day one of the build:
- **Library versions:** some exact versions and the stability status of a few libraries (Drizzle 1.0, Base UI's bottom-sheet drawer).
- **Better Auth:** whether it can send one email with both the link and the code.
- **Neon storage:** the free plan's exact storage figure.
