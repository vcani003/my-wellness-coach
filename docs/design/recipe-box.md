# Recipe box: "Cooked before" (UX spec)

**Status:** Proposed · 2026-10-15 · UI/UX specialist. Implements decision **0040** (RB1–RB9) and plan piece **A3** plus the UI for **C** and **B1** in [plans/recipe-box.md](../plans/recipe-box.md). It doesn't redefine anything in 0040. Builds on 0013 (lifecycle), 0019 (allergies), 0032 (search), 0034/0035 (layout, "stay put"), 0038 (four checks) and Clay & Honey tokens (0024, [visual-direction.md](visual-direction.md)). The people are fictional: **Ana** (you) and **Ben** (shares the kitchen).

---

## 1. Where it lives

| When | Entry point |
|---|---|
| **Today's layout** (ux.md §1) | A footer row in the **Meal plan** widget, the same shape as Kitchen's "See all": a search icon button plus the link **Cooked before (12)**. It opens a **full page** on a phone (Back, dock stays) and **fills the workspace** on desktop (chat stays on the left), exactly like Kitchen See all. The search icon opens the same page with the cursor in the search field. |
| **Meal plan widget appear rule (change to ux.md §2, a UX call)** | The widget appears once there's a planned, cooking **or Done** meal, so the link is reachable when the plan is empty. Body then reads "Nothing planned yet." with the footer below. Reason: otherwise the only way in disappears exactly when you're looking for something to cook. |
| **Option 2 layout** (0034, not built) | The **Meals** area (left nav on desktop, bottom tab on phone) has a two-part segmented control at the top: **Plan · Cooked before**. Same list, same search, same rows; the segment choice is remembered per device. The Meal plan footer link goes away then. |
| **Chat** | Naming a dish you've cooked before brings the offer in §5. Chat never opens the list by itself (0035). |

## 2. The list

```
PHONE                                   DESKTOP (workspace, chat on the left)
┌──────────────────────────────┐        ┌────────────────────────────────────────────────┐
│ ‹ Back                       │        │ ‹ Back                                         │
│ Cooked before                │ 22px   │ Cooked before                                  │
│ 12 meals, newest first       │ muted  │ 12 meals, newest first                         │
│ ┌──────────────────────────┐ │        │ ┌──────────────────────────────────┐           │
│ │ ⌕ Search by name or ingr…│ │ sticky │ │ ⌕ Search by name or ingredient   │           │
│ └──────────────────────────┘ │        │ └──────────────────────────────────┘           │
│ OCTOBER                      │        │ OCTOBER                                        │
│ ┌──────────────────────────┐ │        │ ┌────────────────────────────────────────────┐ │
│ │ Green curry          ›   │ │ 18px   │ │ Green curry        Made 2× · last 15 Oct   │ │
│ │ (2×) Last 15 Oct · Ben   │ │        │ │ [Allergy]                    Ben       ›   │ │
│ │ [Allergy]                │ │        │ ├────────────────────────────────────────────┤ │
│ ├──────────────────────────┤ │        │ │ Spinach omelette        Made yesterday     │ │
│ │ Spinach omelette     ›   │ │        │ │                          You       ›       │ │
│ │ Yesterday · You          │ │        │ └────────────────────────────────────────────┘ │
│ └──────────────────────────┘ │        │ SEPTEMBER …                                    │
│ SEPTEMBER                    │        │            [ Show more ]                       │
│ ⋯                            │        └────────────────────────────────────────────────┘
│ ══ dock: Peek ══════════════ │
└──────────────────────────────┘
```

- **One row per dish** (RB3), newest cook first, grouped under **month headings** (`font.size.caption`, sentence case: "October"; the year is added for months not in this year: "September 2025"). Grouping is by the latest cook.
- **Row content:** title (`font.size.title`, strong); a meta line in `color.text.muted`: a **"2×" chip** (`color.surface.sunken`, `radius.button`) only when made more than once, the date of the latest cook ("Today", "Yesterday", else "15 Oct"; "15 Oct 2025" if not this year), and **who cooked it last** ("You" or their display name; "Someone" if unknown). The cook is whoever marked it Done.
- **Allergy:** if the latest version clashes with **today's** allergies of anyone in the kitchen (0019, computed by code), the row shows the plum **Allergy** badge as **static text** (not a button: the row is the button). The details are in the row's accessible name and on the recipe.
- **The whole row is one link** (min 56 px tall) to the read-only recipe of the latest cook. Chevron at the right.
- **Length:** the first 30 rows, then **Show more** (30 at a time). No infinite scroll.
- **Ben's changes while you look** (0035, ux.md §6): nothing is inserted or reordered under you. A quiet line appears above the first heading: **"Cooked before updated · Show"**. Show reloads the list and keeps focus on the heading. If the list was empty, the new row just appears.

### Search (RB9, 0032)
- One field, placeholder **"Search by name or ingredient"**. Matches the title or any ingredient, **accent-insensitive** ("nuoc mam" finds "nước mắm"). It runs as a server query (plan A1) after typing pauses for 250 ms; the previous results stay on screen with a muted "Searching…" line until new ones arrive (no spinner, no flash of empty).
- While searching: one **flat list** (no month headings), same rows, with the matched words marked (`<mark>`, `color.highlight.bg`, as Kitchen See all). If the match is an ingredient, the meta line adds "Uses coconut milk".
- An **×** clears the field and returns focus to it. The result count is spoken once typing pauses (reuse Kitchen's 700 ms pattern).

### States
| State | What shows |
|---|---|
| **Loading (first time)** | Heading at once, then "Loading what you've cooked…" in muted text. |
| **Empty (nothing Done yet)** | "Nothing here yet. Meals you finish with Done cooking show up here, so you can make them again." |
| **No results** | "No meals match “{query}”" and the hint "Try one ingredient, like “coconut”." |
| **Error** (0018) | In place, error tint: "Couldn't load what you've cooked. [Retry]". Chat and the dock keep working. |
| **Search error** | Under the field: "Couldn't search just now. [Try again]". The field keeps your words. |
| **Offline / stale** | Last loaded list with the neutral line "Offline · showing what you've cooked as of 6:42 pm". Search is unavailable offline: "Search needs a connection." |

## 3. Read-only recipe (a Done meal)

```
┌──────────────────────────────┐
│ ‹ Back                       │
│ Green curry                  │ 22px heading
│ Suggested recipe · Cooked    │ muted labels; "Cooked" in success tint
│ Made 2× · last 15 Oct by Ben │
│ ┃ ⛉ Allergy                  │ plum panel, open by default here
│ ┃ Contains shrimp: Ben's     │
│ ┃ seafood allergy.           │
│ ┃ Their note: can eat it if  │
│ ┃ medicine is on hand.       │
│ (  Make it without shrimp  ) │ secondary pill (outline)
│ (●     Make again         )  │ primary pill, full width, the only filled button
│ Ingredients                  │
│ • Shrimp            [Allergy]│ plain list, no checkboxes
│ • Coconut milk               │
│ Steps  1. …                  │
└──────────────────────────────┘
```

- Same screen and route as today's Recipe (frontend §1), in a **read-only mode** when the meal is Done. It shows **the cooked version** (RB2).
- **Header:** title; the existing source label ("Suggested recipe" / "Your recipe"); a **Cooked** status pill (success tint) in place of "In your plan"/"Cooking"; then "Made 2× · last 15 Oct by Ben" (or "Cooked 15 Oct by you" when once).
- **Removed in this mode:** Start cooking, Done cooking, Add to plan, Cancel, Use my own recipe, the In your kitchen / Need groups and every checkbox. Ingredients are a plain list (with any per-ingredient Allergy badge); steps unchanged; the assumed-basics note stays.
- **Allergy (RB8, 0019):** the flag uses **today's** allergies. Here the panel is **open by default** (`startOpen`), because you're about to cook it. Directly under it, one secondary button: **"Make it without shrimp"** (several ingredients join as a list: "Make it without shrimp and peanuts"). Never "safe", never advice.
- **Make again** sits right under the header block (not at the bottom), so it's visible without scrolling. It's the page's focal point.
- **Chat on this page:** the dock stays. Refinements can't change a Done meal (plan A2); see question **RBX-2**.

## 4. After "Make again"

1. The button shows **"Making…"** and is disabled (no double meals). No optimistic UI.
2. Success: a **new Chosen meal** whose first version copies the cooked one (0040). The original is untouched.
3. Chat gets a receipt, as for any change: **"Chose Green curry again (from 15 Oct)"** with **Undo** (accessible name "Undo: chose Green curry again").
4. The page **navigates to the new meal's recipe** (you asked for it, so this isn't a jump). It's the normal editable Recipe: status, In your kitchen / Need recomputed against today's kitchen, checkboxes, Add to plan, Start cooking. A muted line under the title says **"From the one you cooked on 15 Oct"**. Allergy flags are recomputed.
5. Refine in chat as usual ("no oven", "for 4"). Back returns to the read-only recipe, then to the list.
6. **"Make it without shrimp"** = steps 1–4, then Kitchen sends **"Make it without shrimp"** as your message (visible in chat, so it's honest and you can change it). The recipe updates in place as a new version.
7. **Undo** cancels the new meal (0013, kitchen unchanged). If you're still on its recipe, the page stays put and shows the existing "Not in your plan any more" line plus a **"Back to Cooked before"** link.
8. **Failure:** in place under the button: "Couldn't make that again, so nothing changed. Try again." Offline: the same message.

## 5. Chat offer: "The one from 15 Oct, or a new one?" (RB7)

Only when code finds a Done meal whose title matches the dish you named (B1). Otherwise 0013 MI1 is unchanged.

```
                                  Let's do green curry tonight ⟩
⟨ You've made Green curry before. The one from 15 Oct, or a new one?
  [Allergy] Contains shrimp: Ben's seafood allergy.
  ( The one from 15 Oct )  ( A new one )
```

- **Two quick replies, past first:** "The one from 15 Oct" / "A new one". Tapping sends it as your message (ux.md §4). If the past one clashes with today's allergies, the reply shows the plum flag line above the buttons (0019).
- **Two or more matches** ("the curry"): **"Which one?"** with one quick reply per past dish, newest first, at most 3: "Green curry · 15 Oct", "Red lentil curry · 2 Oct", then "A new one".
- **States:** waiting (buttons enabled); **answered** (buttons stay readable, disabled, the chosen one marked "Chosen"); **ignored** (you type something else: the offer goes disabled with the next message, nothing is chosen); **failed** after tapping: "Couldn't make that again, so nothing changed. Try again." with the buttons re-enabled.
- **Past one chosen** = Make again (§4), including receipt, Undo and the recipe opening. **A new one** = today's MI1 flow (a new recipe).
- Anything you said you have in the same message is still added to the kitchen first, with its own receipt line (0013 MI1).

## 6. 0038 checks

1. **Boring → layout:** month headings break the list into a calendar rhythm; the desktop row spreads meta to the right instead of stacking.
2. **No focal point → contrast:** on the recipe, **Make again** is the only filled clay button; on the list, titles are the strongest text and the plum badge is the only colour.
3. **Doesn't stand out → scale:** recipe title at 22 px; Make again full-width on phone; rows at 56 px with 18 px titles.
4. **Plain → details:** the "2×" chip, "by Ben", "From the one you cooked on 15 Oct", the "Uses coconut milk" search hint. All within existing tokens; no new colours.

## 7. Keyboard and screen reader (Frontend owns, 0002)

- Arriving on the list: focus the heading (or the search field when opened from the search icon), as Kitchen See all. Back returns focus to the opener.
- Each row is one link, accessible name in full: "Green curry. Made 2 times, last 15 October, by Ben. Allergy: contains shrimp, Ben's seafood allergy." Month headings are `h3`.
- Search: labelled input, `type="search"`; count spoken via the one polite live region after a pause; never per keystroke.
- "Cooked before updated · Show" is a button; announced once, politely.
- Make again: accessible name "Make Green curry again"; busy state announced ("Making…"). After success focus goes to the new recipe's heading. "Make it without shrimp" names the ingredient in text.
- Quick replies are buttons; disabled ones stay in the reading order.
- Reduced motion: no transitions on navigation or the update cue. 200% zoom: the desktop row wraps to the phone layout.

## 8. Strings (en, translation-ready, 0015)

Dates use locale formatting (`{date}` = day + short month, plus year if not this year). Namespaces follow `en.json`.

| Key | English |
|---|---|
| `meals.plan.cookedLink` | `Cooked before ({count})` |
| `meals.plan.cookedSearchLabel` | `Search what you've cooked` |
| `meals.cooked.pageTitle` | `Cooked before · Kitchen` |
| `meals.cooked.heading` | `Cooked before` |
| `meals.cooked.summary` | `{count, plural, one {# meal} other {# meals}}, newest first` |
| `meals.cooked.back` | `Back` |
| `meals.cooked.searchLabel` / `searchPlaceholder` | `Search by name or ingredient` |
| `meals.cooked.clear` | `Clear search` |
| `meals.cooked.searching` | `Searching…` |
| `meals.cooked.matches` | `{count, plural, one {# match} other {# matches}}` |
| `meals.cooked.noMatches` | `No meals match “{query}”` |
| `meals.cooked.noMatchesHint` | `Try one ingredient, like “coconut”.` |
| `meals.cooked.usesMatch` | `Uses {ingredient}` |
| `meals.cooked.times` | `{count}×` |
| `meals.cooked.timesLabel` | `Made {count} times` |
| `meals.cooked.today` / `yesterday` | `Today` / `Yesterday` |
| `meals.cooked.last` | `Last {date}` |
| `meals.cooked.byYou` / `byName` / `bySomeone` | `You` / `{name}` / `Someone` |
| `meals.cooked.rowLabel` | `{title}. {times, plural, =1 {Cooked} other {Made # times, last}} {date}, by {cook}.{allergy}` |
| `meals.cooked.showMore` | `Show more` |
| `meals.cooked.updated` | `Cooked before updated` |
| `meals.cooked.show` | `Show` |
| `meals.cooked.loading` | `Loading what you've cooked…` |
| `meals.cooked.empty` | `Nothing here yet. Meals you finish with Done cooking show up here, so you can make them again.` |
| `meals.cooked.error` | `Couldn't load what you've cooked.` |
| `meals.cooked.retry` | `Retry` |
| `meals.cooked.searchError` | `Couldn't search just now.` |
| `meals.cooked.tryAgain` | `Try again` |
| `meals.cooked.stale` | `Offline · showing what you've cooked as of {time}` |
| `meals.cooked.searchOffline` | `Search needs a connection.` |
| `meals.recipe.cooked` | `Cooked` |
| `meals.recipe.madeTimes` | `Made {count}× · last {date} by {cook}` |
| `meals.recipe.cookedOnce` | `Cooked {date} by {cook}` (`{cook}` = "you" or a name) |
| `meals.recipe.makeAgain` | `Make again` |
| `meals.recipe.makeAgainLabel` | `Make {title} again` |
| `meals.recipe.making` | `Making…` |
| `meals.recipe.makeWithout` | `Make it without {ingredients}` (ICU list, "shrimp and peanuts") |
| `meals.recipe.makeAgainFailed` | `Couldn't make that again, so nothing changed. Try again.` |
| `meals.recipe.fromPast` | `From the one you cooked on {date}` |
| `meals.recipe.backToCooked` | `Back to Cooked before` |
| `chat.receipt.madeAgain` | `Chose {title} again (from {date})` |
| `chat.receipt.madeAgainUndoLabel` | `Undo: chose {title} again` |
| `chat.message.makeWithout` | `Make it without {ingredients}` |
| `chat.offer.pastOrNew` | `You've made {title} before. The one from {date}, or a new one?` |
| `chat.offer.past` | `The one from {date}` |
| `chat.offer.new` | `A new one` |
| `chat.offer.whichOne` | `Which one?` |
| `chat.offer.pastOption` | `{title} · {date}` |
| `chat.offer.chosen` | `Chosen` |

## 9. Questions for Vero (via the orchestrator)

- **RBX-1 · Make again when a copy is already planned or cooking.** You tap Make again on Green curry, but last night's Make again copy is still in your plan. **Rec:** don't create a duplicate; the button becomes **"Open in your plan"** and goes to that meal. (Alternative: always make a new copy.)
- **RBX-2 · Asking for a change while reading a Done recipe** ("no oven"). Done meals can't change (A2). **Rec:** Kitchen replies "That one's already cooked. Make it again with no oven?" with quick replies **Make again** / **Not now**; Make again then applies the change to the new copy.
- **RBX-3 · Show the after-cooking note** ("Anything to remember about what you used?", M8) on the read-only recipe, e.g. "Ben's note: used half the coconut milk". It's already saved and would help next time. **Rec:** yes, one muted line under the header; leave out if Vero sees it as scope creep.
