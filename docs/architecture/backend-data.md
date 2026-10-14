# Backend and data architecture

**Status:** Proposed, pending Vero's review · 2026-10-13 · Backend / Data specialist
**Builds on:** spec §4, §5 and §11; decisions 0003, 0006, 0007, 0011–0013, 0015 and 0016; [ux.md](ux.md), [frontend.md](frontend.md), [ai.md](ai.md). Sections 3 and 6 are the contracts the Frontend and AI specialists build on. **§6 is the single canonical contract**, reconciled in the integration pass (see the changelog at the end).

## 1. System shape
- **One Next.js app** holds both the screens and the server code (the API). There are no separate services. Inside the app, the code is split into modules with strict boundaries (§9), so any module can be split out later.
- **AI calls run only on the server**, in a module the AI specialist owns. The phone never sees the AI key, and the model never writes to the database (0003).
- **Language and runtime:** TypeScript on Node.js 24 LTS (long-term support), with Next.js 16.

## 2. Stack
| Need | Choice and reason | Main alternative rejected |
|---|---|---|
| Framework | **Next.js 16**: screens, server actions and streamed chat in one codebase | Separate React app + API: two deploys for no gain |
| Database | **Postgres on Neon** free tier: standard SQL, good JSON support for events. The database sleeps after 5 idle minutes. | Supabase: free projects **pause after a week idle**, and it adds a public data API to lock down |
| Data access | **Drizzle ORM** (an ORM is a library that writes the SQL for you): typed, close to plain SQL, precise transactions | Prisma: heavier and more abstracted |
| Migrations | **drizzle-kit** SQL files, committed and applied on deploy (a migration is a versioned database change) | Auto-syncing the schema: leaves no history |
| Validation | **Zod**: one schema gives a runtime check, a TypeScript type and the JSON Schema for Claude's structured outputs | Hand-written checks |
| Sign-in | **Better Auth** + magic-link plugin, with sessions in our own Postgres. Sessions last 60 days and renew on use (`expiresIn` / `updateAge`), pending FE1; the library default is 7 days. *If UX2 is yes:* add the email-OTP plugin (6 digits, 5 minutes, 3 tries), and one "send sign-in email" step puts the link and the code in **one email**, where whichever is used first signs you in. That combination isn't a built-in feature, so test it early; the fallback is code-only. Auth.js is now maintained by the same team, who recommend Better Auth for new projects. | Clerk: an extra vendor holding user data |
| Email | **Resend** free tier (100 emails a day), for the login links | — |
| Hosting | **Vercel Hobby** (free), first-class for Next.js | A self-managed server: more upkeep |
| Secrets | Vercel environment variables; a git-ignored `.env.local`; a committed `.env.example` with no values. Checked at startup, and kept out of browser code. | A secrets manager: overkill for MVP |

**Two environments:**
- **Production** is for Vero and her husband.
- **Staging** is for the tester agent and preview builds.

Each environment has its own Neon project, Anthropic workspace, key and spend limit.

**Checked online on 2026-10-13:**
- Next.js 16 is the current line; Frontend found 16.4 on npm (frontend.md §4). Use one pinned version for the whole app.
- Neon's free tier includes 100 compute-hours per project per month.
- Vercel Hobby is "personal, non-commercial" use, and functions can run for up to 300 seconds.
- Resend's free tier allows 100 emails a day.
- Better Auth's magic-link plugin has a `disableSignUp` option.

**Not confirmed:**
- **Drizzle:** sources conflict on whether 1.0 is final. Pin 0.45.x.
- **Neon storage:** listed as both 0.5 GB and 1 GB. Either is ample.
- **Patch versions:** check exact versions when building starts.

## 3. Event model (spec §4, decisions 0007 and 0011)
Every change is saved as a permanent **event** (a record of something that happened). The current kitchen is computed from the events. Nothing is overwritten or deleted, apart from the privacy exceptions in §7.

**Event envelope** (the fields every event has, in every domain):

| Field | Meaning |
|---|---|
| `id`, `seq` | Unique ID; its position in the stream (1, 2, 3…) |
| `stream` | Whose history it belongs to: `kitchen:<id>` or `user:<id>` (profile) |
| `type`, `v` | For example `item.added`, plus a schema version so old events stay readable |
| `actor`, `via` | Who caused it (always set, 0006); whether it came from `chat`, `button` or `system` |
| `recordedAt`, `occurredAt` | When we saved it; when the user says it happened ("yesterday"). The second can be unknown. |
| `changeSetId` | Groups everything from one message or tap. This is the unit of **"What changed" and Undo**. |
| `sourceMessageId` | The chat message it came from |
| `reverses`, `corrects` | Links to the change set or event that this one undoes or fixes |
| `payload` | The facts. **Each field** is `{value, basis, confidence}`. |

- **`basis`** is one of:
  - `said`: the user stated it
  - `inferred`: the AI concluded it
  - `assumed`: a basic like salt (0010)
- **`confidence`** is `high`, `medium` or `low`. Buckets are more consistent than percentages from the AI.
- **Unknown** means the field is absent. It never gets a made-up default (0011). "Known to be none" is a separate, explicit value.
- **Undo** adds a `changeset.reverted` event for the whole change set. It's refused, with a reason, if a later change set touched the same items. The user then fixes it in chat. That's predictable and easy to explain.
- **A correction in chat** ("no, I froze the yogurt") adds new events with `corrects` set. This keeps a record of the AI's mistakes, which the AI specialist can use for quality checks.

**Keeping "now" fast:**
- **Projection tables** (ready-made current-state tables for items, meals, plan order, ticks and To review) are updated **in the same transaction** as the event. The two can never disagree.
- All state logic is one **pure function**, `apply(state, event)`. Undo, or a fix to that logic, rebuilds a kitchen by replaying its events, which takes milliseconds at this size. If a kitchen ever gets huge, we add snapshots.
- **History** means replaying events up to a point in time, to see "what we believed then."
- **Two people at once:** a write briefly locks its kitchen, so `seq` never collides. Proposals carry the version they were based on and are re-checked against the latest state.

## 4. Domain model
| Thing | Main fields | Notes |
|---|---|---|
| Kitchen | name, `isTest`, members | Shared (0006) |
| Item | name as said + standard name (0015), quantity as said, location (fridge, freezer or pantry), opened, frozen, addedAt | Only the name is required (0011) |
| Meal | title, `status` (`chosen`, `planned`, `cooking`, `done`, `cancelled`), recipe, plan position | `status` is checked against **one transitions table**, so the lifecycle changes with one edit and no migration (**M5**). Choosing creates the meal as `chosen`, so the recipe and `/recipe/[mealId]` have a home. The plan only lists `planned` and `cooking`, so to the user "chosen" is still not a saved list. |
| Meal idea | Stored with the assistant's message, not in the kitchen, with the `basedOnVersion` it was made from | "Add that" points at a real meal (0005), and "Your kitchen changed since these ideas" is a version check |
| Recipe | text, ingredients, steps, `source: user \| ai`, version | Refining saves a new version, and old versions stay. Suggesting vs asking is UI and prompt only (**R2**). |
| Checklist tick | meal, ingredient, `actor` | Who ticked is always stored. Shared or personal is a one-line choice in the projection (**M6**). |
| To review | kind (`add-to-kitchen` or `used-up`), items, meal, status | Fed by "Do later". Pre-ticked defaults are UI only (**M7**). |
| Chat message | per user, within a kitchen | Private per H2's Rec. Shared chats would only change a read rule. |

Every current-state row carries `createdAt/By` and `updatedAt/By`, which drive the "[Husband] · just now" cues. The expanded Kitchen view (**K1**) is just another read of the items table.

## 5. Shared context vs domain context (spec §5)
- **The shared layer is small:**
  - users and kitchen membership (the anchor for every permission check)
  - the event envelope and its provenance fields (`basis`, `confidence`, `actor`)
  - the **profile**: allergies, diets and remembered preferences, each with provenance (0012)
- **The Kitchen domain** holds items, meals, recipes, ticks, To review and the plan.
- **How future assistants read it:** each domain exposes one `public.ts` file:
  - `getProfile(userId)`
  - `getEvents(userId, {domains, since})`
  - `kitchen.getSummary(kitchenId)`

  A lint rule (an automated code check) blocks any other cross-domain import, so a Fitness assistant never reads Kitchen's tables or prompts directly. If the app is ever split into services, these functions become HTTP endpoints and the callers don't change.
- **Enforced rules (0012):** a restriction (allergy or diet) is saved only with `basis: said` and evidence from the typed text. A lasting preference is saved only with the ID of the message where the user said "yes." Whose allergies apply in a shared kitchen is pending AI1.

## 6. API contracts (canonical)
**This section is the single source of truth** for `ProposedChange`, `ApplyResult` and the chat stream. `frontend.md`, `ai.md` and `ux.md` point here. The Zod schemas live in `src/contracts/` (§9) and are imported by the AI, UI and domain code.

**There is one write path.** Chat and buttons both produce a **ProposedChange**. The backend validates and applies it, then returns an **ApplyResult**.

```ts
Fact<T>  = { value: T, basis: "said"|"inferred"|"assumed", confidence: "high"|"medium"|"low" }
           // a field that is absent (or null, if the model's schema needs every key) = unknown
Msg      = { code, params, text }       // translatable system text; `text` is the English fallback (0015)
Quantity = { asSaid, amount?, unit? }   // "2 lbs" stays as said; numbers only if obvious

ProposedChange { proposalId             // idempotency key = client message or tap ID (+ suffix per step)
  kitchenId; basedOnVersion
  source: {via:"chat", messageId, pastedRanges?: [{start,end}]} | {via:"button", action}
  operations: Operation[]
  clarification?: { question, options: [{label, reply}] }   // max 4; UI adds "Something else"
  offer?: { kind:"preference", statement }                   // "Want me to remember that?"
  notes?: Msg[] }                                            // e.g. assumed basics

Operation = common & one of the typed shapes below (a union keyed by `type`)
  common: { opId, evidence?: string, corrects?: eventId }  // evidence: the user's exact words; required via chat
  item.add          fields { name: Fact<string>, quantity?, location?: fridge|freezer|pantry, frozen?, opened?, occurredAt? }
  item.update       target {itemId}|{name}; fields: any item.add field, all optional; clear?: [field]  // back to unknown; not name
  item.use          target {itemId}|{name}; fields { usedUp?: Fact<boolean>, amountUsed?: Fact<Quantity> }
  item.remove       target {itemId}|{name}; fields { reason?: Fact<string> }
  meal.choose       target {ideaId}|{mealId}          // creates the meal (status "chosen") so the recipe has a home
  meal.plan         target {mealId}
  meal.transition   target {mealId}; to: status         // checked against the transitions table (M5)
  recipe.save       target {mealId}; source: user|ai; text; ingredients[{name, itemId?, basic?}]; steps[]; basicsAssumed[]
  checklist.tick    target {mealId}; ingredient; ticked: boolean
  review.queue      kind: add-to-kitchen|used-up; mealId; items[]
  review.resolve    target {reviewId}; outcome: done|skipped   // the actual kitchen changes are item.* ops in the same proposal
  profile.restriction.add / .remove   fields { kind: allergy|diet, subject: Fact<string> }; forUserId?
  profile.preference.save / .remove   fields { statement: Fact<string> }; confirmedByMessageId (save only)
  changeset.revert  target {changeSetId}

ApplyResult { changeSetId; newVersion; undoable; undoBlockedReason?: Msg
  applied:  [{ opId, summary: Msg, refs: [{ kind: item|meal|recipe|tick|review|profile, id, change: added|updated|removed }] }]
  rejected: [{ opId, reason: Msg }]   // codes: UNKNOWN_ITEM (bad ID), AMBIGUOUS_ITEM, EVIDENCE_NOT_FOUND, NOT_SAID,
                                      // NOT_ALLOWED, INVALID_TRANSITION, ALREADY_USED_UP, STALE_TARGET
  state: KitchenState }               // full current state; small at MVP size, so no refetch is needed
KitchenState { version, items, meals, plan, ticks, toReview }   // every row has createdAt/By, updatedAt/By
```

**Validation rules:**
- **Each operation is validated on its own.** The valid ones become one change set, and the rejected ones come back with reasons. One bad guess doesn't sink "I bought 4 things."
- **Name-only targets** (0011): if no item matches, apply records it ("wasn't in your kitchen") in the same change set. If exactly one item matches, it's used. If two match, the operation is rejected with `AMBIGUOUS_ITEM`.
- **`item.use`:** `usedUp: true` removes the item from "now". Otherwise the remainder is computed only when the amounts have the same unit, and is unknown in every other case.
- **Profile operations** need `basis: said`, and evidence found in the *typed*, not pasted, text. Operations whose evidence falls inside `pastedRanges` may only be `recipe.save`. With no ranges, a message over 1,500 characters counts as pasted. Only the profile's owner can remove a restriction (adding one for another member depends on AI1).
- **`changeset.revert`** of someone else's change set is refused while H3 follows its Rec. This is one setting.

**The chat order is fixed: interpret, then apply, then reply.** The AI's interpret call may draft a reply, but the reply is only sent after apply. If anything was rejected, the reply is re-worded from the ApplyResult. Ideas and recipes are generated after the save. The AI specialist may refine operation fields, but not this order or the envelope.

| Endpoint | Purpose |
|---|---|
| `POST /api/chat` (turn stream) | `{kitchenId, clientMessageId, text, pastedRanges?}`. A retry with the same ID replays the stored result. |
| `POST /api/meals/choose` (turn stream) | `{kitchenId, clientMessageId, ideaId \| mealId}`: applies `meal.choose`, then streams the recipe. It's also used for "Suggest one" if R2 is "ask". |
| Server actions (UI functions that run on the server, no streaming) | `undo`, `addToPlan`, `transitionMeal`, `tick`, `resolveReview`, `confirmPreference`, `removeProfileFact`. Each one builds a ProposedChange and returns an ApplyResult. |
| `GET /api/kitchens/:id/state` · `/version` · `/changes?since=` | Full state · the version number only · change-set summaries (`Msg` + actor) for "Since your last visit" |
| `GET /api/me/export`, `POST /api/me/delete` | Data controls (0015). Settings shows the export readably and offers the JSON download. |

### Turn stream (`/api/chat` and `/api/meals/choose`)
The stream is one JSON object per line (NDJSON), checked with the shared Zod schema. **Guaranteed order:** `ack` comes first; `applied` comes before any `text`; `done` or `error` comes last. Everything else may interleave.

| Event | When | Payload |
|---|---|---|
| `ack` | Auth and rate checks passed; the user's message is saved | `{turnId, messageId}` |
| `status` | A phase starts | `{phase: interpreting \| saving \| writing \| ideas \| recipe}` |
| `applied` | After apply, if there were operations | `ApplyResult` |
| `clarification` | Interpret asked instead of acting | `{question, options:[{label, reply}]}` |
| `offer` | A "Want me to remember that?" offer | `{offerId, statement}`. The buttons call `confirmPreference(offerId)`. |
| `notes` | Assumed basics and similar | `{notes: Msg[]}` |
| `text` | Reply chunks (may be a single chunk) | `{delta}` |
| `idea` | Each meal idea card, as it's ready | `{setId, basedOnVersion, idea:{ideaId, name, why, uses:[itemId], missing:[name]}}` |
| `recipe` | Recipe parts, as they're ready | `{mealId, part: meta \| ingredient \| step \| basics, data}` |
| `recipe.saved` | After `recipe.save` is applied | `{mealId, recipeId, version, newVersion}`. Not shown as a receipt. |
| `done` | The turn is complete | `{turnId, assistantMessageId}` |
| `error` | Any failure | `{reason: Msg, changed: boolean, retryable: boolean}`. `changed` is true if `applied` was already sent. |

**How the screen learns about changes:**
- **Your own change:** the ApplyResult (with `state`) comes straight back, so your widgets update immediately.
- **The other person's change:** the app polls `/version` every 15 seconds while it's visible, and again when you return to the app. After 5 idle minutes it slows to every 60 seconds. If the number changed, it reloads the state.
- **Why polling:** no extra vendor, it works on serverless hosting, and a 15-second delay is fine for a kitchen.
- **Why the slowdown:** a database that never sleeps uses about 180 compute-hours a month, and Neon's free tier gives 100.
- **How to reverse it:** the Frontend wraps this in one `useKitchenSync` hook. Switching to live updates (Ably, Pusher or Postgres notifications) only changes that hook.

## 7. Security and privacy
- **Per-kitchen authorization:** all data access goes through `requireMember(user, kitchen)`. Data functions only accept the scope object it returns, so forgetting the check fails at compile time. Tests also try to reach another kitchen and must fail. Postgres row-level security (rules enforced inside the database) can be added later as a second lock.
- **Invite-only:** an email allowlist, `disableSignUp`, and a database cap of 3 accounts. Login links and codes expire after 5 minutes and work once.
- **Tester agent:** an `isTest` account that the database restricts to `isTest` kitchens. It runs on **staging** (B14 Rec). A staging-only sign-in route serves that account, and production refuses to start if the route is enabled.
- **AI spend:**
  - an Anthropic spend limit per workspace: about $30 for production and $10 for staging, within C2's $40
  - per-user rate limits (about 60 messages an hour, 300 a day) and a per-kitchen daily AI budget (about $2, ai.md §7), kept as counters in Postgres
  - a cap on reply length
  - tokens and cost logged for every call
- **Pasted content (for the AI specialist):** pasted recipes are **data, not instructions**.
  - Wrap them in delimiters in the prompt.
  - Pasted text can only produce `recipe.save`. The backend uses `pastedRanges` and `evidence` to enforce this (§6).
  - The server never fetches links the user pastes.
  - Recipes are shown as plain text, never HTML.
  - Pastes are capped at about 20,000 characters.
- **Export** is one JSON file: your profile, your chats, and your kitchens' events and state.
- **Delete** removes your account, chats and profile.
  - The kitchen events you made stay, labelled "former member" (D1 Rec).
  - The kitchen itself goes when its last member deletes.
  - This is the one deliberate exception to "never delete." Neon's free backups keep only 6 hours, so deleted data is fully gone after that.

## 8. Testing
- **Unit tests (Vitest)** cover `apply` and the validator, using the primary journey (0005) as fixtures. The key check: **replaying all events gives the same state as the step-by-step updates.**
- **Integration tests** run on real Postgres (Docker locally, a Neon branch in CI). They cover cross-kitchen denial, retries, two people writing at once, and Undo conflicts.
- **Contract tests:** every example in the AI specialist's test set must produce a ProposedChange that passes the shared Zod schema.
- **End-to-end tests (Frontend, with Playwright)** use a fake interpreter with fixed answers, so runs are repeatable. The tester agent uses the real model.
- **Regressions:** every bug gets a test that fails without the fix.
- **Clean test kitchen:** `POST /api/test/reset` (staging and the test account only) wipes the test kitchen and can load a named starting scenario, such as "empty" or "after shopping."

## 9. Repo layout
```
src/app/              Next.js pages and thin route handlers
src/contracts/        Zod: ProposedChange, ApplyResult, KitchenState, turn stream (§6)
src/shared/           identity, membership, event store, profile, context reader
src/domains/kitchen/  events, apply, validate, commands, queries, public.ts
src/ai/               AI specialist: interpreter, prompts, model client, eval set
src/ui/               Frontend: widgets, chat, useKitchenSync
src/db/               Drizzle schema, migrations, client
src/lib/              env, rate limits, i18n, logging
tests/  scripts/      integration and e2e tests; seed, reset, rebuild-projections
```
The UI and AI code reach the domains only through `commands` and `queries`. Domains reach each other only through `public.ts`.

## Questions for Vero
These are now tracked in `OPEN-QUESTIONS.md`.
1. **H2: chats in the shared kitchen.** Can you see each other's chats?
   Rec: no. Chats stay private, while the kitchen, plan and "who changed what" are shared.
2. **D1: deleting data (0015).** What happens to the items you added?
   Rec: they stay, shown as added by "a former member." The kitchen is deleted only when its last member deletes.
3. **B14: where the tester agent runs.**
   Rec: on a staging copy. It's the same code, with no risk to your kitchen and no test back door in the live app.
4. **H3: undoing someone else's change.**
   Rec: Undo covers only your own changes. You fix their in chat, and the fix is recorded as yours.

## Risks and how we'd reverse
| Risk | Reversal |
|---|---|
| Vercel Hobby is non-commercial only | Move to Pro (about $20/month) or any Node host. The app is standard Next.js. |
| Neon's free compute runs out | Tighten the polling slowdown, or upgrade (about $5–19/month). The tester agent already uses a separate project. |
| Backups cover only 6 hours | The event log makes mistakes recoverable. Add a nightly export if the data becomes precious. |
| Drizzle 1.0 breaks its API | Stay pinned and upgrade on purpose. The queries are near plain SQL. |
| Polling feels slow | Swap `useKitchenSync` to live updates. |
| Replaying events gets slow | Add snapshots. The event log doesn't change. |
| The M5 lifecycle changes | Edit the transitions table. Old events stay valid. |
| Better Auth disappoints | Users live in our own tables, so switch libraries and keep the data. |

## Contract changelog (integration pass, 2026-10-13)
| Request | Outcome |
|---|---|
| FE: `applied[].refs` | **Accepted.** `{kind, id, change}` drives focus and highlights. |
| FE: `{code, params}` on summaries and rejections | **Accepted** as `Msg {code, params, text}`. System text is translatable. AI-written replies are already in the user's language. |
| FE: `updatedAt/By` on rows; state with ApplyResult | **Accepted.** `state` is always included, since it's small at MVP size. Dropping it later would cost one refetch. |
| FE: session length; link + code email | **Accepted as settings:** 60 days rolling (FE1), and one email carrying both if UX2 is yes (§2) |
| FE: stream events; how Choose streams | **Accepted and merged** into the turn stream table. Choose uses `POST /api/meals/choose`, a turn stream like chat, because server actions don't stream well. |
| AI 1: typed fields per operation | **Accepted.** `Operation` is a union keyed by `type`. |
| AI 2: `evidence` | **Accepted.** Required for chat; the backend checks it for profile operations. |
| AI 3: `clarification.options` | **Accepted** as `{label, reply}`, max 4 |
| AI 4: name-only targets | **Accepted.** No match records the item; two matches give `AMBIGUOUS_ITEM`. `UNKNOWN_ITEM` now means only a bad ID. |
| AI 5: `clear: [field]` | **Accepted,** except `name` |
| AI 6: `usedUp`, `amountUsed` | **Accepted.** The remainder is computed for the same unit only, and is unknown otherwise. |
| AI 7: `profile.restriction.add/.remove` | **Accepted.** Only the owner can remove a restriction; adding one for another member depends on AI1. |
| AI 8: `pastedRanges` | **Accepted,** with a 1,500-character fallback |
| AI pipeline: draft, re-word, generate after save | **Accepted.** The draft is only sent after apply, so interpret → apply → reply holds. |
| Added by Backend | `src/contracts/`; `meal.choose` creates a `chosen` meal; `/changes?since=` for "Since your last visit"; `offer` and `recipe.saved` stream events |
