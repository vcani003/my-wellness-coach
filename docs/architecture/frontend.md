# Frontend and accessibility architecture

**Status:** Proposed, pending Vero's review · 2026-10-13 · Frontend + Accessibility specialist
**Builds on:** [ux.md](ux.md), [backend-data.md](backend-data.md) (§6, §9); decisions 0001, 0002, 0004, 0005, 0007, 0011, 0013, 0015, 0016. `ai.md` didn't exist yet, so the chat stream format in §3 is a proposal for AI and Backend to confirm. Where an outstanding question matters, the design works either way and cites its ID.

---

## 1. App structure

Next.js 16 "App Router": each folder is a URL. A **layout** wraps pages and stays mounted while you navigate, so the chat dock lives in one and never reloads.
- **Server components** run on the server and send finished HTML: fast, and no secrets reach the phone. Used for sign-in checks, the first load of kitchen and chat history, Settings and policies.
- **Client components** run in the browser and handle anything interactive: chat, widgets, sheets.

| URL | UX screen |
|---|---|
| `/sign-in` | Sign-in: email, check email, code (UX2), expired link |
| `/` | Main: workspace + dock (phone) or split (desktop) |
| `/recipe/[mealId]` | Recipe: full page on phone, workspace column on desktop; dock stays |
| `/kitchen` | Kitchen "See all" (works for either K1 answer) |
| `/settings`, `/settings/delete` | Settings, delete-data confirmation |
| `/privacy`, `/terms`, `/offline` | Policies (0015); offline fallback page |

Real URLs make the phone's Back button just work. Next 16's `proxy.ts` (formerly "middleware") only redirects signed-out visitors; the real permission check runs on the server for every read and action (backend §7).

## 2. Widget system (0004)

**The seam is one list: the widget registry.** Each widget describes itself:

| Field | Purpose |
|---|---|
| `id`, `domain` | `"kitchen.items"`, `"kitchen"` |
| `Component` | Renders the widget and fetches its own domain's data |
| `isPresent(state)` | Has content? |
| `wantsFocus(turn)` | Does this turn concern me? (item change → Kitchen) |
| `barSummary(state)` | Collapsed bar text ("Meal plan · 2 · 1 cooking") |
| `lifetime` | `lasting` (Kitchen, Meal plan) or `session` (Meal ideas, M5) |

`widgets/kitchen/index.ts` exports the Kitchen widgets, and `workspace/registry.ts` is `[...kitchenWidgets]`. A Fitness widget later is a new folder plus one line; no Kitchen file changes, and the workspace knows nothing about food. No plugin loading.

**Showing, ordering and focusing** is one pure function (a **reducer**: old state + event → new state) handling `turnApplied`, `remoteChange`, `userToggled` and `userClosed`. It implements UX §2: the focused widget moves to the top only after your message; phone expands only that one; desktop expands all; remote changes never reorder or move focus. Pure means easy to unit-test.

## 3. State and data flow

| Kind | Lives in | Examples |
|---|---|---|
| **Server state** (database truth) | TanStack Query cache, behind `useKitchenSync` | Items, meals, plan, To review, version |
| **Conversation** | Chat provider in the main layout | Messages, streaming reply, receipts |
| **UI state** | Workspace reducer, components | Order, focus, highlights, sheet ticks, dock Peek/Full |

**Your own change:** the `ApplyResult` arrives → the client stores the embedded new `state` (backend §6) → notes `newVersion` so polling doesn't refetch it → the reducer focuses the right widget and marks rows "New"/"Updated" until your next message.

**The other person's change:** `useKitchenSync` polls `/version` per backend §6 (15 s visible, 60 s after 5 idle minutes, immediately on return, paused when hidden). A higher version reloads state; rows with `updatedBy` ≠ you get the soft "[Husband] · just now" highlight.

**Optimistic updates** (showing a change before the server confirms): **no** for anything the AI interprets (UX notes). **Yes for checklist ticks only**: unambiguous, and lag would feel broken. A failed tick reverts with "Couldn't save · Retry".

**Chat streaming:** plain `fetch` reading one JSON event per line (NDJSON), each checked by the shared Zod schema in `src/contracts/`. The **canonical event list is the turn stream table in backend §6** (`ack`, `status`, `applied`, `clarification`, `offer`, `notes`, `text`, `idea`, `recipe`, `recipe.saved`, `done`, `error {reason, changed, retryable}`). The same stream serves `/api/chat` and **Choose** (`POST /api/meals/choose`).
Because the backend interprets, then applies, then replies, `applied` always arrives before any `text`, so widgets update *before* the reply streams. Each message has a client-made ID, so **Try again** can never apply twice.

**Errors:**
- Fails before `ack`: "Not sent · Try again".
- `error` with `changed: false`: "I couldn't save that, so nothing changed. [Try again]".
- Stream cut after `applied`: "Reply interrupted. Your changes were saved."
- **Partly rejected:** the receipt lists applied lines with Undo, plus a muted line per rejection; the reply already reflects it.
- Undo refused: "Can't undo this now. Tell me what to fix."

## 4. Libraries

Versions checked on the npm registry, 2026-10-13. Pin exact versions at build start.

| Need | Choice | Why | Rejected |
|---|---|---|---|
| Framework | **Next.js 16.4, React 19.3** | Preference; matches backend | — |
| Accessible primitives | **Base UI 1.9** | Unstyled, accessible dialog, **drawer** (bottom sheet: swipe, focus trap, focus return), accordion, checkbox group, menu, OTP field; one maintained library | React Aria Components: heavier, more opinionated. Radix: no drawer. Vaul: **unmaintained** (its README) |
| Styling | **Tailwind CSS 4.3** + CSS-variable tokens | No runtime; suits unstyled primitives; contrast checked in one token file | CSS Modules: slower to keep consistent |
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

## 5. PWA specifics (0001)

- **Install:** manifest (standalone; 192/512 px and maskable icons) plus an Apple touch icon. iOS 26 opens home-screen sites as web apps by default. Android installs from the menu without a service worker; Chrome's automatic prompt still wants one (2023 source).
- **Offline is read-only.** The service worker caches built files and `/offline`, and **never caches `/api` or sign-in**. The client keeps the last kitchen snapshot on the device ("Offline · showing your kitchen as of 6:42 pm") and disables Send (FE2). The snapshot is wiped on sign-out.
- **iPhone sign-in (UX2):** a home-screen app keeps cookies separate from Safari, so an emailed link signs in *Safari*. Apple has said cookies are copied once when the app is added; unconfirmed for iOS 26. *If UX2 is yes:* a code field (`autocomplete="one-time-code"`, paste allowed, which meets WCAG 3.3.8). *If no:* home-screen users are told to sign in in Safari first, then add the app. Long sessions (FE1) make it rare either way.
- **Keyboard and viewport:** `viewport-fit=cover`, `env(safe-area-inset-*)` padding, `100dvh`. Android supports `interactive-widget=resizes-content`, so the dock rides above the keyboard. **iOS Safari doesn't** (caniuse, through 26.5), so a small `visualViewport` listener sets `--keyboard-inset`. Riskiest piece: test on a real iPhone early.

## 6. Accessibility plan (WCAG 2.2 AA, proportionate)

**Chat and announcements**
- [ ] "Chat" and "Workspace" landmarks with skip links; one `h1`, an `h2` per widget.
- [ ] The message list is `role="log"` with announcing **off**, so streamed chunks aren't read piecemeal.
- [ ] **One polite live region** (announces without moving focus) speaks once per turn on `done`: reply plus receipt summary ("Added eggs, spinach. Kitchen updated."). [Husband]'s changes: at most one announcement per poll.
- [ ] Focus stays in the composer after Send; incoming changes **never** move it.
- [ ] Undo is named for what it undoes ("Undo: chicken thighs moved to freezer"); used quick replies stay readable but disabled.
- [ ] Desktop: Enter sends, Shift+Enter adds a line, Esc closes sheets.

**Dock, sheets, widgets**
- [ ] Show/Hide chat button with an expanded state; dragging optional (2.5.7).
- [ ] `scroll-padding-bottom` equals the dock height, so focus is never hidden behind it (2.4.11).
- [ ] Sheets trap focus, Esc/swipe-down mean Do later, focus returns to the opener.
- [ ] Accordion bars are buttons with an expanded state; the "Updated" dot has text.
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
| Unit (Vitest) | Workspace reducer, stream parser, sync timing |
| Component | Composer focus, sheet focus return, Undo names, error states |
| End-to-end (Playwright) | UX §8 journey on iPhone-sized WebKit, Android-sized Chromium and desktop, with backend's **fake interpreter** and `/api/test/reset` |
| Regression | Every bug gets a test that fails without the fix |

**Selectors for the tester agent:** role plus name first (`button "Send"`, `region "Kitchen"`, `button "Choose Spinach omelette"`, `button "Undo: …"`, `checkbox "Feta"`). Otherwise `data-widget`, `data-entity-id`, `data-change="new|updated"`. Names live in `en.json` and change only on purpose.

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
2. Sign-in (link, plus code if UX2).
3. Shell: phone dock (Peek/Full, keyboard, safe areas), desktop split, stubbed chat.
4. Chat stream on the fake interpreter: bubbles, receipt, Undo, errors, live region.
5. Registry, reducer, Kitchen widget → **journey steps 1–4**.
6. Meal ideas, Choose, Recipe → steps 5–6. Meal plan → step 7.
7. `useKitchenSync`, persistence, offline snapshot → step 8.
8. Playwright journey with axe in CI; manual VoiceOver pass.
9. Then sheets, To review, Settings, [Husband] cues.

---

## Questions for Vero

1. **FE1. How long should you stay signed in on a device?** **Rec:** 60 days, renewed each use, with Sign out in Settings. It makes the iPhone sign-in hurdle (UX2) rare.
2. **FE2. With no internet, should the app accept messages and send them later?** **Rec:** no. Offline shows your last-known kitchen read-only, with Send disabled. Messages applied hours later could surprise you.
3. **FE3. Dark mode in MVP 1?** **Rec:** no. Colours are tokens, so following the phone's setting later is small.

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
- Session length per FE1; *if UX2 is yes,* one email with link and code.
- The turn stream is merged with AI's pipeline. **Choose** streams via `POST /api/meals/choose`.
