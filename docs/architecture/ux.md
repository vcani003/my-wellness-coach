# UX architecture: Kitchen-Aware Assistant MVP 1

**Status:** Proposed, pending Vero's review · 2026-10-13 · UI/UX specialist

What the user sees and does; no technology. Where an outstanding question matters, the design follows its Rec, cites the ID and notes the alternative. "Kitchen" is the assistant's name pending B10; "[Husband]" is a placeholder for Vero's husband's name; all wording is placeholder copy.

---

## 1. Layout

You talk in the chat and watch things change in the workspace. The composer is always on screen (except Sign-in and Settings).

**Phone (designed first).** The workspace fills the screen; the chat is **docked at the bottom**, about a third of the height, like the bottom panel in maps apps. **Peek** (default) shows the latest reply, its receipt and the composer. **Full** shows the whole conversation (Show chat, or drag the handle). With the keyboard open, the workspace shrinks but stays visible.

**Keeping track of changes on a phone:** the affected widget scrolls to the top and changed rows are highlighted, keeping a "New"/"Updated" label until your next message. If you're in Full chat, you're not pulled out: the handle says "Kitchen updated" and the receipt has a **View** link.

**Desktop (wider than about 900 px):** chat left (1/3), workspace right (2/3), side by side, as in familiar AI assistants.

```
PHONE · Peek                         PHONE · Full chat
┌──────────────────────────────┐     ┌──────────────────────────────┐
│ Kitchen                  (V) │     │ Kitchen                  (V) │
├──────────────────────────────┤     ├──────────────────────────────┤
│ ▾ KITCHEN · 4 items  See all │     │ ═══ Kitchen updated ═══      │
│   NOT SURE WHERE             │     │                  I bought ⟩  │
│   Eggs           New · today │     │   eggs, chicken thighs,      │
│   Spinach        New · today │     │   spinach and yogurt         │
│   Yogurt         New · today │     │ ⟨ Got it, added all four.    │
│   FREEZER                    │     │ ┌ What changed ────────────┐ │
│   Chicken thighs   Updated   │     │ │ Added eggs, chicken      │ │
│ ▸ MEAL PLAN · 1          •   │     │ │ thighs, spinach, yogurt  │ │
├════════════ ═══ ═════════════┤     │ │ [Undo]          [View]   │ │
│ ⟨ Done. Chicken's frozen.    │     │ └──────────────────────────┘ │
│ ┌ What changed ────────────┐ │     │                  I froze  ⟩  │
│ │ Chicken thighs → freezer │ │     │                  the chicken │
│ │ [Undo]                   │ │     │ ⟨ Done. Chicken's frozen.    │
│ └──────────────────────────┘ │     │   (receipt …)                │
│ [ Message Kitchen…     ] (➤) │     │ [ Message Kitchen…     ] (➤) │
└──────────────────────────────┘     └──────────────────────────────┘

DESKTOP
┌───────────────────────────────────────────────────────────────────┐
│ Kitchen                                                       (V) │
├─────────────────────┬─────────────────────────────────────────────┤
│ What can I make  ⟩  │ ▾ MEAL IDEAS · for tonight                  │
│ tonight?            │ ┌─────────────┐┌─────────────┐┌───────────┐ │
│ ⟨ Here are three    │ │Spinach      ││Chicken &    ││Yogurt     │ │
│   ideas.            │ │omelette     ││spinach bake ││flatbreads │ │
│                     │ │Uses spinach,││Uses chicken ││…          │ │
│                     │ │eggs         ││Missing:cream││           │ │
│                     │ │ [Choose]    ││ [Choose]    ││ [Choose]  │ │
│                     │ └─────────────┘└─────────────┘└───────────┘ │
│                     │ ▾ KITCHEN · 4 items              See all    │
│ [ Message…    ] (➤) │ ▾ MEAL PLAN · empty                          │
└─────────────────────┴─────────────────────────────────────────────┘
```

---

## 2. Adaptive widget behavior (spec §3)

| | Rule |
|---|---|
| **Appear** | When a message first gives it content: Kitchen on the first kitchen change, Meal ideas on "what can I make", Recipe on choosing a meal, Meal plan on the first add or start. |
| **Update** | In place, only after the save succeeds. |
| **Reorder** | Only right after a message: the focused widget moves to the top. Nothing moves while you scroll, tick, or use a sheet. |
| **Collapse** | **Phone:** only the focused widget is expanded; others are one-line bars ("Meal plan · 2 · 1 cooking") that expand on tap (accordion). **Desktop:** all expanded, each collapsible. |
| **Leave** | Kitchen and Meal plan stay once they have content. Meal ideas aren't saved (M5): closable (×), replaced by the next request, gone next session. Recipe closes with Back or ×. |

**Focus after a message** (visual only; keyboard focus stays in the composer): a kitchen change focuses Kitchen; asking for ideas focuses Meal ideas; choosing a meal opens the Recipe; planning, starting, finishing or cancelling focuses Meal plan. If several change, the first in the receipt is focused and the others get an "Updated" dot. Questions and chit-chat change nothing.

**On a phone,** Recipe and "See all" open as full pages with Back. The dock stays, so you can say "no oven" while reading.

---

## 3. Widgets

**All widgets:** **Loading** placeholders only on first appearance. **Error** says whether anything changed and offers Retry. **Stale/offline:** "Offline · showing your kitchen as of 6:42 pm".

### Kitchen
- **To review** (M5): at the top with a count, one row per postponed sheet ("3 items to add · Spinach omelette"). Tapping reopens the sheet.
- **Items,** grouped **Fridge / Freezer / Pantry / Not sure where**. A row shows the name, plus, when known: the amount as said, "added 3 days ago", Frozen/Opened, and a "[Husband]" tag for their recent changes. The compact widget shows about 8 items, most recently changed first, then **See all (23)**.
- **See all (K1):** a full page on phone, the whole workspace on desktop. Grouped by location, with "Added by [Husband] · 2 days ago" on each item. View-only except To review; changes happen in chat.
- **Empty:** "Your kitchen is empty. Tell me what you've got." *If K1 differs,* See all becomes a separate screen with the same content.

### Meal ideas
- A header echoing the request ("Ideas for tonight"), then about three cards (0009): name, short why, **Uses**, **Missing**.
- **Choose**, or name it in chat (0013): the card shows "Chosen" and the Recipe opens.
- **Loading:** "Finding ideas from your kitchen…". **Empty:** not used; if nothing fits, the assistant says so in chat. **Stale:** "Your kitchen changed since these ideas · [Refresh]".

### Recipe view
- **Header:** name; **AI-written** or **Your recipe** label; status ("In your plan", "Cooking"); a **Use my own recipe** link (R2) that puts the cursor in the composer with "Paste or type your recipe".
- **Assumed basics (0010):** "Assumes salt, olive oil and pepper. Tell me if you don't have them."
- **Checklist (0013):** groups **In your kitchen** and **Need**, a checkbox each. Ticking doesn't change the kitchen. Shared ticks show "ticked by [Husband]" (M6). Then numbered steps.
- **Actions, by state:** **Add to plan**, **Start cooking**, **Add ticked items** (when "Need" items are ticked), **Done cooking**, and **Cancel meal** (⋯ menu, with Undo).
- **Loading:** title at once, then "Writing your recipe…".
- *If R2 is "ask":* on your first chosen meal, the Recipe asks "Suggest one" or "Use my own" and remembers.

### Meal plan (planned and cooking meals, M5)
- A short undated list (0008): **Cooking** meals first, then planned ones in order added; "Added by [Husband]" where relevant.
- **Actions:** tap to open the Recipe; **Start cooking** / **Done cooking**; **Cancel** in ⋯ (kitchen unchanged, receipt with Undo).
- **Empty:** "Nothing planned yet" (only in the session it was emptied). *If M5 differs* (separate Cooking widget), the same rows move there.

---

## 4. Chat

| Message type | Behavior |
|---|---|
| **Messages** | Familiar bubbles and a typing indicator. Replies are short; widgets carry the detail. |
| **"What changed" receipt** (0007, 0011) | A card under the reply, one line per change: "Added eggs, spinach", "Chicken thighs → freezer", "Recorded feta (wasn't in your kitchen)", "Added Spinach omelette to your plan", "Saved allergy: peanuts". One **Undo** for the card, plus **View** on phone. After Undo, lines are struck through, "Undone". If a later change blocks it: "Can't undo this now. Tell me what to fix." |
| **"Which one?"** (0013) | **Quick-reply buttons**, one per option plus "Something else"; tapping sends it as your message. For "add that" with nothing chosen, or ambiguous items ("the fridge chicken or the frozen one?"). |
| **Assumed basics** (0010) | Muted note, no answer needed, once per recipe: "I'm assuming salt, oil and pepper. Tell me if you're out." |
| **"Want me to remember that?"** (0012) | Quick replies **Remember** / **Just this time**; ignoring means no. Remember gives a receipt with Undo. Explicit allergies are saved without asking. |
| **Welcome back** | Once, only if something waits: "3 things are waiting in To review." |
| **Error** | "I couldn't save that, so nothing changed. [Try again]". Unsent messages show "Not sent". |

**Composer:** "Tell me what changed, or ask what to make" and Send (Enter on desktop). Keyboard dictation works; no extra mic button.

---

## 5. Sheets

These are bottom sheets on phone and centred dialogs on desktop.

```
┌──────────────────────────────┐   ┌──────────────────────────────┐
│ Add to your kitchen?         │   │ What did you use up?         │
│ From Spinach omelette        │   │ Spinach omelette · done      │
│            [Unselect all]    │   │ Untick anything with some    │
│ ☑ Feta                       │   │ left.          [Unselect all]│
│ ☑ Lemon                      │   │ ☑ Eggs                       │
│ ☐ Chives                     │   │ ☑ Spinach                    │
│ [        Add 2 items       ] │   │ [         Confirm          ] │
│ [ Do later ]       [ Skip ]  │   │ [ Do later ]       [ Skip ]  │
└──────────────────────────────┘   └──────────────────────────────┘
```

| | Add to your kitchen? | What did you use up? |
|---|---|---|
| **Opens on** | Start cooking with "Need" items ticked, or Add ticked items | Done cooking, or "I made it" in chat |
| **Pre-selected** | The ticked items | All in-kitchen ingredients (M7 Rec; if the answer is no, nothing is pre-selected) |
| **Primary** | **Add N items** → receipt with Undo | **Confirm** → meal done, ticked items used up, receipt with Undo |
| **Do later** | Becomes a To review row | Meal done; the question waits in To review |
| **Skip** | Nothing changes | Meal done; kitchen unchanged |
| **Swipe down / Esc** | Same as Do later, so nothing is lost | Same as Do later |

---

## 6. Shared kitchen cues (0006)

- **Who:** items, plan rows and ticks carry a "[Husband]" tag for their recent changes; See all shows "Added by [Husband] · 2 days ago". Your own changes have no tag.
- **Since your last visit:** one dismissible line atop Kitchen: "[Husband] added milk and used the eggs."
- **While you're looking:** their changes appear within seconds with a soft highlight and "[Husband] · just now". They never reorder widgets, move focus, change the dock or interrupt a sheet.
- **Conflicts:** your receipt notes them ("[Husband] already marked eggs as used up"); no error dialog.
- **Undo** is only on your own receipts; fix their changes in chat (H3).
- **Private chats** (H2); kitchen, plan, ticks (M6) and To review are shared.
- *If H2 is "shared chats":* add a person label to each message; *if H3 is "anyone can undo":* [Husband]'s changes get an Undo in the "since your last visit" line.

---

## 7. Other screens

**Sign-in (0006)**
1. Email field, **Email me a sign-in link**.
2. "Check your email. We sent a link to v•••@gmail.com." Same message for any address, so it never reveals who's invited. **Resend** (after 30 s), **Use a different email**, and a field for the emailed code (UX2).
3. Expired link: "That link has expired. [Send a new one]".

**First run**
- Empty Kitchen state plus "I save things as soon as you tell me. You can always Undo."
- Suggestion buttons "I bought…", "What can I make tonight?", "I'm allergic to…" **fill the composer** for you to finish; they don't send.
- [Husband]'s first run (kitchen already stocked): "This kitchen is shared with Vero."

**Settings** (from the avatar in the top bar)
- **Account:** name, email, Sign out. **Kitchen:** "Shared with [Husband]".
- **Things I remember:** allergies and preferences (0012), each removable.
- **Your data (0015):** **See my data** (a readable copy of account, messages, kitchen changes, remembered things); **Delete my data** (confirmation explaining that your kitchen items stay, credited to "a former member", D1).
- **Policies:** Privacy policy, Terms.

---

## 8. Primary journey (tester script, 0005)

Phone-sized screen, tester's own kitchen.

1. Sign in with the email link or code.
2. *Check:* empty Kitchen state, suggestions, composer in the dock.
3. Send "I bought eggs, chicken thighs, spinach and yogurt". *Check:* receipt lists all 4 with Undo; Kitchen shows all 4 labelled "New"; composer keeps focus.
4. Send "I froze the chicken". *Check:* receipt "Chicken thighs → freezer"; chicken now under **Freezer**, "Updated".
5. Send "What can I make tonight?". *Check:* placeholders, then about 3 cards with name, why, Uses, Missing; Meal ideas on top, Kitchen a bar.
6. Tap **Choose** on one card. *Check:* "Chosen"; Recipe opens with AI-written label, basics note, two-group checklist, steps; dock visible.
7. Back; send "Add that to my meal plan". *Check:* receipt names that exact meal; Meal plan on top shows it; no "Which one?".
8. Close the app fully and reopen. *Check:* still signed in; chicken in Freezer; meal in plan; chat history there; Meal ideas gone (expected, M5).
9. *(Undo)* Undo step 4's receipt. *Check:* chicken back where it was; receipt says "Undone".
10. *(Negative, fresh test kitchen)* "Add that to my meal plan" with nothing chosen. *Check:* "Which one?" with quick replies; nothing added.

---

## 9. Screen and component inventory

| Area | Items |
|---|---|
| **Screens** | Sign-in (email, check email, expired link, code) · Main (phone: workspace + dock; desktop: split) · Recipe · Kitchen See all · Settings · Delete-data confirmation |
| **Shell** | Top bar with avatar · chat dock (Peek/Full, handle badge) · offline banner |
| **Chat** | Bubbles · typing indicator · receipt card (Undo, View, Undone, can't-undo) · quick replies · muted note · error with Retry · "Not sent" · composer · suggestion buttons |
| **Workspace** | Widget frame (title, count, collapse, close, "Updated" dot, bar form) · change highlight + label · person tag · "since your last visit" line · empty/loading/error/stale blocks |
| **Widgets** | Kitchen (To review row, location group, item row) · idea card · Recipe (labels, basics note, checklist, steps, action bar, ⋯ menu) · plan row |
| **Sheets** | Sheet/dialog frame · checkbox list with Select/Unselect all · three-button footer |

---

## Questions for Vero

1. **UX1 (new; left open in 0004): a separate "What changed" widget?**
   **Rec:** no. The chat receipt plus highlighted rows cover it, without a fourth widget competing for phone space.
2. **UX2 (new; refines 0006): a code in the sign-in email as well as the link?** On iPhone, a home-screen app doesn't share sign-in with Safari, so the link can sign you into Safari instead of the app.
   **Rec:** yes. The email carries both the link and a 6-digit code to type into the app. Still no passwords.
3. **UX3 (new): phone layout: chat docked under the workspace (§1), or two tabs ("Chat" / "Kitchen")?**
   **Rec:** docked, so you watch changes land while you chat. Tabs are simpler but hide the workspace while you chat, weakening spec §2.

This design follows the Recs of the outstanding M5, R2, M6, M7, K1, H2 (private chats), H3 (Undo only your own changes) and D1 (a former member's items stay), and notes the alternatives. No Rec is changed.

## Notes for Frontend + Accessibility

- **Keyboard focus stays in the composer after Send.** Never move focus on an incoming change, including [Husband]'s.
- **One polite live region** announces the reply plus a receipt summary; batch [Husband]'s live changes.
- **The chat dock must work without dragging:** a Show/Hide chat button with an expanded state (WCAG 2.5.7). Handle the on-screen keyboard and safe areas.
- **Accordion bars** are buttons with an expanded state, and the "Updated" dot needs text.
- **Sheets/dialogs** trap focus, treat Esc and swipe-down as Do later, return focus to the control that opened them, and keep their buttons above the keyboard.
- **Checklist rows** are real checkboxes, with the whole row as the tap target (44 px is the aim).
- **Highlights and reordering** respect reduced motion; "New"/"Updated" text means colour is never the only cue.
- **Undo's accessible name** says what it undoes ("Undo: chicken thighs moved to freezer"). Used quick replies stay readable but disabled.
- **Translation-ready (0015):** all copy in strings; relative dates and times use locale formatting.
- **No optimistic updates** for changes the AI interprets; the typing indicator covers the wait.
- **Test** the ~900 px breakpoint, a phone in landscape, and 200% text zoom.
