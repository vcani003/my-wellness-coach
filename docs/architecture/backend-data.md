# Backend and data architecture

**Status:** Proposed, pending Vero's review · 2026-10-13 · Backend / Data specialist
**Builds on:** spec §4, §5 and §11; decisions 0003, 0006, 0007, 0011–0013 and 0015–0021; [ux.md](ux.md), [frontend.md](frontend.md), [ai.md](ai.md). Sections 3 and 6 are the contracts the Frontend and AI specialists build on. **§6 is the single canonical contract**, reconciled in the integration pass (see the changelog at the end).

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
| Sign-in | **Better Auth** + magic-link and email-OTP plugins, with sessions in our own Postgres. Sessions are **rolling, 1 year**, renewed on use (`expiresIn` / `updateAge`), per FE1's Rec; the library default is 7 days. **Sign out everywhere** in Settings revokes all your sessions (`revokeSessions`). One "send sign-in email" step puts the link and a 6-digit code (5 minutes, 3 tries) in **one email** (UX2, 0017), where whichever is used first signs you in. That combination isn't a built-in feature, so test it early; the fallback is code-only. Auth.js is now maintained by the same team, who recommend Better Auth for new projects. | Clerk: an extra vendor holding user data |
| Sign-in, built now (SU1 Rec, 2026-10-14) | **Invite link + own passphrase**, no new dependency: `node:crypto` scrypt for passphrases, single-use 24-hour links whose token is stored only as an SHA-256, the same signed session cookie as the access codes (§7). **If Vero approves SU1, it replaces the Better Auth / email row above, and Resend (below) and setup task S4 are no longer needed.** | Better Auth + email links: needs Resend and an email per sign-in, for two people |
| Email | **Resend** free tier (100 emails a day), for the login links. *Not needed if SU1 is approved.* | — |
| Hosting | **Vercel Hobby** (free), first-class for Next.js | A self-managed server: more upkeep |
| Secrets | Vercel environment variables; a git-ignored `.env.local`; a committed `.env.example` with no values. Checked at startup, and kept out of browser code. | A secrets manager: overkill for MVP |

**Two environments:**
- **Production** is for Vero and her husband.
- **Staging** is for the two tester agents (0021) and preview builds.

Each environment has its own Neon project, Anthropic workspace, key and spend limit.

**Checked online on 2026-10-13:**
- Next.js 16 is the current line; Frontend found 16.4 on npm (frontend.md §4). Use one pinned version for the whole app.
- Neon's free tier includes 100 compute-hours per project per month.
- Vercel Hobby is "personal, non-commercial" use, and functions can run for up to 300 seconds.
- Resend's free tier allows 100 emails a day.
- Better Auth's magic-link plugin has a `disableSignUp` option.

**Pinned on 2026-10-14 (npm registry), exact versions in `package.json`:** Next.js 16.4.0, React 19.3.0, Zod 4.6.7, **drizzle-orm 0.45.4 + drizzle-kit 0.31.11** (1.0 is still `beta.22`, so not used), PGlite 0.5.9, Vitest 5.0.4, TypeScript 5.9.3 (what create-next-app 16.4 scaffolds; TypeScript 7 exists but wasn't tried), ESLint 10.12.0.

**Not confirmed:**
- **Neon storage:** listed as both 0.5 GB and 1 GB. Either is ample.
- **Neon driver (built 2026-10-14, not yet run against a real Neon database):** Neon's HTTP driver can't run interactive transactions, which the write path needs (lock, then write). `src/db/client.ts` uses its **WebSocket `Pool` driver** (`@neondatabase/serverless` 1.2.0 + `drizzle-orm/neon-serverless`) when `DATABASE_URL` is set, and PGlite otherwise. Drizzle checks out one pooled connection for each `db.transaction`, so `SELECT … FOR UPDATE` holds until commit. Node 22+ has a built-in WebSocket, so no `ws` package is needed on Node 24.

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
| Item | name as said + standard name (0015), its **batches**, and fields derived from them: quantity, location (fridge, freezer or pantry), opened, frozen, `stock` (`low` or `out`; absent = unknown), addedAt, `defrostedOn` | Only the name is required (0011). `out` takes it off the current list; history keeps it. It stays **the one row on the Kitchen list** (0025). Derived: age, location, frozen and opened come from the **oldest open batch** (the one used next); quantity is the one batch's, or the sum when every open batch has an amount in the same unit, else unknown; `stock` is `low` only when every open batch is low, and `out` once none is open. The `items` table keeps writing these columns, so code from before batches still reads it (0028). |
| Item batch (0025) | added on (when said, else recorded), quantity as said, location, frozen, opened, `defrostedOn`, `stock` (`low`; Out = closed), who added it (`createdBy`), `keptAt` ("Still have them"), `closedAt` + reason (`used-up`, `gone`, `replaced`) | **Up to 3 open per item** (`MAX_OPEN_BATCHES`). Closed batches stay in history (table `item_batches`). Items from before batches have one batch whose ID is the item's own (migration 0008 backfill = a replay of the old events). Not in MVP 1: hand-editing, splitting or merging batches, expiry dates. |
| Meal | title, `status` (`chosen`, `planned`, `cooking`, `done`, `cancelled`), recipe, plan position, after-cooking `note` | `status` is checked against **one transitions table** (lifecycle approved in 0013), so it can change later with one edit and no migration. Choosing creates the meal as `chosen`, so the recipe and `/recipe/[mealId]` have a home. The plan only lists `planned` and `cooking`, so to the user "chosen" is still not a saved list. |
| Meal idea | Stored with the assistant's message, not in the kitchen, with the `basedOnVersion` it was made from and its card `position` | "Add that" points at a real meal (0005), and "Your kitchen changed since these ideas" is a version check. "The second one" resolves against the set **this user** was shown last, in card order (`getLatestIdeaSet`). |
| Recipe | text, ingredients, steps, `source: user \| ai`, version | Refining saves a new version, and old versions stay. Suggesting vs asking is UI and prompt only (**R2**). |
| Checklist tick | meal, ingredient, `actor` | **Shared** by the kitchen; who ticked is stored and shown (M6, 0013). |
| To review | kind (`add-to-kitchen` or `after-cooking`), `origin` (`meal` or `shopping-list`), items, meal (meal cards only), status | Fed by "Do later". The after-cooking step's wording and defaults are UI only (**M8**). The shopping list has **one** card at a time; its items are list items, and it only shows the ones still open on the list (SL6 Rec). |
| Shopping-list item (0027) | name as said + standard name (0015), quantity as said, `store` (SL1; absent = "Anywhere"), `source` (`chat`, `staples`, `recipe`, `stock-offer`), ticked (who + when), `status` (`open`, `removed`, `moved` + the kitchen item it became) | **Shared** by the kitchen. Adding something already open on the list **merges** (a newly given store or quantity wins). Removed and moved items stay in history; `KitchenState` lists only open ones, in the order added. |
| Chat message | per user, within a kitchen: role (`user` / `assistant`), text as typed or pasted, the turn's `clientMessageId`, and for a reply its `changeSetId` and receipt (the ApplyResult without `state`) | Private (H2, 0017). Table `chat_messages` (P2 a); not events, so a delete really removes them (0015). Shown as plain text only. |

Every current-state row carries `createdAt/By` and `updatedAt/By`, which drive the "Levi · just now" cues. The expanded Kitchen view (K1, view-only) is just another read of the items table.

## 5. Shared context vs domain context (spec §5)
- **The shared layer is small:**
  - users and kitchen membership (the anchor for every permission check)
  - the event envelope and its provenance fields (`basis`, `confidence`, `actor`)
  - the **profile**: allergies (each with the person's own **note**, 0019), diets and remembered preferences, each with provenance (0012)
- **The Kitchen domain** holds items, meals, recipes, ticks, To review and the plan.
- **How future assistants read it:** each domain exposes one `public.ts` file:
  - `getProfile(userId)`
  - `getEvents(userId, {domains, since})`
  - `kitchen.getSummary(kitchenId)`

  A lint rule (an automated code check) blocks any other cross-domain import, so a Fitness assistant never reads Kitchen's tables or prompts directly. If the app is ever split into services, these functions become HTTP endpoints and the callers don't change.
- **Enforced rules (0012):** a restriction (allergy or diet) is saved only with `basis: said` and evidence from the typed text. A lasting preference is saved only with the ID of the message where the user said "yes." **Every member's allergies** apply to every request in the kitchen; diets and preferences apply only to the asker (0019).

## 6. API contracts (canonical)
**This section is the single source of truth** for `ProposedChange`, `ApplyResult` and the chat stream. `frontend.md`, `ai.md` and `ux.md` point here. The Zod schemas live in `src/contracts/` (§9) and are imported by the AI, UI and domain code.

**There is one write path.** Chat and buttons both produce a **ProposedChange**. The backend validates and applies it, then returns an **ApplyResult**.

```ts
Fact<T>  = { value: T, basis: "said"|"inferred"|"assumed", confidence: "high"|"medium"|"low" }
           // a field that is absent (or null, if the model's schema needs every key) = unknown
Msg      = { code, params, text }       // translatable system text; `text` is the English fallback (0015)
Quantity = { asSaid, amount?, unit? }   // "2 lbs" stays as said; numbers only if obvious
AllergenFlag = { ingredient, userId, subject, note? }   // computed by code from current profiles on every read; never stored

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
  item.use          target {itemId}|{name}; fields { stock?: Fact<low|out>, amountUsed?: Fact<Quantity> }
  item.remove       target {itemId}|{name}; fields { reason?: Fact<string> }        // the whole item, every batch
  // Batches (0025). ItemBatchTarget = {itemId} | {name} | {itemId, batchId} | {itemId|name, which: oldest|newest};
  // item.update and item.use take an ItemBatchTarget. BatchTarget = the last three (exactly one batch).
  item.batch.close  target BatchTarget                               // "Those are gone"
  item.batch.keep   target {itemId, batchId}                         // "Still have them"; button only, not in the AI's schema
  item.defrost      target ItemBatchTarget; fields { defrostedOn?: Fact<datetime> }   // absent = now (basis inferred)
  meal.choose       target {ideaId}|{mealId}|{title, notes?}   // creates the meal (status "chosen") so the recipe has a home
                    // {title, notes?} = a dish named in chat (MI1): always a new meal, no idea; notes = the user's words, kept in the event only
  meal.plan         target {mealId}|{ideaId}                     // {ideaId} = the live meal chosen from that card
  meal.transition   target {mealId}|{ideaId}; to: status; note?: string   // transitions table; note only with to: done (after-cooking)
  recipe.save       target {mealId}; source: user|ai; text; ingredients[{name, amount?, itemId?, basic?}]; steps[]; basicsAssumed[]
                    // amount as written ("1 cup"), kept as said (0015)
  checklist.tick    target {mealId}; ingredient; ticked: boolean
  review.queue      kind: add-to-kitchen|after-cooking; mealId?; items: [{name, itemId?} | {shoppingItemId}]
                    // no mealId = the shopping list's Done-shopping "Do later" (kind add-to-kitchen, list items only)
  review.resolve    target {reviewId}; outcome: done|skipped; items?: shopping.done's items
                    // meal card: the kitchen changes are item.* ops in the same proposal;
                    // shopping-list card + done: `items` go through shopping.done's rules in this op
  profile.restriction.add / .update / .remove   fields { kind: allergy|diet, subject: Fact<string>, note?: Fact<string> }; forUserId?
  profile.restriction.verify   target {restrictionId}      // owner's "Keep" in Settings (AI7); button only, not in the AI's schema
  profile.preference.save / .remove   fields { statement: Fact<string> }; confirmedByMessageId (save only)
  shopping.add      fields { name: Fact<string>, quantity?: Fact<Quantity>, store?: Fact<string> }; source?: chat|staples|recipe|stock-offer  // absent = chat
  shopping.update   target {shoppingItemId}|{name}; fields: any shopping.add field, all optional; clear?: [quantity|store]
  shopping.tick     target {shoppingItemId}|{name}; ticked: boolean      // "got it" (0027), not bought or used
  shopping.remove   target {shoppingItemId}|{name}
  shopping.done     items: [{ shoppingItemId, fields?: { quantity?, location?, frozen?, opened? } }]   // "Done shopping" (SL2)
  changeset.revert  target {changeSetId}

ApplyResult { changeSetId; newVersion; undoable; undoBlockedReason?: Msg
  applied:  [{ opId, summary: Msg, refs: [{ kind: item|meal|recipe|tick|review|profile|shopping, id, change: added|updated|removed, batchId? }],
               batchOffers?: BatchOffer[] }]   // 0025: a new batch next to older open ones (item.add, shopping.done, review.resolve)
  rejected: [{ opId, reason: Msg }]   // codes: UNKNOWN_ITEM (bad ID), AMBIGUOUS_ITEM, EVIDENCE_NOT_FOUND, NOT_SAID,
                                      // NOT_ALLOWED, INVALID_TRANSITION, ALREADY_OUT, STALE_TARGET (+ build additions, changelog)
  state: KitchenState }               // full current state; small at MVP size, so no refetch is needed
KitchenState { version, items, meals, plan, ticks, toReview, shoppingList }   // every row has createdAt/By, updatedAt/By;
                                                                // meals carry allergenFlags[]
ShoppingItemRow { id, name: Fact, standardName, quantity?, store?: Fact<string>, source, ticked?: { by: ActorRef, at } }
ItemRow  += { defrostedOn?: Fact<datetime>, batches?: BatchRow[] }   // open batches, oldest first; optional only for older cached states
BatchRow { id, addedAt, quantity?, location?, frozen?, opened?, stock?: Fact<low>, defrostedOn?, keptAt?, lastUsedAt?, + audit (createdBy = who added it) }
BatchOffer { itemId, name, newBatchId, older: [{batchId, addedAt, quantity?}] (oldest first, min 1), autoClosed?: {batchId, addedAt} }
           // "You also had eggs from Oct 2: Still have them · Those are gone". Show while isBatchOfferOpen(offer, state).
ActorRef = {id, name} | {id, missing: true, former: true} | {id, missing: true}   // former = deleted their data (D1): "a former member"
                                                                // open items only, in the order added; defaults to []
```

**Validation rules:**
- **Each operation is validated on its own.** The valid ones become one change set, and the rejected ones come back with reasons. One bad guess doesn't sink "I bought 4 things."
- **Name-only targets** (0011): if no item matches, apply records it ("wasn't in your kitchen") in the same change set. If exactly one item matches, it's used. If two match, the operation is rejected with `AMBIGUOUS_ITEM`.
- **`item.use`:** `stock: out` removes the item from "now"; `low` keeps it, labelled "Running low"; no `stock` means amount unknown. A remainder is computed only when the amounts have the same unit. Adding the same item again adds a batch (see Batches below), so a Low item next to a fresh batch is no longer Low.
- **After cooking (0013):** `meal.transition` to `done` records every in-kitchen ingredient as **used in this meal, amount unknown**. The after-cooking step adds an `item.use` with `stock` for each "Running low" / "Out", and its optional `note` is saved on that cooking session. Skip adds nothing more (M8 Rec).
- **Batches (0025):**
  - **Buying something already in the kitchen adds a batch.** `item.add` (and `shopping.done`'s rules) matches by standard name: an item with open batches gets a new batch (`item.batch.added`); an Out item comes back with it (`ITEM_RESTOCKED`); otherwise a new item with its first batch. Several matches (duplicates saved before batches) → the most recently changed. Summary `ITEM_BATCH_ADDED {name, batches, closedOldest, fromList}`, plus a `batchOffer` listing the other open batches.
  - **A 4th open batch closes the oldest** (`item.batch.closed`, reason `replaced`) in the same change set, before the new one is added; the offer carries `autoClosed`. History keeps it; Undo reopens it.
  - **`item.use` without a batch:** an amount comes off the **oldest batch first** and spills into the next when the units match; a batch at 0 closes (auto-Out). `stock` applies to the whole item: Out closes every open batch, Low marks every open batch. **With a batch** (`batchId` or `which`): only that batch. The item is Out once its last batch closes, and drops off the list (0011). Summaries add `ITEM_BATCH_USED_UP {name, left}`. Finishing a meal records the oldest batch as used.
  - **`item.update`:** a new name applies to the item; every other field to the named batch, else the oldest open one, else (Out) the last one.
  - **`item.batch.close`** ("Those are gone"): `ITEM_BATCH_GONE {name, left}`, or `ITEM_OUT` for the last one; an already-closed batch is a no-change. **`item.batch.keep`** ("Still have them"): sets `keptAt`, summary `ITEM_BATCH_KEPT` with no refs. It is **soft**: not undoable, and it never blocks undoing the purchase it answered (`SOFT_SUMMARY_CODES`). **`item.defrost`:** `defrostedOn` (said, else now) and `frozen: false` (inferred) on the named batch, else the oldest frozen one, else the oldest; an unknown item is recorded first (0011). Summary `ITEM_DEFROSTED`.
  - A bad batch ID → `UNKNOWN_TARGET`; a closed batch → `ALREADY_OUT`. An **exact batch ID is never `STALE_TARGET`** for `item.batch.close` / `.keep`, so a receipt's choice still works after other changes to the item.
  - **Saved chat receipts** redraw a batch choice only while one of its older batches is still open and unanswered (`getUnansweredBatchIds` in `public.ts`).
  - **Use-it-up signals** (`getUseItUpSignals` / pure `computeUseItUpSignals`, `src/domains/kitchen/use-it-up.ts`): per current item, the oldest batch's ID, date and age in days, the batch count, the latest `defrostedOn` and days since, and Low. The ranking stays with the AI.
- **Profile operations** need `basis: said`, and evidence found in the *typed*, not pasted, text. Operations whose evidence falls inside `pastedRanges` may only be `recipe.save`. With no ranges, a message over 1,500 characters counts as pasted. Only the profile's owner can update a restriction's note, remove it or verify it (`NOT_ALLOWED` otherwise); adding one for another member needs the speaker's confirmation (ai.md §4). **Verified (AI7, 0019):** a restriction is verified when its owner added it, edited its note, or tapped Keep (`profile.restriction.verify`, event `profile.restriction.verified`; already verified → `NO_CHANGE`). Until then Settings shows "Added by {name}". Undo of a Keep makes it unverified again. The `note` is stored as said and only ever shown back, never interpreted.
- **`changeset.revert`** of someone else's change set is refused with `NOT_ALLOWED` (H3, 0017).
- **Shopping list (0027):**
  - **`shopping.add` merges:** if an item with the same standard name is open on the list, nothing is duplicated. A newly given store or quantity replaces the old one (`SHOPPING_STORE` / `SHOPPING_UPDATED`); otherwise it's a no-change `SHOPPING_ALREADY`. A store that matches one already on the list, ignoring case and punctuation, keeps that spelling, so the groups don't split (SL1).
  - **Name targets** match open items only, like kitchen items: exact standard name, then all the words. None → a no-change `SHOPPING_NOT_FOUND`; two → `AMBIGUOUS_ITEM`. An ID that's no longer open → `NOT_ON_LIST`; an unknown ID → `UNKNOWN_TARGET`.
  - **Ticks are shared.** Ticking something already ticked changes nothing, so the first person's tick stands.
  - **`shopping.done`** (SL2) is all or nothing. Every chosen item must be open (`NOT_ON_LIST`) and ticked (`NOT_TICKED`), with no repeats (`INVALID_OPERATION`). Each goes into the kitchen with `item.add`'s rules: it restocks a low or out item of the same name, otherwise it's a new item. The list's quantity is used unless `fields.quantity` is given. Then the list item is marked `moved`, linked to the kitchen item. It's one change set, so one Undo restores both. Ticked items that weren't chosen stay on the list.
  - **SL5 Rec (pending Vero, easy to switch off):** `item.add` **via chat** ("I bought garlic") also marks any open list item with the same standard name as moved, in the same change set (`ITEM_ADDED_FROM_LIST`). It's one rule in `validate.ts` behind `SL5_BOUGHT_IN_CHAT_CLEARS_LIST`. Buttons don't trigger it.
  - **"Do later" from the Done-shopping sheet** is `review.queue` with no `mealId`: every entry is `{shoppingItemId}` of an item **open** on the list (`NOT_ON_LIST`, `UNKNOWN_TARGET`; repeats or a non-list entry → `INVALID_OPERATION`). It needn't be ticked, since the sheet lets you choose unticked items. The list doesn't change. If a shopping-list card is already pending, the new items are **added to it** (`review.updated`; entries no longer on the list are pruned; nothing new → no change). Summary `SHOPPING_REVIEW_QUEUED {names}`.
  - **Resolving that card:** `done` needs `items` (a subset of the card) and runs **exactly** `shopping.done`'s checks and events, then `review.resolved`, all in one operation: if any item is refused, nothing moves and the card stays. One change set, one Undo (it restores the list, the kitchen and the card). Summary `SHOPPING_DONE`. `skipped` only closes the card. `items` on a meal card, or with `skipped`, → `INVALID_OPERATION`. Queued items not chosen stay on the list.
  - **Reading the card:** `KitchenState.toReview` shows a shopping-list card's entries that are still open on the list, named as on the list now, and leaves the card out when none are (bought in chat, removed, or added with Done shopping). An Undo that puts them back brings it back. No extra events are needed for this.
  - **Pasted text may produce `shopping.add`** as well as `recipe.save` (0027: "pasting a whole list"). Every other shopping operation needs typed evidence.

**Defensive reads (0018).** A read never throws to the UI because of bad or missing data:
- A missing referenced row (item, meal, actor) comes back as `{id, missing: true}`; the UI shows its fallback ("Unknown item", "Someone"). An unknown location is simply absent ("Not sure where").
- Each row is checked with the Zod schema on the way out; a row that fails is left out and logged, and the rest is returned.
- A projection that disagrees with its events is rebuilt from the log (`rebuild-projections`), not patched.
- Failed writes are already all-or-nothing: an `error` or a rejection, with the kitchen unchanged.

**The chat order is fixed: interpret, then apply, then reply.** The AI's interpret call may draft a reply, but the reply is only sent after apply. If anything was rejected, the reply is re-worded from the ApplyResult. Ideas and recipes are generated after the save. The AI specialist may refine operation fields, but not this order or the envelope.

| Endpoint | Purpose |
|---|---|
| `POST /api/chat` (turn stream) | `{kitchenId, clientMessageId, text, pastedRanges?}`. A retry with the same ID replays the stored result. The user's message is saved on arrival (before `ack`) and the reply with its receipt at `done` (`assistantMessageId` is the saved reply's ID; a retry gets the first one). The interpreter's recent turns are **this user's last 10 saved messages** in this kitchen; a `history` field from older clients is accepted and ignored. A failed save or load is logged and the turn carries on (0018). |
| `GET /api/chat/history?kitchenId=…&before=<cursor>&limit=30` | **Your own** saved chat in that kitchen (H2, 0017), through `getScope`/`requireMember`. Returns `ChatHistoryPage {messages, nextCursor}` (`src/contracts/chat-history.ts`): the newest page first, **oldest first within the page**; pass `nextCursor` as `before` for older ones (null = no more). `limit` 1–100, default 30. Each message is `{id, clientMessageId, role, text, createdAt, receipt}`; `receipt` (replies that applied something, else null) is the ApplyResult without `state`, with `undoable` worked out again on read: only your own change set that saved, isn't an undo and hasn't been undone. A later conflicting change still refuses the Undo when tapped (`UNDO_CONFLICT`). 400 bad query, 403 not a member, 500 `HISTORY_UNAVAILABLE`. |
| `POST /api/meals/choose` (turn stream) | `{kitchenId, clientMessageId, ideaId \| mealId}`: applies `meal.choose` (a button tap, `clientMessageId` = tap ID), then the recipe: a meal that already has one gets its saved recipe as `recipe` parts (no AI, no `recipe.saved`); otherwise a suggested one is streamed, saved and confirmed with `recipe.saved`. Nothing goes to chat, so `done.assistantMessageId` is the turn ID. Counts against the chat rate limit. It's also used for "Suggest one" if R2 is "ask". |
| Server actions (UI functions that run on the server, no streaming) | `undo`, `addToPlan`, `transitionMeal`, `tick`, `resolveReview`, `confirmPreference`, `removeProfileFact`. Each one builds a ProposedChange and returns an ApplyResult. **Built for the shopping list** (`src/app/actions.ts`, each `{kitchenId, tapId, basedOnVersion, …}`): `addToShoppingList {source, items:[{name, quantity?, store?}]}`, `tickShoppingListItem` / `untickShoppingListItem` / `removeShoppingListItem {shoppingItemId}`, `finishShopping {items:[{shoppingItemId, fields?}]}`, `queueShoppingForLater {shoppingItemIds}` ("Do later"), `resolveToReview {reviewId, outcome, shoppingItemIds?}` (the shopping-list card's Add / Skip). **Built for meals (P2 d):** `chooseMeal {kitchenId, tapId, ideaId \| mealId}` → `{ok, result, mealId, recipe: RecipeView \| null, notes, reply}` (the choose route's steps, collected); `addMealToPlan` / `startCooking` / `cancelMeal {…, mealId}`; `finishCooking {…, mealId}` → `{ok, result, updateKitchen: UpdateKitchenPrompt \| null}`; `submitUpdateKitchen {…, mealId, items:[{itemId, stock: have\|low\|out}], note?, reviewId?}` (one change set; with `reviewId` the To review card closes in it too); `updateKitchenLater {…, mealId, items:[{itemId, name}]}` ("Do later"); `skipUpdateKitchen {…, reviewId}` (Skip on the card; Skip on the fresh sheet needs no call); `tickRecipeIngredient {…, mealId, ingredient, ticked}` (shared, M6); `addRecipeNeedsToList {…, mealId, names?}` (the recipe's Need group, source `recipe`, 0027). |
| `GET /api/kitchens/:id/state` · `/version` · `/changes?since=` | Full state · the version number only · change-set summaries (`Msg` + actor) for "Since your last visit" |
| `GET /api/me/export` (built, P2 b) | Your data as one JSON download (`content-disposition: attachment; filename="kitchen-data-YYYY-MM-DD.json"`, format `kitchen-assistant-export` v1): `you`; `profile` (restrictions with `addedBy` / `verified`, preferences, your `user:` event stream); `chats` (**only yours**, every kitchen, H2); `mealIdeas` (the cards you were shown); `kitchens[]` (members, `KitchenState`, full event stream), each read through `requireMember`. 401 signed out, 500 `EXPORT_FAILED`. Built in `src/server/account/export.ts`. |
| `POST /api/me/delete` (built, P2 b) | Body `{confirm: "delete my data"}` (`DELETE_CONFIRMATION_PHRASE` in `src/contracts/settings.ts`; case and outer spaces ignored), same-origin only. Deletes your data (§7) and clears this device's cookie → 200 `{ok: true}`; the UI then goes to `/unlock`. 400 `CONFIRMATION_REQUIRED`, 401, 403 cross-site, 500 `DELETE_FAILED` (nothing deleted). |
| Batch server actions (built, 0025, `src/app/batches/actions.ts`) | `closeBatch` ("Those are gone") and `keepOlderBatch` ("Still have them") `{kitchenId, tapId, basedOnVersion, itemId, batchIds}` (1–3; the offer's `older[].batchId`s) → `{ok: true, result: ApplyResult}` or `{ok: false, reason, retryable}`. Queries: `getItemBatches(itemId)` (the view-only list behind the row), `getUseItUpSignals`. |
| Settings server actions (built, P2 b, `src/app/settings/actions.ts`) | `loadSettings()` → `SettingsView \| null` (`src/contracts/settings.ts`: `me`, `kitchen {id, name, isTest, version}`, `members [{id, name, isYou, hasPassphrase}]`, `accountsFull` (SU1: 4 real accounts, 0006), `restrictions [{id, kind, subject, note?, addedBy: ActorRef, addedAt, addedByYou, verified, verifiedAt?}]`, `preferences [{id, statement, savedAt}]`; null = signed out or couldn't load). `verifyRestriction` / `removeRestriction {tapId, restrictionId}` → `{ok: true, result: ApplyResult, settings}` or `{ok: false, reason, retryable}` (someone else's → `NOT_ALLOWED`). `signOut()` (this device) and `signOutEverywhere()` (every device, 0017); both redirect to `/unlock`. |

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
| `idea` | Each meal idea card, as it's ready, **in card order** (stored before it's sent, so its Choose works at once) | `{setId, basedOnVersion, idea:{ideaId, name, why, uses:[itemId], missing:[name], allergenFlags:[]}}`. Flags cover the name, the used items' names and the missing ones. |
| `ideas.dropped` | The idea set failed part-way (e.g. a refusal) | `{setId}`: remove those cards; they were deleted and can't be chosen. |
| `recipe` | Recipe parts, as they're ready | `{mealId, part: meta \| ingredient \| step \| basics, data}`; `meta` carries `allergenFlags` |
| `recipe.saved` | After `recipe.save` is applied | `{mealId, recipeId, version, newVersion}`. Not shown as a receipt (its own change set). `recipe` parts with no `recipe.saved` after them by `done` weren't saved: drop them. |
| `update-kitchen` | After "I made it" applied (0013, M8) | `UpdateKitchenPrompt {mealId, title, items:[{itemId, name}]}`: open "Update your kitchen" for these in-kitchen ingredients (the ones `done` recorded as used). |
| `done` | The turn is complete | `{turnId, assistantMessageId}` |
| `error` | Any failure | `{reason: Msg, changed: boolean, retryable: boolean}`. `changed` is true if `applied` was already sent. |

**Meal follow-ups (P2 d).** The interpreter's `followUps` run after the reply's first `text`, in order; each adds its own reply line as another `text` (joined with a blank line, and saved as one reply). Each is isolated: a failure is logged and becomes "Sorry, I couldn't finish that just now. What I saved is still saved.", and the turn still ends with `done`.
- `ideas`: `status: ideas`, then `idea` per card (stored with `recordMealIdeas`, set ID `<clientMessageId>:ideas`, so a retried message re-sends the stored set without a new AI call), then `notes` (e.g. `BASICS_ASSUMED`). The AI gets every member's allergies with their notes and the asker's preferences (`getMealProfileContext`).
- `recipe`: `status: recipe`, `recipe` parts, then the `recipe.save` is applied as its own change set (proposal `<clientMessageId>:recipe:<mealId>`) and confirmed with `recipe.saved` and `notes`. Refining ("no oven") sends the current `RecipeView` and saves a new version.
- `meal-step` ("plan the omelette" while it's only a card) is **folded into the main proposal** as `meal.plan` / `meal.transition` on `{ideaId}`, so choose + plan is one change set, one receipt, one Undo.
- `after-cooking`: `update-kitchen`, built from the `done` operation's item refs.
- Known limit: the recipe saved right after a choose touches the meal, so Undo on "Chose X" is then refused (`UNDO_CONFLICT`); Cancel is the way out.

**Receipts for the shopping list.** There's no new stream event: `applied` carries the list in `state.shoppingList`, and each operation has one summary. A pasted 10-item list gives up to 10 lines (`SHOPPING_ADDED` / `SHOPPING_ADDED_STORE`, plus `SHOPPING_ALREADY` for a merged repeat, which has no refs); the receipt may group them. `shopping.done` gives one line, `SHOPPING_DONE {count, names}`, with refs for each kitchen item (`added` or `updated`) and each list item (`removed`). A list item that leaves the list, removed or moved, is a `shopping` ref with `change: removed`.

**How the screen learns about changes:**
- **Your own change:** the ApplyResult (with `state`) comes straight back, so your widgets update immediately.
- **The other person's change:** the app polls `/version` every 15 seconds while it's visible, and again when you return to the app. After 5 idle minutes it slows to every 60 seconds. If the number changed, it reloads the state.
- **Why polling:** no extra vendor, it works on serverless hosting, and a 15-second delay is fine for a kitchen.
- **Why the slowdown:** a database that never sleeps uses about 180 compute-hours a month, and Neon's free tier gives 100.
- **How to reverse it:** the Frontend wraps this in one `useKitchenSync` hook. Switching to live updates (Ably, Pusher or Postgres notifications) only changes that hook.

## 7. Security and privacy
- **Per-kitchen authorization:** all data access goes through `requireMember(user, kitchen)`. Data functions only accept the scope object it returns, so forgetting the check fails at compile time. Tests also try to reach another kitchen and must fail. Postgres row-level security (rules enforced inside the database) can be added later as a second lock.
- **Invite-only:** an email allowlist, `disableSignUp`, and a database cap of **4 accounts** (0006, 0021). Login links and codes expire after 5 minutes and work once.
- **Invite links and passphrases (SU1 Rec, built 2026-10-14; not live until Vero says go, 0028).** Levi joins with a link and picks his own passphrase; no environment change per person.
  - **Links** (`invites` table, migration `0009_invites_passphrases`, additive only): a member makes a **join** link (Settings → Kitchen → Invite someone) or a **reset** link for a member of the same kitchen (themselves included). The token is 32 random bytes in the link (`/join/<token>`, `/reset/<token>`) and **only its SHA-256 is stored**; it's shown once, to its maker. Single use (claimed under a row lock, then re-compared in constant time), valid **24 hours**, and only while its maker (and, for a reset, its target) is still a member. It goes when its kitchen, maker or target is deleted (FK cascade). Test kitchens can't make links (0021).
  - **Account cap (0006):** a join is refused once the app has **4 real accounts** (tester accounts, staging only, don't count). Checked when making a link and again, under an app-wide advisory lock, when it's used, so two links can't both take the last place.
  - **Passphrases:** `users.passphrase_hash` holds `scrypt$ln=17,r=8,p=1$<salt>$<hash>`: scrypt (OWASP's baseline, ~0.3 s and 128 MiB per check), a random 16-byte salt per person, and the parameters, so the cost can rise later and old hashes still check. 12–256 characters, Unicode-normalised (NFKC). Never logged, returned or exported.
  - **Sign-in** on `/unlock`: **name (case-insensitive) + passphrase**. Names are unique among real accounts (checked on join; a partial unique index on `lower(display_name)` for everyone with a passphrase). Every failure is the same `wrong`, and an unknown name runs a dummy scrypt check so timing doesn't tell either.
  - **Sessions:** the same cookie, marked `m: "p"` (not tied to an access code). A **reset bumps `session_epoch`**, so every older cookie stops working, then signs in this device. **Changing** a passphrase needs the current one (or, the first time, your access code); replacing one signs other devices out, setting your first doesn't.
  - **Rate limits** (`AUTH_LIMITS`, the same `rate_limits` counters, keys hashed): sign-in 10 per 15 minutes per IP and per name, 100 an hour overall; join and reset links 10 per 15 minutes per IP, 50 an hour overall; passphrase changes 5 per 15 minutes per person; making links 20 a day per person. Counted before any passphrase is checked.
  - **A dead link's page** (`getLinkInfo` → `{ok: false, invitedBy?}`): the maker's display name, and nothing else, is returned for a used, expired or no-longer-valid link, only when the token hashes to a real link of that purpose, so the page can say "Ask Levi for a new link". Unknown tokens get `{ok: false}`.
  - **The proxy** lets `/join/<token>` and `/reset/<token>` through without a session (one token-shaped segment, nothing deeper, never `/api`), with `Referrer-Policy: no-referrer`, `Cache-Control: no-store` and `noindex`. Their server actions check the link themselves, as every action checks its own session (Next.js runs an action by ID whatever page it's posted to).
  - **Deleted people (D2)** come back only through a new join link, as a new account with a new ID.
  - **Code:** `src/lib/auth/invites.ts` (commands), `passphrase.ts`; server actions in `src/app/join/actions.ts`, `src/app/reset/actions.ts`, `src/app/unlock/passphrase-actions.ts`, `src/app/settings/access-actions.ts`. Tests: `tests/integration/invites.test.ts`, `tests/unit/passphrase.test.ts`.
- **Interim access-code gate (2026-10-14; 0026's first real test).** Now a **backup** beside passphrases (SU1 Rec): unchanged, and it keeps working.
  - `ACCESS_CODES=vero=<code>,levi=<code>`: one personal code per real user (at least 12 characters). The name is the user ID created by `npm run db:bootstrap`. Codes are compared in constant time.
  - `src/proxy.ts` (Next.js 16's renamed Middleware) protects every page and API route except `/unlock` and static assets. Pages without a session go to `/unlock`; API routes get 401. It fails closed (500) if the environment is invalid.
  - Unlocking sets a **signed cookie** (HMAC with `SESSION_SECRET`; httpOnly, Secure, SameSite=Lax, `__Host-` in production). It's a **rolling 1-year session** (0017), re-issued at most once a day while in use. `getCurrentUser()` re-checks the cookie in every handler rather than trusting the proxy.
  - **Revoking:** **"Sign out everywhere"** in Settings (0017, built P2 b) bumps `users.session_epoch` (migration 0007). Every cookie carries the epoch it was issued under (`e`; cookies from before 0007 count as 0, so nobody was signed out by the deploy), and `getCurrentUser()` refuses any other epoch. The proxy has no database, so it only carries the epoch forward when it rolls a cookie; a signed-out cookie can't be rolled back to life. **"Sign out"** clears this device only. Changing one person's code still signs out only them; changing `SESSION_SECRET` signs everyone out.
  - **Rate limits** on attempts (Postgres counters): 5 per 15 minutes per IP (stored as a keyed hash, not the address), and 50 an hour overall. Every attempt counts, right or wrong. The overall cap means a flood could stop *new* unlocks for up to an hour; existing sessions are unaffected.
  - **Dev-only "acting as":** `DEV_ACTING_AS=<userId>` skips the gate locally (a `dev_acting_as` cookie can pick another user). The server refuses to start in production if it's set.
- **Chat rate limit (built):** `checkChatRateLimit(db, userId)` in `src/lib/rate-limit.ts`, 60 an hour and 100 a day per user (C12), all or nothing (a refused message counts against neither window). The chat route calls it before interpreting and, when refused, sends `error {reason: RATE_LIMITED, changed: false, retryable: true}`.
- **Tester agents (0021):** two `isTest` accounts (`tester-1`, `tester-2`) that the database restricts to `isTest` kitchens, usable on **staging** only. One rule, `testersAllowed` in `src/lib/deployment.ts`: yes on a Vercel preview (`VERCEL_ENV=preview`), never on `VERCEL_ENV=production` or any `NODE_ENV=production` build that isn't a preview, and locally only with the dev switch. Testers sign in with their access codes on `/unlock` like anyone else; in production `/unlock` refuses a tester's code and `getCurrentUser` refuses a tester's cookie. Details in §10 "Staging".
- **AI spend:**
  - an Anthropic spend limit per workspace: $30 for production and $10 for staging, the $40 cap (0020); target about $20
  - per-user rate limits (about 60 messages an hour, 100 a day (C12)) and a per-kitchen daily AI budget (about $2, ai.md §7), kept as counters in Postgres
  - a cap on reply length
  - tokens and cost logged for every call
- **Pasted content (for the AI specialist):** pasted recipes are **data, not instructions**.
  - Wrap them in delimiters in the prompt.
  - Pasted text can only produce `recipe.save` or `shopping.add` (a pasted shopping list, 0027; adding to the list is harmless and undoable). The backend uses `pastedRanges` and `evidence` to enforce this (§6).
  - The server never fetches links the user pastes.
  - Recipes are shown as plain text, never HTML.
  - Pastes are capped at about 20,000 characters.
- **Export** (built, P2 b) is one JSON file: your profile with provenance, your own chats, the idea cards you were shown, and your kitchens' members, events and state (§6). Never another member's chats (H2).
- **Delete** (built, P2 b; D1, 0015) removes, in one transaction (`src/server/account/delete.ts`): your account, your chats in every kitchen, your profile (restriction and preference rows **and** the `user:<id>` event stream), your meal-idea cards and your chat rate-limit counters.
  - **The kitchen events and change sets you made stay**, and they and the current-state rows you created or changed read back as **"a former member"** (`ActorRef.former`). Events can't be updated, so this comes from a small `deleted_users` table (ID + time only), not from rewriting them.
  - Another member's change set that saved one of *your* profile facts (Vero adding your allergy) keeps its place, but its summary becomes `FORMER_MEMBER_PROFILE` ("Changed a former member's profile"). Their own chats are theirs and aren't touched, even if they mention you.
  - **A kitchen is deleted** (rows cascade, its events go too) only when you're its last member.
  - Only kitchens you're a member of are touched, so a real person's delete never reaches a test kitchen or the other way round; a tester account (0021) in a real kitchen is refused outright.
  - **Interim access codes:** a trigger stops a deleted ID from being created again (by `db:bootstrap`, which now skips it, or a seed). If their code is still in `ACCESS_CODES`, `/unlock` refuses it with a clear message (`unlock.errors.deleted`) and logs that the code should go. **Vero must then remove that code from `ACCESS_CODES`.** Coming back needs a new ID (OPEN-QUESTIONS, reported to the orchestrator).
  - This is the one deliberate exception to "never delete." Neon's free backups keep only 6 hours, so deleted data is fully gone after that.

## 8. Testing
- **Unit tests (Vitest)** cover `apply` and the validator, using the primary journey (0005) as fixtures. The key check: **replaying all events gives the same state as the step-by-step updates.**
- **Integration tests** run on real Postgres: **PGlite** locally (an embedded Postgres compiled to WebAssembly, running inside the test process, so there's no Docker and no account), and a Neon branch in CI later. They use the same migrations. They cover cross-kitchen denial, retries, two people writing at once, and Undo conflicts. *PGlite runs one transaction at a time, so the kitchen row lock (`SELECT … FOR UPDATE`) is exercised for correctness but not under true concurrency. Re-run the two-writer test on a Neon branch.*
- **Contract tests:** every example in the AI specialist's test set must produce a ProposedChange that passes the shared Zod schema.
- **End-to-end tests (Frontend, with Playwright)** use a fake interpreter with fixed answers, so runs are repeatable. The tester agents use the real model.
- **Regressions:** every bug gets a test that fails without the fix.
- **Test kitchens (0021):** `POST /api/test/reset` (staging and tester accounts only; §10 "Staging") wipes a test kitchen and loads a named scenario: **`single`** (`tester-1`; empty or "after shopping"; the full journey) or **`household`** (`tester-1` + `tester-2`, `tester-2` with a seafood allergy and note; the shared smoke test in ux.md §8).
- **Staging tests:** `tests/unit/deployment.test.ts` (the guard matrix: production / preview / development, and when a build may bootstrap), `tests/integration/staging.test.ts` (bootstrap idempotency, reset restores the seed and leaves real kitchens and people untouched, tester sign-in on preview only), `tests/integration/test-reset-route.test.ts` (the route: environment × tester / real person / signed out; 404 in production even if the environment changes after load).
- **Hand-off gate:** both test kitchens must pass on staging before a build goes to Vero and Levi.
- **Defensive reads:** tests delete a referenced row and check the read returns a fallback, not an error.

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
src/server/           request helpers (session, http); account/: Settings, export, delete, sign-out
tests/  scripts/      unit + integration tests; migrate, seed/reset (scripts/scenarios.ts)
```
The UI and AI code reach the domains only through `commands` and `queries`. Domains reach each other only through `public.ts`.

## 10. Local development
No accounts or Docker needed: the database is **PGlite**, an embedded Postgres that runs inside Node and stores its files in `.data/pglite` (git-ignored). The same migrations will run on Neon.

| Step | Command |
|---|---|
| Install (Node 24+; npm) | `npm install` |
| Optional settings | `cp .env.example .env.local`. Leave `DATABASE_URL` empty. Set `DEV_ACTING_AS=vero` (or `tester-1`) to skip the access-code gate, or set `SESSION_SECRET` + `ACCESS_CODES` to try it. With neither, every page goes to `/unlock`, which says codes aren't set up. |
| Create or update the local database | `npm run db:migrate` |
| Create the real users and the Home kitchen | `npm run db:bootstrap` (safe to run again) |
| Load a test kitchen (resets it first) | `npm run db:seed -- single` (add `--after-shopping` for journey step 1 done) or `npm run db:seed -- household` |
| Checks | `npm run typecheck` · `npm run lint` · `npm test` |
| After changing `src/db/schema.ts` | `npm run db:generate` (writes SQL to `src/db/migrations`; commit it) |
| Start the app | `npm run dev` (the app with the fake AI and a dev "acting as" switch; see frontend.md "Run it locally") |

- Tests open their own in-memory PGlite per test file, so they never touch `.data/`.
- To start over locally, delete `.data/pglite`.
- `db:migrate` and `db:bootstrap` target Neon when `DATABASE_URL` is set (in the shell or `.env.local`), otherwise PGlite. `db:seed` is local only: it refuses to run when `DATABASE_URL` is set or `NODE_ENV=production`.
- Seeding resets only `isTest` kitchens and `isTest` users (`tester-1`, `tester-2`). Resetting a scenario also clears its testers' profiles.
- PGlite allows one process per folder: stop `npm run dev` before running a script against the same `.data/pglite`.

### Deploying to Vercel (production, Vero and Levi)
**Environment variables** (Vercel → Project → Settings → Environment Variables, scope *Production*). Names and comments are in `.env.example`; never commit values.

| Name | Value |
|---|---|
| `DATABASE_URL` | The Neon connection string (Neon → Connect; the pooled one is fine), with `sslmode=require` |
| `SESSION_SECRET` | At least 32 random characters: `openssl rand -base64 48` |
| `ACCESS_CODES` | `vero=<code>` today; `vero=<code>,levi=<code>` once Levi joins. Codes from `openssl rand -hex 8` (at least 12 characters, no commas) |
| `AI_MODE` | `fake` until the real interpreter is merged, then `real` |
| `ANTHROPIC_API_KEY` | Required only when `AI_MODE=real` |

Don't set `DEV_ACTING_AS` or `PGLITE_DIR`. The server refuses to start if a required variable is missing or the dev switch is set, and the log names the variable (never its value).

**Steps, in order:**
1. **Migrate and bootstrap from your laptop**, pointing at Neon for one command each (the value stays in your shell, not in a file):
   `DATABASE_URL='<neon url>' npm run db:migrate`, then `DATABASE_URL='<neon url>' npm run db:bootstrap`. Both are safe to re-run. Re-run `db:migrate` after any deploy that adds a migration, **before** that deploy goes live.
2. **Deploy** (import the repo in Vercel; framework Next.js; Node 24).
3. **Check after deploying:**
   - Opening the site redirects to `/unlock`, and `/api/anything` returns 401 without a cookie.
   - A wrong code says "didn't work"; your code lands on the home page and stays signed in after closing the browser.
   - Vercel → Logs show no "Invalid environment variables" or `[unlock]` errors.
   - After 6 wrong tries from one phone, it says "Too many tries" (optional; it clears in 15 minutes).

**Automatic migrations (0028, 2026-10-14):** Vercel runs `npm run vercel-build`, which is `db-migrate --neon-only` and then `next build`. Every production deploy therefore applies pending migrations to Neon before the new code goes live, with no manual step and no secrets in anyone's Terminal. Builds without `DATABASE_URL` skip it. **Only additive migrations may ship this way**; anything that changes or drops existing data needs Vero's go-ahead first (0028).

### Staging (preview deployments, tester agents; 0021)
Staging is Vercel's **Preview** environment: every non-production deployment, with its own Neon project and Anthropic key (§2), so tester runs never touch Vero's data or budget.

**Environment variables by scope** (Vercel → Project → Settings → Environment Variables):

| Name | Production | Preview (staging) |
|---|---|---|
| `DATABASE_URL` | Vero's Neon project | **The staging Neon project** (never production's) |
| `SESSION_SECRET` | Its own value | **A different value** (a cookie from one never works on the other) |
| `ACCESS_CODES` | `vero=<code>,levi=<code>` | `tester-1=<code>,tester-2=<code>` (at least 12 characters each; never a real person's code) |
| `AI_MODE` / `ANTHROPIC_API_KEY` | `real` + the production workspace key ($30 limit) | `real` + **the staging workspace key** ($10 limit, 0020) |
| `VERCEL_ENV` | Set by Vercel to `production`. **Never set it yourself.** | Set by Vercel to `preview` |

**How a preview build migrates and bootstraps:** `npm run vercel-build` runs `db-migrate --neon-only` (staging's own database), then `scripts/staging-bootstrap.ts`, then `next build`. The bootstrap acts **only when `VERCEL_ENV=preview` and `DATABASE_URL` is set** (`stagingBootstrapAllowed`); anywhere else it prints "Skipping the staging bootstrap" and opens no database. It reads only the real process environment (never `.env.local`) and refuses a non-Neon database. It **ensures** (`ensureStagingKitchens` in `scripts/scenarios.ts`) the users `tester-1` and `tester-2` (`isTest`) and the kitchens `test-kitchen-single` (tester-1) and `test-kitchen-household` (both), seeding a kitchen only when it doesn't exist yet. It never wipes, and it refuses if a tester ID belongs to a real account. Real users aren't bootstrapped on staging.

**How testers sign in:** open the preview URL, enter the tester's code on `/unlock`. Same gate, same 1-year cookie, same rate limits as production. A tester who's in both kitchens (`tester-1`) lands in **the one most recently reset** (`firstKitchenId`; real people still get their first kitchen), so reset the scenario you're about to run. The C12 chat limits (60 an hour, 100 a day per person) apply to testers too, and a reset doesn't clear them.

**`POST /api/test/reset`** with `{"scenario": "single" | "household", "afterShopping"?: true}` (same origin, with the tester's cookie): resets that test kitchen to its seed (`seedScenario`) and answers `{ok: true, scenario, kitchenId}`.
- **404, doing nothing,** unless `testersAllowed` (preview, or local dev with the dev switch). Checked when the module loads **and** on every request, so a production instance can't be switched on later.
- **401** without a session (the proxy answers first: it isn't a public path). **403** for a real person, or a tester who isn't a member of that test kitchen (read from the database, never the cookie). **400** for anything but those two scenarios (`demo` included). **429** after 20 resets an hour per tester.
- It can only delete `isTest` kitchens and the scenario's `isTest` testers' profiles: `resetScenario` refuses anything else, and the database stops a tester from joining a real kitchen.
- If a tester ever uses "Delete my data" on staging, its ID is blocked from being recreated (D1 trigger), and reset then fails; remove its row from staging's `deleted_users` to recover.
- Code: `src/app/api/test/reset/route.ts`, `src/server/test-reset.ts`, `src/lib/deployment.ts`, `scripts/staging-bootstrap.ts`.

**Adding Levi (SU1 Rec, once live):** the bootstrap already created his account (`levi`, in Home), so Vero sends him a **reset link** for Levi from Settings: he sets his passphrase and keeps that account (and anything saved to his profile). A join link would make a *second* account, and "Levi" is taken. **Backup:** add `levi=<code>` to `ACCESS_CODES` and redeploy.
**Signing someone out:** change their code (just them) or `SESSION_SECRET` (everyone), then redeploy.

## Questions for Vero
Tracked in `OPEN-QUESTIONS.md`. H2 and H3: answered → 0017. B14: answered → 0021. Still open: **D1** (Rec: a deleted member's items stay, credited to "a former member").

## Risks and how we'd reverse
| Risk | Reversal |
|---|---|
| Vercel Hobby is non-commercial only | Move to Pro (about $20/month) or any Node host. The app is standard Next.js. |
| Neon's free compute runs out | Tighten the polling slowdown, or upgrade (about $5–19/month). The tester agents already use a separate project. |
| Backups cover only 6 hours | The event log makes mistakes recoverable. Add a nightly export if the data becomes precious. |
| Drizzle 1.0 breaks its API | Stay pinned and upgrade on purpose. The queries are near plain SQL. |
| Polling feels slow | Swap `useKitchenSync` to live updates. |
| Replaying events gets slow | Add snapshots. The event log doesn't change. |
| The meal lifecycle changes | Edit the transitions table. Old events stay valid. |
| Batches confuse more than they help (0025) | Set `MAX_OPEN_BATCHES` to 1: every purchase then closes the old batch and the row behaves as before. The events and `item_batches` table stay. |
| Better Auth disappoints | Users live in our own tables, so switch libraries and keep the data. |

## Contract changelog (integration passes)
| Request | Outcome |
|---|---|
| FE: `applied[].refs` | **Accepted.** `{kind, id, change}` drives focus and highlights. |
| FE: `{code, params}` on summaries and rejections | **Accepted** as `Msg {code, params, text}`. System text is translatable. AI-written replies are already in the user's language. |
| FE: `updatedAt/By` on rows; state with ApplyResult | **Accepted.** `state` is always included, since it's small at MVP size. Dropping it later would cost one refetch. |
| FE: session length; link + code email | **Accepted as settings:** rolling session per FE1, and one email carrying both (§2) |
| FE: stream events; how Choose streams | **Accepted and merged** into the turn stream table. Choose uses `POST /api/meals/choose`, a turn stream like chat, because server actions don't stream well. |
| AI 1: typed fields per operation | **Accepted.** `Operation` is a union keyed by `type`. |
| AI 2: `evidence` | **Accepted.** Required for chat; the backend checks it for profile operations. |
| AI 3: `clarification.options` | **Accepted** as `{label, reply}`, max 4 |
| AI 4: name-only targets | **Accepted.** No match records the item; two matches give `AMBIGUOUS_ITEM`. `UNKNOWN_ITEM` now means only a bad ID. |
| AI 5: `clear: [field]` | **Accepted,** except `name` |
| AI 6: `usedUp`, `amountUsed` | **Accepted.** The remainder is computed for the same unit only, and is unknown otherwise. |
| AI 7: `profile.restriction.add/.remove` | **Accepted.** Only the owner can remove a restriction. |
| AI 8: `pastedRanges` | **Accepted,** with a 1,500-character fallback |
| AI pipeline: draft, re-word, generate after save | **Accepted.** The draft is only sent after apply, so interpret → apply → reply holds. |
| Added by Backend | `src/contracts/`; `meal.choose` creates a `chosen` meal; `/changes?since=` for "Since your last visit"; `offer` and `recipe.saved` stream events |
| **2026-10-14 pass** | `item.use.usedUp` → `stock: low\|out` (0013); `meal.transition.note` for after-cooking; review kind `used-up` → `after-cooking`; `ALREADY_USED_UP` → `ALREADY_OUT`; restriction `note` + `.update` (0019); code-computed `AllergenFlag` on ideas, recipes and meals; 1-year rolling session + Sign out everywhere (FE1 Rec); 4 accounts; `single` / `household` test scenarios (0021); defensive reads (0018) |
| **Milestone 1 build (2026-10-14)** | What changed while building, so this doc stays true: |
| Local database | **PGlite** replaces Docker for local dev and integration tests (Docker isn't available; no accounts yet). Same schema and migrations. Two DB triggers: events can't be updated; tester accounts can only join `isTest` kitchens. |
| Change-set ledger | New `change_sets` table: the `proposalId` idempotency record (unique per kitchen), the "Since your last visit" feed, and the list of entities each change set touched (for Undo conflicts and STALE_TARGET). |
| Version | `kitchens.version` goes up by one per change set that saved anything. A profile change made through a kitchen (an allergy) bumps that kitchen too, so the other member's poll sees the new allergen flags. `seq` stays per stream. |
| Undo mechanics | `changeset.reverted` carries `restore`: each touched entity's value just before the change set (or null). Restored rows read "updated by whoever undid it". An Undo can't itself be undone (`UNDO_OF_UNDO`; its result has `undoable: false`). A later change that was itself undone no longer blocks an Undo. |
| STALE_TARGET | Only for operations that name an **ID** changed after `basedOnVersion`. Name targets are simply re-matched against the latest state. |
| Rejection codes | Added `UNKNOWN_TARGET` (bad meal, idea, review, change-set or event ID), `UNDO_CONFLICT`, `ALREADY_UNDONE`, `UNDO_OF_UNDO`, `INVALID_OPERATION` (e.g. setting and clearing one field, a note without `to: done`). `UNKNOWN_ITEM` stays item IDs only. |
| Name matching | Exact standard name first, then "all the words you said" ("the chicken" → chicken thighs). Items still on the list beat `out` ones. |
| `item.add` again | If exactly one item with that name is low or out, it's restocked (stock cleared) instead of duplicated. |
| `item.use` | A same-unit remainder of 0 also sets `stock: out` (basis `inferred`). Using an `out` item → `ALREADY_OUT`. |
| After cooking, "Do later" | `meal.transition {to: done, note}` on a meal that's already done only saves the note (event `meal.noted`). Otherwise the note couldn't be added from To review. |
| Evidence | Chat operations without `evidence` → `EVIDENCE_NOT_FOUND`. If the message has pasted parts and a non-recipe operation's evidence isn't found in the typed part → `NOT_ALLOWED`. The command takes the message text as `messageText`; without it, profile changes via chat are refused. |
| Restrictions | `.update` / `.remove` find the restriction by person + kind + subject (no ID in the contract). Adding one that already exists only updates the note (owner) or does nothing. The "Save this to Levi's profile?" confirmation is the AI's step (AI7 Rec); the backend checks membership and ownership. |
| `review.queue.items` | Typed as `[{name, itemId?}]`. |
| Meal ideas | Stored in a `meal_ideas` table (chat messages don't exist yet), with `recordMealIdeas`. "Choose" on the same idea twice returns the same meal. |
| KitchenState shape | Adds `kitchenId`. Actor fields are `{id, name}` or `{id, missing: true}`. `meals` = chosen/planned/cooking; `plan` = meal IDs, cooking first; `ticks` = ticked only, each with a `meal` ref; `toReview` = pending only. Recipes come from `getRecipe(mealId)` (`RecipeView`); meals carry a `recipe` summary. |
| Stream | `applied` nests the ApplyResult under `result`. |
| Allergen words | A small starter list in `src/shared/profile/allergens.ts`; the AI specialist owns the full list and should replace it there (one list, not two). |
| Not built yet | `getEvents(userId, …)` from §5; the 4-account cap and Better Auth tables (sign-in milestone); route handlers. |
| **Deployable for Vero (2026-10-14, 0026)** | Neon via the WebSocket Pool driver when `DATABASE_URL` is set, PGlite otherwise (§2); `db:migrate` works on both. **Interim access-code gate** in place of email sign-in for now (§7): `src/proxy.ts`, `/unlock`, signed 1-year rolling cookie, `getCurrentUser()` / `requireCurrentUser()` in `src/lib/auth/current-user.ts`. New `rate_limits` table (migration 0002) for unlock attempts and `checkChatRateLimit` (new message code `RATE_LIMITED`). `npm run db:bootstrap` creates users `vero`, `levi` and the shared kitchen `home` ("Home"). Production env validation at start (`src/instrumentation.ts`); new env vars `SESSION_SECRET`, `ACCESS_CODES`, `AI_MODE`, `ANTHROPIC_API_KEY`, `DEV_ACTING_AS`. Deploy steps in §10. |
| **Shopping list (2026-10-14, 0027, SL1–SL3 Recs, SL5 Rec)** | New operations `shopping.add / .update / .tick / .remove / .done` (§6); events `shopping.added / .updated / .ticked / .removed / .moved`; projection table `shopping_items` (**migration 0003_shopping_list**, additive only: one new table, run `db:migrate` before the deploy that ships it). `KitchenState.shoppingList` (defaults to `[]`, so older cached states still parse). `RefKind` adds `shopping`; rejection codes add `NOT_ON_LIST`, `NOT_TICKED`. `shopping.done` reuses `item.add`'s rules through one shared function. Pasted text may produce `shopping.add`. SL5 Rec: buying in chat moves the matching open list item, behind one switch. Commands `addShoppingItems`, `tickShoppingItem`, `removeShoppingItem`, `doneShopping`; query `getShoppingList`; server actions in §6. |
| **Shopping "Do later" → To review (2026-10-14, 0027, ux.md §5 and §10)** | `review.queue` without `mealId` queues shopping-list items (`ReviewEntry.shoppingItemId`); `review.resolve.items` runs `shopping.done`'s path for that card (one shared function in `validate.ts`). New event `review.updated` (a card's entries, when Do later adds to the pending card). `ReviewRow` adds `origin` (defaults to `meal`, so older cached states parse) and `meal` becomes optional. **Migration `0004_shopping_review`, additive only (0028):** one new column `reviews.origin text NOT NULL DEFAULT 'meal'`. `meal_id` stays NOT NULL, and a shopping-list card stores `''` there; the store maps `''` to "no meal". New message code `SHOPPING_REVIEW_QUEUED`. Commands `queueShoppingReview`, `resolveReview`; server actions in §6. |
| **Chat history survives a reload (2026-10-14, P2 a)** | New table `chat_messages` (**migration `0005_chat_messages`, additive only, 0028**): one row per role per turn (unique on kitchen + user + `clientMessageId` + role, so retries save nothing twice), ordered by an identity column `seq` that is also the history cursor. `handleChatTurn` saves the message and the reply + receipt and builds the interpreter's `history` from the database (last 10 messages, this user and kitchen, the current turn left out); the client's `history` is ignored. New `GET /api/chat/history` (§6), contract `ChatHistoryPage`. Kitchen `public.ts` adds `getStillUndoable` so a reloaded receipt only offers Undo when it would still be allowed. Export and delete of chats are TODO with Settings (P2 b, §7). |
| **Meals: ideas → recipe → plan → cooking → Update your kitchen (2026-10-14, P2 d; 0005, 0009, 0013, 0019, 0025)** | `handleChatTurn` runs the interpreter's `followUps` after apply (§6 "Meal follow-ups"); new `handleChooseMeal` behind `POST /api/meals/choose` and the `chooseMeal` action. `InterpretRequest.ideas` = this user's latest idea set in card order. **Migration `0006_meal_idea_position`, additive only (0028):** `meal_ideas.position integer NOT NULL DEFAULT 0` and an index on (kitchen, created_by, created_at). Contract: `meal.plan` / `meal.transition` also take `{ideaId}`; `RecipeIngredient.amount?` (and on `RecipeView`; recipes are JSON, no migration); stream events `ideas.dropped` and `update-kitchen` (`UpdateKitchenPrompt`). `recordMealIdeas` stores `position`, drops `uses` IDs not in the kitchen, and flags the used items' names too. Queries `getIdeaSet`, `getLatestIdeaSet`, `getIdea`, `getMealProfileContext`, `wasApplied`; commands `dropIdeaSet`, `chooseMealTap`, `planMeal`, `moveMeal`, `tickIngredient`, `updateKitchenAfterCooking`, `queueAfterCooking`, `addRecipeNeedsToShoppingList`, `updateKitchenPrompt`; server actions in §6. Message code `BASICS_ASSUMED` (plus the meal codes in `en.json`). |
| **Settings, backend half (2026-10-14, P2 b; 0015, 0017, 0019, D1)** | **Migration `0007_settings`, additive only (0028):** `users.session_epoch integer NOT NULL DEFAULT 0`, `profile_restrictions.verified_at` (nullable; backfilled for restrictions the owner added), new table `deleted_users (id, deleted_at)`, and a trigger refusing to insert a user whose ID is in it. Session cookie payload adds `e` (epoch; absent = 0). New operation `profile.restriction.verify` + event `profile.restriction.verified`; `Restriction.verifiedAt`. `ActorRef` adds `{id, missing, former: true}`. New contract file `src/contracts/settings.ts` (`SettingsView`, `DELETE_CONFIRMATION_PHRASE`, export format). New routes `GET /api/me/export`, `POST /api/me/delete`; Settings actions in `src/app/settings/actions.ts`; `UnlockResult.reason` adds `deleted`. Message codes `RESTRICTION_VERIFIED`, `FORMER_MEMBER_PROFILE` (en.json `msg.*` + `unlock.errors.deleted` are the Frontend's to add). `db:bootstrap` reports `skippedDeleted`. |
| **Older and newer batches, backend half (2026-10-14, P2 c; 0025, 0011, 0028)** | **Migration `0008_item_batches`, additive only (0028):** new table `item_batches` (one row per batch, open or closed), backfilled with **one batch per existing item, using the item's own ID** (closed `used-up` when the item was Out); the `items` columns are untouched and still written (derived from the batches), so older code keeps reading them. An `items` row with no batch rows reads as that one legacy batch. Events: `item.added` / `.updated` / `.used` gain an optional `batchId` (absent = the old meaning, so old events replay unchanged); new `item.batch.added`, `.closed`, `.kept`, `.defrosted`. Contract: `ItemBatchTarget` / `BatchTarget` (`BatchWhich`, `MAX_OPEN_BATCHES` in `common.ts`); operations `item.batch.close`, `item.batch.keep`, `item.defrost`; `item.update` / `item.use` take a batch target; `ChangeRef.batchId?`; `AppliedOp.batchOffers?` + `BatchOffer` + `isBatchOfferOpen`; `ItemRow.batches?` / `.defrostedOn?` + `BatchRow`. **Behaviour change:** buying something you already have now adds a batch instead of a second item (it used to restock only a Low/Out item); `ITEM_ADDED_FROM_LIST` for an item you had becomes `ITEM_BATCH_ADDED {fromList: true}`. Message codes `ITEM_BATCH_ADDED`, `ITEM_BATCH_USED_UP`, `ITEM_BATCH_GONE`, `ITEM_BATCH_KEPT`, `ITEM_DEFROSTED` (en.json is the Frontend's to add; the English `text` is the fallback). Commands `closeBatches`, `keepBatches`; queries `getItemBatches`, `getUseItUpSignals`; `public.ts` `getUnansweredBatchIds`; server actions in `src/app/batches/actions.ts`. Known limit: an old build writing an `items` row during the deploy's switch-over leaves that item's batch rows behind; `rebuild-projections` fixes it. |
| **A dish named in chat (2026-10-14, MI1 Rec, 0013 M1; AI specialist, Backend inactive)** | `meal.choose` also takes `target {title, notes?}` (`NamedDish` in `operations.ts`): a new `chosen` meal with that title and no `ideaId`. `notes` (the user's own words about the dish) go in the `meal.chosen` event payload (`MealChosenPayload.notes?`) and are not projected, so **no migration**. Same summary `MEAL_CHOSEN`, no new message code. `targetKeys` gives none (no ID). A `meal-step` follow-up isn't folded onto a `{title}` choose (no idea to point at). The turn passes the notes to the recipe follow-up (`TurnFollowUp.recipe.notes`), which runs after apply, so its In your kitchen / Need see this turn's adds. |
| **Invite links + passphrases (2026-10-14, SU1 Rec; sign-in change, so not deployed until Vero says go, 0028)** | **Migration `0009_invites_passphrases`, additive only:** new table `invites` (token SHA-256, purpose `join\|reset`, target, 24 h expiry, `used_at`), new nullable column `users.passphrase_hash`, partial unique index on `lower(display_name)` where a passphrase is set. Session cookie gains `m: "p"` for passphrase sessions (older cookies unchanged); the gate and `getCurrentUser` need only `SESSION_SECRET` for those. New rate limits `AUTH_LIMITS`. Server actions: `checkJoinLink`, `acceptJoin`, `checkResetLink`, `acceptReset`, `signInWithPassphrase`, `createInvite`, `createResetLink`, `changePassphrase` (§7). Delete also clears the person's passphrase-change and link-making counters. `ACCESS_CODES` sign-in unchanged. If SU1 is approved, Better Auth, Resend and S4 are no longer needed (§2). |
| **Staging + tester agents (2026-10-14, P2 e; 0021)** | New `src/lib/deployment.ts` (`testersAllowed`, `stagingBootstrapAllowed`) and env var `VERCEL_ENV` (set by Vercel). Tester accounts now sign in with access codes **on preview deployments only** (this replaces the earlier "staging-only sign-in route" idea, §7). `vercel-build` runs `scripts/staging-bootstrap.ts` after migrating (preview + `DATABASE_URL` only; ensures, never wipes). New route `POST /api/test/reset` (§10 "Staging"; 404 outside staging) and `resetTestKitchen` in `src/server/test-reset.ts`; rate-limit key `test-reset:user:<id>`. `firstKitchenId` (used by `getSession` and Settings): a tester gets their most recently (re)created kitchen; real people unchanged. No migration. |
