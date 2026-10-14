# Frontend and accessibility architecture

**Status:** Approved (0023); milestone 2 built 2026-10-14 (see "Build changelog" at the end) · Frontend + Accessibility specialist
**Builds on:** [ux.md](ux.md), [backend-data.md](backend-data.md) (§6, §9); decisions 0001, 0002, 0004, 0005, 0007, 0011, 0013, 0015–0021. `ai.md` didn't exist yet, so the chat stream format in §3 is a proposal for AI and Backend to confirm. Where an outstanding question matters, the design works either way and cites its ID.

---

## 1. App structure

Next.js 16 "App Router": each folder is a URL. A **layout** wraps pages and stays mounted while you navigate, so the chat dock lives in one and never reloads.
- **Server components** run on the server and send finished HTML: fast, and no secrets reach the phone. Used for sign-in checks, the first load of kitchen and chat history, Settings and policies.
- **Client components** run in the browser and handle anything interactive: chat, widgets, sheets.

| URL | UX screen |
|---|---|
| `/sign-in` | Sign-in: email, check email, 6-digit code (UX2, 0017), expired link |
| `/` | Main: workspace + dock (phone) or split (desktop) |
| `/recipe/[mealId]` | Recipe: full page on phone, workspace column on desktop; dock stays |
| `/kitchen` | Kitchen "See all": view-only except To review (K1, 0017) |
| `/settings` | Settings (inside the main layout, so the dock stays); Sign out everywhere and Delete my data are confirm sheets, not routes |
| `/privacy`, `/terms`, `/offline` | Policies (0015); offline fallback page |

Real URLs make the phone's Back button just work. Next 16's `proxy.ts` (formerly "middleware") only redirects signed-out visitors; the real permission check runs on the server for every read and action (backend §7).

## 2. Widget system (0004)

**The seam is one list: the widget registry.** Each widget describes itself:

| Field | Purpose |
|---|---|
| `id`, `domain` | `"kitchen.items"`, `"kitchen"` |
| `Component` | Renders the widget and fetches its own domain's data |
| `isPresent(state, session)` | Has content? `session` = per-session data a widget owns that isn't saved (Meal ideas, 0013), keyed by widget ID; the workspace passes it through without looking inside |
| `wantsFocus(turn)` | Does this turn concern me? (item change → Kitchen) |
| `barSummary(state)` | Collapsed bar text ("Meal plan · 2 · 1 cooking") |
| `lifetime` | `lasting` (Kitchen, Meal plan) or `session` (Meal ideas, 0013) |

`widgets/kitchen/index.ts` exports the Kitchen widgets, and `workspace/registry.ts` lists them, one line per widget folder or widget (`...kitchenWidgets, ...shoppingWidgets, mealIdeasWidget, mealPlanWidget`). A Fitness widget later is a new folder plus one line; no Kitchen file changes, and the workspace knows nothing about food. No plugin loading.

**Showing, ordering and focusing** is one pure function (a **reducer**: old state + event → new state) handling `turnApplied`, `remoteChange`, `userToggled` and `userClosed`. It implements UX §2: the focused widget moves to the top only after your message; phone expands only that one; desktop expands all; remote changes never reorder or move focus. Pure means easy to unit-test.

## 3. State and data flow

| Kind | Lives in | Examples |
|---|---|---|
| **Server state** (database truth) | TanStack Query cache, behind `useKitchenSync` | Items, meals, plan, To review, version |
| **Conversation** | `useChat` reducer, seeded from saved chat (P2 a) | Messages, streaming reply, receipts, history paging |
| **UI state** | Workspace reducer, components | Order, focus, highlights, sheet choices, dock Peek/Full/Minimized |

**Your own change:** the `ApplyResult` arrives → the client stores the embedded new `state` (backend §6) → notes `newVersion` so polling doesn't refetch it → the reducer focuses the right widget and marks rows "New"/"Updated" until your next message.

**The other person's change:** `useKitchenSync` polls `/version` per backend §6 (15 s visible, 60 s after 5 idle minutes, immediately on return, paused when hidden). A higher version reloads state; rows with `updatedBy` ≠ you get the soft "Levi · just now" highlight.

**Shared-kitchen cues (ux.md §6), built in `src/ui/sync/shared-cues.ts`, `useSharedCues` and `src/ui/widgets/kitchen/SharedCues.tsx`:**
- **Since your last visit:** this device keeps the last kitchen version it showed each person (localStorage `kitchen.lastSeen.<kitchenId>.<userId>`, best effort; with no storage there's just no line, 0018). On the first state it shows, the screen asks `GET /api/kitchens/:id/changes?since=` (newest 200) and lists the **other** members' change sets up to that state. Undone change sets, the Undo itself and quiet summaries (a kept batch, an unticked item, To review) are left out. The result is one line at the top of the Kitchen, for example "Levi added milk and used up the eggs.", with "and N more changes" past three plus **See all**, and a **Dismiss** button that puts focus on the Kitchen. The line stays, even across a reload, until it's dismissed. While it's showing, the stored version stays put; otherwise it follows the screen. Switching person (the dev bar) starts over for that person.
- **While you're looking:** an item that leaves the list in a sync (used up or removed) can't be attributed from the state, so the screen asks `/changes` and shows one quiet line, "Levi used up the eggs.", until your next message. It replaces that sync's one polite announcement and never moves focus. If `/changes` fails, the plain "Someone updated the kitchen." goes out instead.

**Optimistic updates** (showing a change before the server confirms): **no** for anything the AI interprets (UX notes). **Yes for checklist ticks only**: unambiguous, and lag would feel broken. A failed tick reverts with "Couldn't save · Retry". Ticks are shared (0013), so the other person's arrive through sync with "ticked by Levi".

**Chat streaming:** plain `fetch` reading one JSON event per line (NDJSON), each checked by the shared Zod schema in `src/contracts/`. The **canonical event list is the turn stream table in backend §6** (`ack`, `status`, `applied`, `clarification`, `offer`, `notes`, `text`, `idea`, `recipe`, `recipe.saved`, `done`, `error {reason, changed, retryable}`). The same stream serves `/api/chat` and **Choose** (`POST /api/meals/choose`).
Because the backend interprets, then applies, then replies, `applied` always arrives before any `text`, so widgets update *before* the reply streams. Each message has a client-made ID, so **Try again** can never apply twice.

**Errors:**
- Fails before `ack`: "Not sent · Try again".
- `error` with `changed: false`: "I couldn't save that, so nothing changed. [Try again]".
- Stream cut after `applied`: "Reply interrupted. Your changes were saved."
- **Partly rejected:** the receipt lists applied lines with Undo, plus a muted line per rejection; the reply already reflects it.
- Undo refused: "Can't undo this now. Tell me what to fix."

**Never crash (0018):**
- **Each widget has its own error boundary** inside `WidgetFrame`: a render or data failure shows "Couldn't load · Retry" in that widget only; chat and the other widgets keep working. A route-level `error.tsx` is the last resort, never the first.
- **Safe fallbacks** come from one small display helper: a missing item → "Unknown item", a missing person → "Someone" (a deleted member → "a former member", D1 Rec), no location → "Not sure where". References with `missing: true` (backend §6) use it too; nothing renders blank.
- A stream event or row that fails its Zod check is **dropped and logged**, not thrown.
- **Failed actions** (Undo, Choose, a tick) explain themselves in place, in plain words, and leave the screen as it was.
- Client errors are sent to the server log; every fixed bug gets a regression test.

## 4. Libraries

Versions checked on the npm registry, 2026-10-13. Pin exact versions at build start.

| Need | Choice | Why | Rejected |
|---|---|---|---|
| Framework | **Next.js 16.4, React 19.3** | Preference; matches backend | — |
| Accessible primitives | **Base UI 1.9** | Unstyled, accessible dialog, **drawer** (bottom sheet: swipe, focus trap, focus return), accordion, checkbox group, menu, OTP field; one maintained library | React Aria Components: heavier, more opinionated. Radix: no drawer. Vaul: **unmaintained** (its README) |
| Styling | **Tailwind CSS 4.3** + semantic CSS-variable tokens | No runtime; suits unstyled primitives; contrast checked in one token file | CSS Modules: slower to keep consistent |
| Sheets/dialogs | Base UI Drawer (phone) / Dialog (desktop) | One wrapper switches at ~900 px | — |
| Forms | **None**: native forms, server actions, Zod | A few tiny forms | React Hook Form: overkill |
| Server state | **TanStack Query 5.104** | Polling, refetch on return, retries, cache writes from ApplyResult | SWR: weaker mutations |
| Chat streaming | **Plain fetch + NDJSON** (~100 lines) | Our stream carries domain events, not just model text, and we own the format | Vercel AI SDK `useChat` (v7): four major versions in two years; shapes the route around its protocol |
| Icons | **lucide-react 1.56** | Large, tree-shaken, active | Heroicons: smaller |
| i18n + dates | **next-intl 4.14** + built-in `Intl` | Server and client components, plurals, "added 3 days ago" by locale | react-i18next; date-fns (unneeded) |
| PWA | `app/manifest.ts` + small hand-written service worker | Few moving parts (§5) | Serwist: a build plugin for caching we barely need |
| Tests | **Vitest 5**, Testing Library 16, **Playwright 1.64**, **@axe-core/playwright 4.13** | Same runner as backend; WebKit (iPhone engine); automated WCAG checks | Jest; Cypress (weaker WebKit) |
| Lint | eslint-plugin-jsx-a11y, eslint-plugin-i18next | Missing labels; hard-coded text (0015) | — |

**Unverified:** Base UI's docs don't label Drawer stable or preview; jsx-a11y last released October 2024, so confirm ESLint compatibility (axe covers most of it anyway).

**Theming (FE3, 0017): semantic design tokens are mandatory.** No dark mode in MVP 1, but every colour, spacing and type value is a **semantic** token named for its role (`color.surface`, `color.text-muted`, `color.accent`, `color.danger`, `space.*`, `font.*`), defined once as CSS variables and mapped into Tailwind's theme. Components use only these tokens: no hex values and no raw palette classes like `bg-white` or `text-gray-700` (a lint rule enforces this). A second theme is then just a second set of values under `[data-theme]`, with **no component changes**.

## 5. PWA specifics (0001)

- **Install:** manifest (standalone; 192/512 px and maskable icons) plus an Apple touch icon. iOS 26 opens home-screen sites as web apps by default. Android installs from the menu without a service worker; Chrome's automatic prompt still wants one (2023 source).
- **Offline is read-only** (FE2 Rec). The service worker caches built files and `/offline`, and **never caches `/api` or sign-in**. The client keeps the last kitchen snapshot on the device ("Offline · showing your kitchen as of 6:42 pm") and disables Send (FE2). The snapshot is wiped on sign-out.
- **iPhone sign-in (UX2, 0017):** a home-screen app keeps cookies separate from Safari, so an emailed link signs in *Safari*. Apple has said cookies are copied once when the app is added; unconfirmed for iOS 26. So the email carries a link **and** a 6-digit code, and the app has a code field (`autocomplete="one-time-code"`, paste allowed, which meets WCAG 3.3.8). One email with both is tested first; the fallback is code-only. A rolling 1-year session (FE1 Rec) makes signing in rare; **Sign out everywhere** in Settings ends every session and wipes the offline snapshot.
- **Dock states (UX3, 0017):** Peek, Full and **Minimized**. Minimized hides the dock and shows a fixed round chat button bottom-right, with a dot for a new reply since minimizing (UX4 Rec: not draggable).
- **Keyboard and viewport:** `viewport-fit=cover`, `env(safe-area-inset-*)` padding, `100dvh`. Android supports `interactive-widget=resizes-content`, so the dock rides above the keyboard. **iOS Safari doesn't** (caniuse, through 26.5), so a small `visualViewport` listener sets `--keyboard-inset`. Riskiest piece: test on a real iPhone early.

## 6. Accessibility plan (WCAG 2.2 AA, proportionate)

**Chat and announcements**
- [ ] "Chat" and "Workspace" landmarks with skip links; one `h1`, an `h2` per widget.
- [ ] The message list is `role="log"` with announcing **off**, so streamed chunks aren't read piecemeal.
- [ ] **One polite live region** (announces without moving focus) speaks once per turn on `done`: reply plus receipt summary ("Added eggs, spinach. Kitchen updated."). Levi's changes: at most one announcement per poll.
- [ ] Focus stays in the composer after Send; incoming changes **never** move it.
- [ ] Undo is named for what it undoes ("Undo: chicken thighs moved to freezer"); used quick replies stay readable but disabled.
- [ ] Desktop: Enter sends, Shift+Enter adds a line, Esc closes sheets.

**Dock, sheets, widgets**
- [ ] Show/Hide chat button with an expanded state, plus a Minimize button; dragging optional (2.5.7).
- [ ] **Floating chat button:** a real `button` named "Open chat" ("Open chat, new reply" when the dot shows; the dot isn't the only cue). Minimizing moves focus to it; opening returns focus to the composer. 44 px, inside `env(safe-area-inset-*)`, and the workspace gets bottom padding and `scroll-padding-bottom` so it never covers content or a focused control (2.4.11).
- [ ] `scroll-padding-bottom` equals the dock height, so focus is never hidden behind it (2.4.11).
- [ ] Sheets trap focus, Esc/swipe-down mean Do later, focus returns to the opener.
- [ ] Accordion bars are buttons with an expanded state; the "Updated" dot has text.
- [ ] **Allergy flags** are text (with an optional icon), part of the card's or ingredient's accessible description; the after-cooking choices are a radio group per ingredient.
- [ ] **Reordering:** DOM order matches visual order, only after your own message; stable keys keep focus; the announcement names the widget.

**Visual**
- [ ] Contrast 4.5:1 text, 3:1 controls and focus rings; 44 px tap targets where possible, never under 24 px (2.5.8).
- [ ] Reduced motion makes highlights and reordering instant.
- [ ] Works at 320 px, 200% text zoom, and phone landscape (dock starts collapsed on short screens).

**Testing:** jsx-a11y lint; axe at each journey checkpoint, failing on serious or critical issues; a 30-minute manual pass of the primary journey with VoiceOver on iPhone and one desktop screen reader before each tester milestone. No formal audit (0002).

## 7. Security in the frontend

- **No secrets in client code:** only `NEXT_PUBLIC_` variables reach the browser, none hold keys; `server-only` imports make leaks a build error.
- **Plain text only:** AI replies, recipes and pasted text render as text, never HTML. A lint rule bans `dangerouslySetInnerHTML`; no Markdown or auto-linking in MVP 1.
- **Server actions** are public endpoints in disguise, so each re-checks session and membership. Next.js accepts them only as same-origin POSTs, which blocks cross-site request forgery (CSRF).
- **`/api/chat`** requires a JSON body and checks `Origin`; cookies are `HttpOnly`, `Secure`, `SameSite=Lax`.
- Security headers plus a nonce-based Content Security Policy, report-only on staging first.

## 8. Testing and testability

| Layer | Covers |
|---|---|
| Unit (Vitest) | Workspace reducer, stream parser, sync timing, fallback helper |
| Component | Composer focus, sheet focus return, chat-button focus, Undo names, error states, a widget's error boundary not taking down the others |
| End-to-end (Playwright) | UX §8 single-person journey on iPhone-sized WebKit, Android-sized Chromium and desktop, with backend's **fake interpreter** and `/api/test/reset` (`single`); the household smoke test with two browser contexts (`household`) |
| Regression | Every bug gets a test that fails without the fix |
| Sign-in (SU1) | A second Playwright dev server on port 3211 with the real sign-in gate and a fresh bootstrap database (`tests/support/auth-server.ts`), because the main e2e server's `DEV_ACTING_AS` skips sign-in |

**Hand-off gate (0021):** both test kitchens pass, in CI and through the two tester agents on staging, before a build goes to Vero and Levi.

**Selectors for the tester agents:** role plus name first (`button "Send"`, `button "Open chat"`, `region "Kitchen"`, `button "Choose Spinach omelette"`, `button "Undo: …"`, `checkbox "Feta"`; meals: `region "Meal ideas"`, `region "Meal plan"`, `button "Start cooking X"` / `"Done cooking X"` / `"Cancel X"` / `"Undo: cancelled X"`, `button "X: open recipe"`, the Recipe's `article` with `heading` X, `group "In your kitchen"` / `"Need"`, `checkbox "Feta, ticked by Levi"`, `button "Add Need items to shopping list"`, `dialog "Update your kitchen"` with one `radiogroup` per ingredient named after it, `button "Allergy: Contains shrimp: …"`; batches: a several-batch Kitchen row is `button /^Eggs/` with `aria-expanded`, its `list "Eggs: batches, oldest first"`, the receipt's `group "You also had eggs from Oct 2."` with `button "Still have them: eggs from Oct 2"` / `"Those are gone: eggs from Oct 2"`). Otherwise `data-widget`, `data-entity-id`, `data-change="new|updated"`. Names live in `en.json` and change only on purpose.

## 9. Folder layout

```
src/proxy.ts
src/app/  layout.tsx manifest.ts (auth)/sign-in/ (main)/{layout,page,actions}
          (main)/recipe/[mealId]/ (main)/kitchen/ settings/ privacy/ terms/ offline/ api/ (backend)
src/ui/   shell/ (AppShell, TopBar, OfflineBanner)  chat/ (Dock, Receipt, Composer, useChatStream; schemas from src/contracts/)
          workspace/ (registry, reducer, WidgetFrame)  widgets/kitchen/ (widgets, Recipe, sheets)
          sync/ (useKitchenSync, offline snapshot)  a11y/ (Announcer)  primitives/ (Base UI wrappers)
src/lib/i18n/messages/en.json · public/sw.js, icons/
```
Wrapping Base UI in `primitives/` means swapping libraries touches one folder.

## 10. First UI build plan

1. Skeleton: tokens, i18n, primitives, lint, tests, manifest.
2. Sign-in (link + code; rolling session per FE1, Sign out everywhere).
3. Shell: phone dock (Peek/Full/Minimized + chat button per UX4, keyboard, safe areas), desktop split, stubbed chat, widget error boundaries.
4. Chat stream on the fake interpreter: bubbles, receipt, Undo, errors, live region.
5. Registry, reducer, Kitchen widget → **journey steps 1–4**.
6. Meal ideas, Choose, Recipe → steps 5–6. Meal plan → step 7.
7. `useKitchenSync`, persistence, offline snapshot → step 8.
8. Playwright journey with axe in CI; manual VoiceOver pass.
9. Then sheets (incl. the after-cooking step, M8), To review, Settings, Levi cues; household smoke test.

---

## Questions for Vero

1. **FE1. How long should you stay signed in on a device?** **Rec:** a rolling **1 year** (in practice "never" for daily use), plus **Sign out everywhere** in Settings. Still open.
2. **FE2. Offline: queue messages or a local model?** **Rec:** read-only offline now (Send disabled), queued messages next MVP. Still open.
3. **FE3. Dark mode:** answered → 0017 (no dark mode; semantic tokens, §4).

## Risks and how we'd reverse

| Risk | Reversal |
|---|---|
| iOS keyboard handling misbehaves | Switch to Full chat while typing; revisit when Safari ships `interactive-widget` |
| Base UI gaps | Swap `primitives/` to React Aria Components |
| Service-worker caching bugs | Versioned caches, network-first pages, a shipped unregister kill switch |
| AI specialist prefers the AI SDK | Only `useChatStream` changes |
| Polling drains battery or Neon hours | Paused when hidden; swap `useKitchenSync` for live updates |

**Contract changes requested (all accepted in the integration pass; see backend §6 and its changelog)**
- `ApplyResult.applied[].refs`; translatable `Msg {code, params, text}` summaries and rejections; `createdAt/By` and `updatedAt/By` on rows; `state` always included in ApplyResult.
- Session length per FE1; one email with link and code (0017).
- The turn stream is merged with AI's pipeline. **Choose** streams via `POST /api/meals/choose`.


---

## Run it locally (milestone 2)

No accounts, no real AI. Node 24+.

| Step | Command |
|---|---|
| Install | `npm install` |
| Start the app | `npm run dev`, then open http://localhost:3000 (on a phone on the same Wi-Fi: the "Network" address it prints) |
| Who you are | The yellow **Dev only** bar: switch **Acting as Vero / Levi** (the local `demo` kitchen, seeded on first load). **Reset** empties it. |
| Checks | `npm run typecheck` · `npm run lint` · `npm test` |
| End-to-end + accessibility | `npx playwright install chromium` (once), then `npm run test:e2e`. It starts its own server on port 3210 with its own database (`.data/pglite-e2e`), so it doesn't touch yours. `M2_SCREENSHOTS=1 npm run test:e2e` refreshes `docs/design/screenshots/m2-*.png`. |

The stand-in AI understands only: "I bought X, Y and Z", "I froze the X", "I used the rest of the X", "X is running low", "I defrosted the X", "the old X are gone", "undo". Anything else gets a polite "I didn't catch that".
Stop `npm run dev` before `npm run db:seed` (one process per local database folder).

## Build changelog

| Date | Where the build differs from the design above, and why |
|---|---|
| 2026-10-14 (M2) | **Scope built:** §10 steps 1, 3, 4, 5 (skeleton, shell, chat on the fake interpreter, registry + Kitchen widget) plus thin server plumbing. Not built: sign-in, sheets, To review, See all, offline snapshot/service worker, Meal ideas/Recipe/Meal plan. |
| | **Icons: Phosphor** (MIT), not lucide (§4): Clay & Honey specifies Phosphor (visual-direction §3C). Imported one by one through `src/ui/primitives/icons.tsx`. |
| | **No TanStack Query yet** (§4): sync is one small framework-free store (`src/ui/sync/kitchen-sync.ts`) + `useKitchenSync`; the version-then-state polling needed custom code anyway. Easy to swap later. |
| | **next-intl without the server plugin:** one locale, so messages load in the root layout and only client components translate. Add the plugin when a server component needs text. |
| | **Tokens:** Tailwind's palette, spacing, radii, type and shadows are reset; only Clay & Honey semantic tokens exist (`src/app/globals.css`, utility names = token names, e.g. `text-text-muted`). Lint refuses hex colours, palette classes and hard-coded UI text. Dark mode = one more token block. |
| | **Dev "acting as" switch** instead of sign-in: a cookie picks Vero or Levi in a new local-only `demo` seed scenario (stand-ins named like the household; tester scenarios untouched). Off in production twice over: compiled out (`NODE_ENV`), and the server refuses to start with `DEV_ACTING_AS` set (`src/instrumentation.ts`). `POST /api/dev/reset` answers 404 outside dev. |
| | **Interpreter seam** (orchestrator spec): `src/ai/interpreter.ts` (`interpret` + optional `reword`), `getInterpreter()` returns the fake unless `AI_MODE=real` (TODO for the AI specialist). The draft reply is sent only if every op applied, else `reword` or a reply built from the receipt. The fake gets a "my recent changes" lookup for "undo". |
| | ~~Chat history is in memory only~~ (superseded by P2 a below). |
| | **Kitchen widget shows every item** (no compact 8 + See all yet). Within a group, most recently changed first. "Levi · just now" shows on any row last changed by someone else; it's highlighted if it arrived while you were looking. |
| | **First-run suggestions** are "I bought…", "I froze the…", "We're running low on…" (what the stand-in understands), not ux.md's ideas/allergy ones, which would dead-end now. |
| | **Phone Peek** caps the reply + receipt at 40% of the screen height; the workspace and focus padding follow the measured dock height (`--dock-height`). |
| | **iPhone keyboard:** `src/ui/shell/viewport.ts` publishes `--keyboard-inset` from `visualViewport` (ignored under 120 px or when pinch-zoomed). Not yet tried on a real iPhone. |
| | **e2e:** Chromium only, phone (393×852, touch) and desktop (1280×800). WebKit not installed yet. axe fails the run on serious/critical WCAG 2.2 A/AA issues. |
| | **Next 16.4 housekeeping:** `agentRules: false` (otherwise `next dev` appends to AGENTS.md); `distDir` from `NEXT_DIST_DIR` so the e2e server has its own build folder (hence `.next-e2e` in tsconfig). |
| | **/unlock restyle (Clay & Honey):** centred card, Show/Hide toggle (name says what it does), field focused at load and after an error, typed code kept after an error (controlled input), pill Unlock with pending state. iPhone: `.unlock-page` pads by `--keyboard-inset` + safe areas and scrolls Unlock into view when the keyboard opens. Server action unchanged. Tests: `tests/ui/unlock-form.test.tsx`, `tests/e2e/unlock.spec.ts` (`UNLOCK_SCREENSHOT=1` saves `docs/design/screenshots/unlock-phone.png`). Shared axe helper now in `tests/support/axe.ts`. |
| | **Composer placeholder** shortened to "Tell me what changed…" (approved) so it fits one line on phones. |
| **Shopping list (2026-10-14, 0027, SL1–SL4 Recs)** | New widget `src/ui/widgets/shopping/` (one folder + one registry line): grouped by store, Anywhere last; a row is a native checkbox ("Garlic, got it[, ticked by Levi]") with the whole row as the tap target, ⋯ "More for garlic" → Remove with an in-place Undo; empty / loading / error / stale states; "Done shopping" → "Add to your kitchen?" sheet (`DoneShoppingSheet`, Base UI Dialog; unticked items chosen there are ticked first, then `finishShopping`; Do later and Skip change nothing until To review supports the list). **Ticks (SL4 Rec):** `tick-queue.ts` shows a tick at once, saves one at a time (fixes stale rejections on quick double taps), keeps unsent ticks in `localStorage` as "Not synced yet" and sends them on `online` / app open. Button changes go through `KitchenActionsContext` (server actions in `src/app/actions.ts`). Receipts group a run of adds to one store into "On your list, {store}: …" (`receipt-lines.ts`). Shopping refs get New / Updated; the other person's ticks get the soft highlight. A phone reopens with the last-used widget on top (`restoreFocus`, `localStorage`). Fake interpreter understands "add X and Y to the list [for Store]". E2E: `tests/e2e/shopping.spec.ts` (axe at each step). |
| **Saved chat history (2026-10-14, P2 a)** | Chat survives a reload, using `GET /api/chat/history` (`src/contracts/chat-history.ts`). **First page on the server:** `app/page.tsx` reads your latest 30 messages next to the kitchen (`Promise.allSettled`, so one failing never blocks the other) and passes them to `useChat` (`initialHistory`). There's no loading flash, and phone Peek shows the latest reply and receipt straight away, like a live one. If that read fails, the dock fetches it itself: "Loading your messages…", then "I couldn't load your earlier messages. [Try again]"; the composer keeps working (0018). The welcome and suggestions show only when there's no saved chat. **Saved → live:** the user's message gets its `clientMessageId` as ID and the reply gets `replyId(clientMessageId)`, the same IDs live turns use, so the reducer (`historyLoaded`) skips any turn already on screen. Saved receipts use the live receipt model, so Undo works the same and shows only where `undoable` is true. A receipt with `undone: true` loads as Undone (struck through, "Undone", no Undo or View), exactly as after a live Undo (`toReceipt`; 2026-10-14 tester run). A saved message that fails the contract is dropped and logged. **"Show earlier messages"** (Full view and desktop; hidden in Peek) is a button rather than infinite scroll. It loads the next page above and restores your distance from the bottom, so what you were reading stays put. Focus stays on the button, or moves to the oldest message once there's nothing older (the button goes). The live region says "N earlier messages shown" (plus "That's the start of your chat."). While loading, the button is `aria-disabled` rather than `disabled`, so it keeps focus. If loading fails, it says so and the button stays. "Keep the newest in view" now follows the *last* message, so older pages don't jump you to the bottom. **Turns no longer send `history`:** the server builds the AI's context from saved chat. Tests: `tests/ui/chat-history.test.tsx` and `tests/e2e/chat-history.spec.ts` (send → reload → receipt and Undo still work; send → Undo → reload → still Undone; with axe at each step; `CHAT_HISTORY_SCREENSHOT=1` saves `docs/design/screenshots/chat-history-phone.png`). |
| **Meals (2026-10-14, P2 d; 0005, 0009, 0013, 0019)** | **Routes:** the main screen is now a layout (`app/(main)/layout.tsx`: the server reads, then `KitchenApp`), so it stays mounted between `/` and `/recipe/[mealId]` (`(main)/page.tsx` is empty; `(main)/recipe/[mealId]/page.tsx` reads the saved recipe on the server for a reload, inside its own Suspense, and never fails the page). The Recipe replaces the widgets in the workspace column (phone: full page; desktop: right column); the widgets stay mounted but `hidden`, so Back returns to the same place. The dock never reloads. **Session state:** `widgets/meals/session.ts` is one pure reducer fed by both streams (`/api/chat` via `useChat`'s new `onEvent`, and Choose via `POST /api/meals/choose`, `choose-stream.ts`), keyed by stream: ideas in card order (`ideas.dropped` removes the set; a new request replaces it), recipe parts by index, dropped at stream end unless `recipe.saved` came, and the "Update your kitchen" request. `useMealsController` wires it: ideas streaming focus Meal ideas (no saved refs, so it's explicit); a tapped Choose opens the Recipe at once and moves focus to its heading; choosing in chat ("the second one") opens it without moving focus; `recipe.saved` moves the version without sending state, so **every meal button waits for the fresh state first** (else STALE_TARGET) and re-checks the kitchen after a refusal. **Widgets:** Meal ideas (`session`, closable ×: a new `onClose` in `WidgetFrame`) with name, why, Uses (kitchen names), Missing, the allergen badge and the basics note; "Chosen ✓" comes from `state.meals[].ideaId`, so a cancelled meal frees its card. Meal plan (cooking first, labelled; Start cooking / Done cooking / Cancel, Cancel leaves "X cancelled · Undo" in place until your next message; appears on its first meal and stays for the session, "Nothing planned yet"). **Recipe:** "Suggested recipe" / "Your recipe", status, **Use my own recipe** (fills the composer with "My recipe for X: " and opens the dock; R2 Rec), the allergy flag (opened) and per-ingredient badges, one checklist in two groups (assumed basics sit in "In your kitchen", marked "assumed"; amounts shown), shared ticks shown at once and saved one at a time, "ticked by Levi", then **Add Need items to shopping list** (with Undo), steps, and Add to plan / Start cooking / Done cooking by status. Done cooking from the Recipe returns to the workspace, then opens the sheet. **Allergen badge (0019):** a small plum "Allergy" button (28 px high, above the 24 px minimum) that toggles "Contains shrimp: Levi's seafood allergy." plus "Their note: …"; the same words are in its accessible name, so nothing depends on tapping. **"Update your kitchen"** (`UpdateKitchenSheet`, Base UI Dialog): opened by the `update-kitchen` event, by Done cooking, or by its To review card (now a button); one labelled radio group per ingredient (`ChoiceRadio` primitive), Still have some by default; optional note; Done (nothing changed + no note = no call) / Do later (`updateKitchenLater`; from a card it just closes) / Skip (no call; from a card `skipUpdateKitchen`); Esc = Do later. The result ("Updated your kitchen after X: 1 running low and 1 out.") shows in the Kitchen widget with Undo, and the Kitchen comes forward. Focus returns to the opener, or the workspace if it's gone. **Not built (not asked):** the "Add to your kitchen?" sheet on Start cooking with ticked Need items, Cancel in the Recipe's ⋯, the "Your kitchen changed since these ideas" stale line. **Dev reset** now also clears the demo members' chat rate-limit counters (`resetDemoKitchen`, dev only): a full e2e run sends more than 60 messages an hour. **Tests:** `tests/ui/meals.test.tsx` (reducer, cards, badge, Recipe, plan, sheet, choose stream), `tests/e2e/meals.spec.ts` (journey steps 5–7 + after cooking, tap and chat paths, Cancel/Undo, axe at each step; `MEAL_SCREENSHOTS=1` saves `docs/design/screenshots/m-ideas-phone.png`, `m-recipe-phone.png`, `m-update-kitchen-phone.png`). **Flake fixed:** `tests/ui/to-review.test.tsx` "Skip closes the card…" used an unscoped `getByText` right after the sheet closed; the announcer repeats the same words 50 ms later, so under full-suite load it found two. It now waits for each state with `findBy…`, scopes queries to the sheet, and ignores the live region. |
| **Settings (2026-10-14, P2 b; 0015, 0017, 0019 AI7, D1)** | **Route:** `app/(main)/settings/page.tsx` (server: `loadSettings()` after `connection()`, plus other members' allergies and diets via `getSettingsView`, passed as `MemberRestrictions` with their preferences left out) → `ui/settings/SettingsScreen.tsx`. Server actions are passed in as props (`SettingsActions`), so component tests use fakes. Like the Recipe, it replaces the widgets in the workspace, which stay mounted and `hidden`. **Header:** the avatar is now a link, "Settings, signed in as Vero" (`data-settings-link`, `aria-current` on /settings), 44 px, with negative margins so the header stays 48 px. A taller header hid the shopping ⋯ button under it. **Sections:** Account (name; Sign out; Sign out everywhere behind a `ConfirmSheet`, focus on Cancel); Kitchen ("Shared with Levi"); Allergies and preferences: yours with provenance ("Added by Vero, needs you to confirm" → **Confirm / Edit note / Remove**; Edit note fills the composer, fixed in chat as in 0007; the receipt shows with Undo through `KitchenActions.undo`, and focus moves to it), preferences read-only ("tell Kitchen in chat"), and each other member's allergies and diets read-only ("Added by you, needs Levi to confirm"; "Only Levi can change these."); Your data (Download = a link to `GET /api/me/export`; Delete = `ConfirmSheet` with the typed phrase, where the button stays `aria-disabled` until it matches, case and outer spaces ignored, then `POST /api/me/delete` → `/unlock`; D1 copy, and "the kitchen is deleted too" when you're its only member); Privacy and terms. Sign out, Sign out everywhere and delete clear this phone's localStorage and sessionStorage (unsent ticks included). **Policies:** `/privacy` and `/terms` (`ui/settings/PolicyPage.tsx`) are placeholder plain-language text in `en.json` `policy.*`, marked as needing review before any public launch (0015). They're still behind the access-code gate. **AI7 banner:** `(main)/layout.tsx` also reads your settings; unconfirmed restrictions someone else added become `ConfirmPromptProvider` state, and `ConfirmBanner` on the home screen says "Vero added your seafood allergy. Confirm or change it?" (wording avoids a/an) and links to `/settings#settings-remember`, where focus lands on that section. **Not now** hides it for the browser session (sessionStorage via `useSyncExternalStore`, with an in-memory fallback). Confirming or removing in Settings clears it without a reload. **Former members (D1):** `actorName` gives "a former member" (sentence-cased at the start of a line) in Kitchen rows, list ticks, recipe ticks and Meal plan "Added by"; `msg.FORMER_MEMBER_PROFILE` / `RESTRICTION_VERIFIED` / `RESTRICTION_REMOVED` are translated. **Demo seed:** in the local `demo` scenario, Vero now saves Levi's seafood allergy, so it waits for Levi to confirm; `household` is unchanged. **Tests:** `tests/ui/settings.test.tsx`, `tests/e2e/settings.spec.ts` (axe at each step; Delete is stubbed at the route so the demo kitchen survives; `SETTINGS_SCREENSHOT=1` saves `docs/design/screenshots/settings-phone.png`). |
| **Batches (2026-10-14, P2 c; 0025, K1)** | **Kitchen row:** an item with 2+ open batches shows "2 batches · oldest 12 days" in place of "added X days ago" (the row's `addedAt` is the oldest batch's), and the whole row is a Base UI Collapsible trigger (`data-batches-toggle`, caret, `aria-expanded`). It opens a view-only list, oldest first: "Added Oct 2", amount, Fridge/Freezer/Pantry, Frozen or "Defrosted Oct 11", Running low, Opened, "Added by you / Levi", then "To change these, tell me in chat." One-batch rows are unchanged (no button). **Defrosted** shows on the row when an open batch has `defrostedOn` and isn't frozen again (`isDefrosted`, `widgets/kitchen/model.ts`; falls back to the row's own fields for an older cached state). There's no See all page yet, so the row is the only way in. **Receipt choice** (`ui/chat/BatchOffers.tsx`): for each `applied[].batchOffers`, while its older batches are still open and unanswered **in the current kitchen** and the new batch still exists (so answering in chat, the other person, or undoing the purchase hides it): "You also had eggs from Oct 2." (dates joined by locale) in a `role="group"` labelled by that sentence, with **Still have them** / **Those are gone**, named "Still have them: eggs from Oct 2" (visible words first, WCAG 2.5.3). They call `keepOlderBatch` / `closeBatch` (new `KitchenActions.closeBatch` / `keepOlderBatch`, with only the still-open IDs). The result replaces the buttons in place and is announced politely: Those are gone → "Eggs: those are gone (1 batch left)", and the receipt's **one Undo** (focused) now undoes that answer: one Undo per receipt, stepping back the newest change first, like Cmd-Z (2026-10-14 tester run found two stacked Undo buttons). Undo brings the batches and the choice back, focus on Those are gone, and the same Undo is for the purchase again. Still have them → "Kept the older eggs", focused, no Undo (soft, per backend). A failure says "I couldn't save that, so nothing changed. Try again." and keeps the buttons. The turn's announcement adds the question, since nothing else points to it. **Messages:** `msg.*` for the 5 codes mirror `src/shared/messages.ts` exactly (`messages.test.ts`); a new `msgIcu.*` namespace, read first by `useFormatMsg`, holds ITEM_BATCH_ADDED's full wording ("; the oldest batch is closed", "and took it off the shopping list"), which the backend builds from flags, and ITEM_BATCH_USED_UP / ITEM_BATCH_GONE's "(1 batch left)" / "(2 batches left)" (ICU plural; "(1 left)" read as one egg). **Not built:** a "use soon" cue (not in ux.md; shelf life is out of MVP 1 per 0025). **Tests:** `tests/ui/batches.test.tsx` (row, list, Defrosted, choice → gone → Undo, keep, failure, hidden when answered/undone, two dates, the 5 codes), `tests/e2e/batches.spec.ts` (eggs twice → choice → Those are gone → Undo; defrosted chicken; axe at each step; `BATCHES_SCREENSHOT=1` saves `docs/design/screenshots/batches-phone.png`). |
| **Invite links and passphrase sign-in (2026-10-14, SU1 Rec; not live until Vero says go, 0028)** | **`/unlock`** has two calm modes on one card: **name + passphrase** (default; `signInWithPassphrase`; `autocomplete` `username` / `current-password`) and **"Use an access code instead"** (the original form, unchanged, a backup). Switching focuses the new mode's first field; one `role="alert"` per form; typed values kept after an error. **`/join/[token]`** and **`/reset/[token]`** (server pages, `connection()` then `checkJoinLink` / `checkResetLink`; `noindex`, `no-referrer`): valid → `ui/auth/SetPassphraseForm.tsx`, "Join Vero's kitchen" (name + passphrase → `acceptJoin`) or "Set your passphrase" for the named member (→ `acceptReset`, a hidden `username` field so password managers save the pair); `new-password`, Show/Hide, and a hint from `ui/auth/strength.ts` that counts down to 12 characters, then "That works" / "That's a strong passphrase" (never "weak", never red). Too short is caught before sending; name errors focus the name, others the passphrase. Unknown, used or expired (or `invalidLink` mid-form) → `ui/auth/LinkGone.tsx`: "This link no longer works. Links work once and last 24 hours. Ask Levi for a new link." naming **whoever made the link** (`LinkInfo` `{ok: false, invitedBy?}`, given only for a token that hashes to a real link of that purpose), else "Ask the person who sent it for a new link." Never a fixed name. + Go to sign in. Shared pieces in `ui/auth/fields.tsx` (`AuthCard`, `SecretField`, `TextField`). **Settings → Kitchen:** for each other member **without a passphrase**, "Levi still signs in with an access code." + **Send sign-in setup link** (named "… to Levi"; a *reset* link, so Levi keeps his account and allergy); with one, a quieter **Send passphrase reset link** (SU1 Rec's "forgot your passphrase"). **Invite someone new** (a join link), replaced by the reason at the 4-account cap. Test kitchens can't make links (0021), so they say so. Each opens `ui/settings/LinkSheet.tsx`: the link is made when the sheet opens and lives only in its state (gone on close), with **Copy** (Clipboard API; refused → "press and hold the link"), the system **Share…** where `navigator.share` exists, and "Valid for 24 hours, works once."; focus starts on Done, moves to Copy when ready, returns to the opener. **Settings → Account:** **Set your passphrase** (current = your access code) or **Change passphrase** ("your other devices will be signed out") in `ui/settings/PassphraseSheet.tsx` → `changePassphrase`; success says "Passphrase saved." and the button flips. **Contract (additive):** `SettingsView.members[].hasPassphrase` and `SettingsView.accountsFull` (`getSettingsView`; `countAccounts` now exported from `lib/auth/invites.ts`). **Bug fixed:** closing a `ConfirmSheet` with Cancel left Base UI's backdrop stuck "closing" over the page, blocking every tap; the sheets now keep their Popup mounted and re-key it per opening (regression: `settings.spec.ts` Sign out everywhere → Cancel → tap again). **Tests:** `tests/ui/unlock-form.test.tsx`, `tests/ui/sign-in-links.test.tsx`, `tests/unit/passphrase-hint.test.ts` (client and server length rules match); e2e `tests/e2e/sign-in-links.spec.ts` on a **second dev server** (port 3211, `tests/support/auth-server.ts`: the real gate, no `DEV_ACTING_AS`, real Vero and Levi from `db:bootstrap` in a fresh `.data/pglite-e2e-auth` each run, throwaway test secret and access code): Vero signs in with the access code → setup link for Levi → Levi in a fresh browser sets a passphrase → shared kitchen → signs out → wrong then right name + passphrase → the used link is calm; someone new joins (phone and desktop, different names; a taken name is refused); unknown links are calm; axe at each step. `SIGNIN_SCREENSHOT=1` saves `docs/design/screenshots/join-phone.png` and `settings-invite-phone.png`. |
