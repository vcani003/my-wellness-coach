# Next epics and release plan

**Status:** Proposed · 2026-10-14 · Orchestrator. Questions live in [OPEN-QUESTIONS](../OPEN-QUESTIONS.md) (IA1, DL1, DL2, P3, SM1).

## How we'll work from here (lessons from today)
- **Scoped releases, not deploy-every-turn** (SM1, pending your confirmation). Each release is a named bundle with a short "what's in it" note to you. It goes out at most about once a day, after the local-copy tester scripts, the browser tests and a **real-AI smoke check** pass. Urgent fixes can go alone, and you're told straight away.
- **Each agent works in its own copy of the code** (a git *worktree*, on its own *branch*: a private copy of the project). Today, agents sharing one folder caused accidental cross-commits. The orchestrator merges finished branches into the next release.
- **One owner per area per release**, so parallel agents don't edit the same files.

---

## Epic A: Item actions (your ask, small, next release)
Today the Kitchen list is view-only, and every change goes through chat (decision K1). You want direct controls on each item.
- A **⋯ menu** on each item row (Kitchen widget and See all), opened by tap, right-click on desktop, or long-press on phone. It holds:
  - **Used up / Out**
  - **Running low**
  - **Move to…** (Fridge / Freezer / Pantry / Counter*)
  - **Change type…**
  - **Edit name / amount**
  - **Remove (added by mistake)**
- Every action shows "What changed" with **Undo**, like chat. Removing asks once ("Remove fish sauce? It'll stay in history.").
- An **✕** on its own is easy to tap by accident on a phone. **Rec:** use ⋯ plus swipe-left-to-remove on phone (with Undo). See **IA1**.
- *Counter is a new place; see IA1.*
- **Agents:** UX (a short spec), Backend (the ops already exist; small additions for name and amount edits), Frontend (the menu, sheets, tests). About half a day of agent time.

## Epic B: Desktop layout and design system (your ask, large, iterative)
On desktop the chat takes a third and the widgets sit in one narrow column, so most of the screen is empty.

**Phase B1, explore (now, docs only):** UX produces **3 desktop layout options** as clickable mockups using our current Clay & Honey tokens (see DL1). The three starting ideas are below. Frontend writes a short memo on **component library vs. our own** (DL2).
1. **Dashboard grid:** chat on the left. The workspace becomes a 2–3 column grid of widgets (Kitchen | Shopping list | Meal plan + Ideas), so everything is visible at once.
2. **Three-pane app:** a slim left nav (Kitchen, List, Meals, Settings), a large main area for the chosen view (for example the full kitchen with filters), and chat as a right-hand panel you can collapse.
3. **Focus + context:** one large "focus" widget in the middle (whatever you're doing now), a column of compact widgets on the right, and chat as a drawer or overlay.

**Phase B2, decide:** you pick a layout (or a mix) and the component approach.
**Phase B3, design system:** we formalise the tokens (colour, type, spacing, radius, motion, elevation) as a single source file, add a **component gallery page** (every button, card, sheet and list row in one place, in light mode and dark-mode-ready), and document usage.
**Phase B4, build:** we implement the desktop layout in slices (one release per slice), keeping the phone layout unchanged.

**On the component library question (DL2):** we already use **Base UI**, a library of *unstyled, accessible* building blocks (menus, sheets, dialogs, checkboxes), with **our own tokens and styling** on top. So we effectively have a custom design system on proven accessibility foundations. **My rec:** keep that, and formalise it in B3. Adopting a styled library (shadcn/ui, MUI, Mantine, Chakra) would mean fighting its look to keep Clay & Honey, and redoing accessibility work that's already done. Figma: there's no Figma connection in this session. If you want Figma, we can set up the tokens there (via Tokens Studio) in B3. Otherwise the mockups are interactive HTML pages you open in a browser.

## Epic C: Release process and safety (small, infra, alongside A)
- A real-AI smoke check before each release (SM1; needs your staging key in a local file).
- A release script: merge the chosen branches → run all checks plus the tester agents → write "what's in this release" → deploy on your OK, or within the 0028 rules.
- Make sure every test runs with a sensible number of workers (today's false alarms came from an overloaded machine).

## Candidate features after A–C (please rank: P3)
| # | Feature | Size | Why |
|---|---|---|---|
| 1 | **Smart staples:** remember your usual staples; "running low / out" offers to add them to the list; a "Restock" button builds a list | S–M | Makes the grocery trip faster, building on today's test |
| 2 | **Recipe box:** save recipes you liked or pasted, and reuse them | M | Your own recipes were the original wish (R1) |
| 3 | **Weekly plan with days:** "Tuesday dinner" | M | Planning for the week |
| 4 | **"Use soon" nudges:** typical shelf life from USDA FoodKeeper data, only ever phrased as "use soon" | M | Less food waste; deferred from MVP 1 |
| 5 | **Budget heads-up at 80%** (N1 b) | S | No surprise "budget used up" |
| 6 | **Offline queued messages** (FE2 b): type with no signal, sent later | M | Stores with bad signal |
| 7 | **Voice input:** speak a message (hands busy cooking) | S | Kitchen use |
| 8 | **Gentle reminders** (phone notifications, for example "chicken defrosted yesterday") | M | Use-it-up in practice; needs notification permission |

---

## How multiple agents would run it (example for the next release)
| Agent | Works on | Copy of the code |
|---|---|---|
| UX | Epic A spec, then Epic B1 layout mockups | its own worktree (docs only) |
| Frontend 1 | Epic A item menu | its own worktree and branch |
| Frontend 2 | Epic B1 component memo, then a gallery spike | its own worktree and branch |
| Backend | Epic A small ops, Epic C release script | its own worktree and branch |
| AI | Smoke check (C), then feature #1 staples logic | its own worktree and branch |
| Tester | Runs on each candidate release | the local copy |

The orchestrator merges, runs the release checks, and sends you the "what's in this release" note.
