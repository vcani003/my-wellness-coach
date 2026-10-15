# UX architecture: Kitchen-Aware Assistant MVP 1

**Status:** Proposed, pending Vero's review · 2026-10-13 · UI/UX specialist · §10 Shopping list added 2026-10-14 (0027)

What the user sees and does; no technology. Where an outstanding question matters, the design follows its Rec, cites the ID and notes the alternative. "Kitchen" is the assistant's name (0020); Levi is Vero's husband; all wording is placeholder copy.

> **Bright look (2026-10-15, 0048).** The look is the Kitchen OS layout (0042) in the bright prototype style, **light only**: warm white, white cards on soft shadows, plum ink, coral → orange pill buttons with ink text, a soft tint per place, emoji food tiles and the line-drawn Lumi. See [`docs/design/visual-direction.md`](../design/visual-direction.md) for the tokens, contrast results, the button fix, Lumi and the emoji tiles. Layout and behaviour below are unchanged by the reskin.
>
> **Kitchen OS update (2026-10-15, 0042 / 0045).** The tokens are adapted from Vero's private recipe-cat repo; this repo is public (0037), so Vero confirms they may be published before any push. **The assistant is now Lumi, a cat (she/her, KOS10)**; "Kitchen" stays the name of the Kitchen place. The flows below still describe the current widget workspace and dock; they get rewritten for the five-place dock (Today, Kitchen, Plan, Meals, List) with Phase 3. Until then, where this doc says "Kitchen" replies, read Lumi.

---

## 1. Layout

You talk in the chat and watch things change in the workspace. The composer is always on screen (except Sign-in and Settings).

**Phone (designed first).** The workspace fills the screen; the chat is **docked at the bottom**, about a third of the height, like the bottom panel in maps apps. Three states (UX3, 0017):
- **Peek** (default): the latest reply, its receipt and the composer.
- **Full:** the whole conversation (Show chat, or drag the handle).
- **Minimized:** the dock hides and the workspace gets the full screen. A round **chat button** floats bottom-right, with a dot when Kitchen has replied since you minimized; tapping it returns to Peek. It isn't draggable (**UX4** Rec).

With the keyboard open, the workspace shrinks but stays visible.

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
PHONE · Minimized: the workspace fills the screen; the round chat button
sits bottom-right above the safe area, with ● when there's a new reply.

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
| **Appear** | When a message first gives it content: Kitchen on the first kitchen change, Meal ideas on "what can I make", Recipe on choosing a meal, Meal plan on the first add or start, Shopping list on its first item (§10). |
| **Update** | In place, only after the save succeeds. |
| **Reorder** | Only right after a message: the focused widget moves to the top. Nothing moves while you scroll, tick, or use a sheet. |
| **Collapse** | **Phone:** only the focused widget is expanded; others are one-line bars ("Meal plan · 2 · 1 cooking") that expand on tap (accordion). **Desktop:** all expanded, each collapsible. |
| **Leave** | Kitchen, Meal plan and Shopping list stay once they have content. Meal ideas aren't saved (0013): closable (×), replaced by the next request, gone next session. Recipe closes with Back or ×. |

**Focus after a message** (visual only; keyboard focus stays in the composer): a kitchen change focuses Kitchen; asking for ideas focuses Meal ideas; choosing a meal opens the Recipe; planning, starting, finishing or cancelling focuses Meal plan; adding to, moving on or removing from the list focuses Shopping list. If several change, the widget with the **most** changes is focused (ties go to the first in the receipt) and the others get an "Updated" dot. Questions and chit-chat change nothing.

**On a phone,** Recipe and "See all" open as full pages with Back. The dock stays, so you can say "no oven" while reading.

---

## 3. Widgets

**All widgets:** **Loading** placeholders only on first appearance. **Error** (0018) stays inside that widget ("Couldn't load · Retry"); chat and the other widgets keep working. Missing data shows a fallback ("Unknown item", "Someone", "Not sure where"), never a blank. **Stale/offline:** "Offline · showing your kitchen as of 6:42 pm".

### Kitchen
- **To review** (0013): at the top with a count, one row per postponed sheet ("3 items to add · Spinach omelette", "Update your kitchen · Spinach omelette"). Tapping reopens the sheet.
- **Items,** grouped **Fridge / Freezer / Pantry / Not sure where**. A row shows the name, plus, when known: the amount as said, "added 3 days ago", Frozen/Opened, "Running low", and a "Levi" tag for their recent changes. The compact widget shows about 8 items, most recently changed first, then **See all (23)**.
- **See all (K1, 0017):** a full page on phone, the whole workspace on desktop. Grouped by location, with "Added by Levi · 2 days ago" on each item. View-only except To review; changes happen in chat.
- **Empty:** "Your kitchen is empty. Tell me what you've got."

### Shopping list
See §10.

### Meal ideas
- A header echoing the request ("Ideas for tonight"), then about three cards (0009): name, short why, **Uses**, **Missing**.
- **Allergy flag (0019):** unprompted ideas leave allergen dishes out (AI6 Rec). A dish you asked for still appears, with a flag in text and icon above Choose: "Contains shrimp: Levi's seafood allergy. Their note: can eat shellfish if medicine is on hand". Never "safe", never advice.
- **Choose**, or name it in chat (0013): the card shows "Chosen" and the Recipe opens.
- **Loading:** "Finding ideas from your kitchen…". **Empty:** not used; if nothing fits, the assistant says so in chat. **Stale:** "Your kitchen changed since these ideas · [Refresh]".

### Recipe view
- **Header:** name; **AI-written** or **Your recipe** label; status ("In your plan", "Cooking"); a **Use my own recipe** link (R2) that puts the cursor in the composer with "Paste or type your recipe".
- **Allergy flag (0019):** the same flag under the header, and on each flagged ingredient in the checklist.
- **Assumed basics (0010, 0019):** "Assumes salt, pepper and cooking oil. Tell me if you don't have them."
- **Checklist (0013):** groups **In your kitchen** and **Need**, a checkbox each. Ticking doesn't change the kitchen. Ticks are shared, and show who ticked ("ticked by Levi", 0013). Then numbered steps.
- **Actions, by state:** **Add to plan**, **Start cooking**, **Add ticked items** (when "Need" items are ticked), **Done cooking**, and **Cancel meal** (⋯ menu, with Undo).
- **Loading:** title at once, then "Writing your recipe…".
- *If R2 is "ask":* on your first chosen meal, the Recipe asks "Suggest one" or "Use my own" and remembers.

### Meal plan (planned and cooking meals, 0013)
- A short undated list (0008): **Cooking** meals first, then planned ones in order added; "Added by Levi" where relevant.
- **Actions:** tap to open the Recipe; **Start cooking** / **Done cooking**; **Cancel** in ⋯ (kitchen unchanged, receipt with Undo).
- **Empty:** "Nothing planned yet" (only in the session it was emptied).

---

## 4. Chat

| Message type | Behavior |
|---|---|
| **Messages** | Familiar bubbles and a typing indicator. Replies are short; widgets carry the detail. |
| **"What changed" receipt** (0007, 0011) | A card under the reply, one line per change: "Added eggs, spinach", "Chicken thighs → freezer", "Recorded feta (wasn't in your kitchen)", "Added Spinach omelette to your plan", "Saved allergy: peanuts". One **Undo** for the card, plus **View** on phone. After Undo, lines are struck through, "Undone". If a later change blocks it: "Can't undo this now. Tell me what to fix." |
| **"Which one?"** (0013) | **Quick-reply buttons**, one per option plus "Something else"; tapping sends it as your message. For "add that" with nothing chosen, or ambiguous items ("the fridge chicken or the frozen one?"). |
| **Assumed basics** (0010) | Muted note, no answer needed, once per recipe: "I'm assuming salt, oil and pepper. Tell me if you're out." |
| **Allergy flag** (0019) | When a reply involves a flagged dish, it points to the flag and the person's own note. No medical advice. |
| **"Want me to remember that?"** (0012) | Quick replies **Remember** / **Just this time**; ignoring means no. Remember gives a receipt with Undo. Explicit allergies are saved without asking. |
| **Welcome back** | Once, only if something waits: "3 things are waiting in To review." |
| **Error** | "I couldn't save that, so nothing changed. [Try again]". Unsent messages show "Not sent". |

**Composer:** "Tell me what changed…" (shortened to fit one line on phones) and Send (Enter on desktop). Keyboard dictation works; no extra mic button.

---

## 5. Sheets

These are bottom sheets on phone and centred dialogs on desktop.

```
┌──────────────────────────────┐   ┌──────────────────────────────┐
│ Add to your kitchen?         │   │ Update your kitchen          │
│ From Spinach omelette        │   │ Cooked: Spinach omelette     │
│            [Unselect all]    │   │ Eggs    (Still have some)    │
│ ☑ Feta                       │   │          Running low   Out   │
│ ☑ Lemon                      │   │ Spinach  Still have some     │
│ ☐ Chives                     │   │          Running low  (Out)  │
│                              │   │ Anything to remember? [    ] │
│ [        Add 2 items       ] │   │ [           Done           ] │
│ [ Do later ]       [ Skip ]  │   │ [ Do later ]       [ Skip ]  │
└──────────────────────────────┘   └──────────────────────────────┘
```

| | Add to your kitchen? | Update your kitchen (after cooking; wording per **M8**) |
|---|---|---|
| **Opens on** | Start cooking with "Need" items ticked, or Add ticked items | Done cooking, or "I made it" in chat. The meal is done either way. |
| **Pre-selected** | The ticked items | Nothing: each in-kitchen ingredient starts at **Still have some** (M8 Rec); tap **Running low** or **Out** |
| **Primary** | **Add N items** → receipt with Undo | **Done** → low/out saved, the optional note saved with this cooking session, receipt with Undo |
| **Do later** | Becomes a To review row | The step waits in To review |
| **Skip** | Nothing changes | Ingredients recorded as "used in this meal, amount unknown" (M8 Rec) |
| **Swipe down / Esc** | Same as Do later, so nothing is lost | Same as Do later |

---

## 6. Shared kitchen cues (0006)

- **Who:** items, plan rows and ticks carry a "Levi" tag for their recent changes; See all shows "Added by Levi · 2 days ago". Your own changes have no tag.
- **Since your last visit:** one dismissible line atop Kitchen: "Levi added milk and used the eggs."
- **While you're looking:** their changes appear within seconds with a soft highlight and "Levi · just now". They never reorder widgets, move focus, change the dock or interrupt a sheet.
- **Conflicts:** your receipt notes them ("Levi already marked eggs as out"); no error dialog.
- **Undo** is only on your own receipts; fix their changes in chat, recorded as yours (H3, 0017).
- **Private chats** (H2, 0017); kitchen, plan, ticks and To review are shared.

---

## 7. Other screens

**Sign-in (0006)**
1. Email field, **Email me a sign-in link**.
2. "Check your email. We sent a link and a code to v•••@gmail.com." Same message for any address, so it never reveals who's invited. A field for the emailed **6-digit code** (UX2, 0017; code-only if one email can't carry both, frontend §5), **Resend** (after 30 s), **Use a different email**.
3. Expired link: "That link has expired. [Send a new one]".

**First run**
- Empty Kitchen state plus "I save things as soon as you tell me. You can always Undo."
- Suggestion buttons "I bought…", "What can I make tonight?", "I'm allergic to…" **fill the composer** for you to finish; they don't send.
- Levi's first run (kitchen already stocked): "This kitchen is shared with Vero."

**Settings** (from the avatar in the top bar)
- **Account:** name, email, Sign out, **Sign out everywhere** (FE1 Rec: you stay signed in on a device for a rolling year). **Kitchen:** "Shared with Levi".
- **Things I remember:** allergies, each with your own note, editable ("can eat shellfish if medicine is on hand", 0019), and preferences (0012), each removable.
- **Your data (0015):** **See my data** (a readable copy of account, messages, kitchen changes, remembered things); **Delete my data** (confirmation explaining that your kitchen items stay, credited to "a former member", D1).
- **Policies:** Privacy policy, Terms.

---

## 8. Tester scripts (0005, 0021)

**Single-person test kitchen: the primary journey.** Phone-sized screen.

1. Sign in with the email link or code.
2. *Check:* empty Kitchen state, suggestions, composer in the dock.
3. Send "I bought eggs, chicken thighs, spinach and yogurt". *Check:* receipt lists all 4 with Undo; Kitchen shows all 4 labelled "New"; composer keeps focus.
4. Send "I froze the chicken". *Check:* receipt "Chicken thighs → freezer"; chicken now under **Freezer**, "Updated".
5. Send "What can I make tonight?". *Check:* placeholders, then about 3 cards with name, why, Uses, Missing; Meal ideas on top, Kitchen a bar.
6. Tap **Choose** on one card. *Check:* "Chosen"; Recipe opens with AI-written label, basics note, two-group checklist, steps; dock visible.
7. Back; send "Add that to my meal plan". *Check:* receipt names that exact meal; Meal plan on top shows it; no "Which one?".
8. Close the app fully and reopen. *Check:* still signed in; chicken in Freezer; meal in plan; chat history there; Meal ideas gone (expected, 0013).
9. *(Undo)* Undo step 4's receipt. *Check:* chicken back where it was; receipt says "Undone".
10. *(Negative, fresh test kitchen)* "Add that to my meal plan" with nothing chosen. *Check:* "Which one?" with quick replies; nothing added.

**Shopping list (§10, 0027).** Fresh single-person test kitchen, phone-sized.

11. Send Vero's first-test message exactly: *"I've made a beef pho. I need to shop for some staple pantry items and other ingredients for other dishes ill be making this week. MD Oriental Market: garlic, ginger, green onion, shallot, culantro, lemongrass, sweet potato, ginger, coconut milk / Publix: oatmilk"*. *Check:* the receipt has the pho line, both store lines and the "ginger was in twice" note; Shopping list is on top with **MD Oriental Market (8)**, ginger once, and **Publix (1)**; Kitchen is a bar with the pho in it; no Anywhere group.
12. Tick garlic and ginger. *Check:* struck through, "got" count 2, nothing moves; **Done shopping** appears.
13. Send "add hoisin". *Check:* hoisin under **Anywhere**; a quick reply offers a store. Send "move hoisin to Publix". *Check:* hoisin under Publix. Send "take oat milk off the list". *Check:* oatmilk gone; Undo brings it back.
14. On Green onion, ⋯ → **Remove**. *Check:* "Green onion removed · Undo" in its place; Undo restores it, unticked.
15. Send "What staples do I still need?", then tap **Add these to my list**. *Check:* they appear under their stores, no duplicates; the button reads "On your list".
16. Send "I'm out of fish sauce". *Check:* the receipt offers **Add fish sauce to my list**, and the list is unchanged until you tap it; after tapping, it's under Anywhere (or its usual store).
17. Tap **Done shopping**. *Check:* the sheet pre-selects garlic and ginger, other items unselected; **Add 2 items** puts both in Kitchen and takes them off the list; unticked items stay.
18. *(Offline)* Turn off the network. *Check:* "Offline · showing your list as of …"; ticks are disabled with that text; nothing crashes.

**Household test kitchen: shared smoke test** (testers A and B; B has a seafood allergy with a note).
1. A: "I bought shrimp and milk". *Check:* B sees both within about 15 s, tagged with A's name; B doesn't see A's chat.
2. A chooses a meal and adds it to the plan; B opens it from Meal plan and ticks an ingredient. *Check:* A sees "ticked by B".
3. *Check:* B has no Undo for A's change; B fixes it in chat ("the milk's in the fridge"), and it shows as B's.
4. A: "What can I make?". *Check:* no seafood ideas. A: "Shrimp tacos?". *Check:* recipe flagged with B's allergy and note; no medical advice.
5. A: "add eggs and limes to the list". B ticks limes. *Check:* within about 15 s A sees limes ticked with B's name; nothing reorders, and A's dock and any open sheet are undisturbed.

---

## 9. Screen and component inventory

| Area | Items |
|---|---|
| **Screens** | Sign-in (email, check email, expired link, code) · Main (phone: workspace + dock; desktop: split) · Recipe · Kitchen See all · Settings · Delete-data confirmation |
| **Shell** | Top bar with avatar · chat dock (Peek/Full/Minimized, handle badge) · floating chat button (new-reply dot) · offline banner |
| **Chat** | Bubbles · typing indicator · receipt card (Undo, View, Undone, can't-undo, "Add to my list" offer) · "Add these to my list" button · quick replies · muted note · error with Retry · "Not sent" · composer · suggestion buttons |
| **Workspace** | Widget frame (title, count, collapse, close, "Updated" dot, bar form) · change highlight + label · person tag · "since your last visit" line · empty/loading/error/stale blocks · fallback text |
| **Widgets** | Kitchen (To review row, location group, item row, "Running low") · Shopping list (store group, list row with tick, quantity, person tag and ⋯ Remove, inline "removed · Undo", Done shopping) · idea card · allergy flag · Recipe (labels, basics note, checklist, steps, action bar, ⋯ menu) · plan row |
| **Sheets** | Sheet/dialog frame · checkbox list with Select/Unselect all · per-ingredient three-choice row · note field · three-button footer |

---

## 10. Shopping list (0027)

On the first real test a pasted list was lost. A list is **never dropped silently**: if that part fails, the reply says so ("I saved the pho, but couldn't save your list. [Try again]", 0018). Follows the **SL1–SL3** Recs; alternatives at the end.

### The widget
- **Shared** (0027). Grouped by **store** (SL1) in order of first use, **Anywhere** last; empty groups disappear. Header: "Shopping list · 9 · 2 got".
- **A row:** a checkbox (tick = **"got it"**, not bought, 0027), the name as said, a quantity as said if given (muted), a person tag when someone else ticked it ("Levi"; your own ticks have no tag, §6), and a **⋯** button.
- **Ticked rows** are muted and struck through and **stay put** (§2); next visit they sit at the bottom of their group. Anyone can untick. **Done shopping** appears once something is ticked.
- **Appears** on its first item; **focused** by any list change (§2). **Order:** Kitchen, Shopping list, Meal plan, with Meal ideas or Recipe above when open; desktop the same, all expanded. A phone reopens with the last-focused widget on top, so the list is waiting at the store.
- **States:** *Loading:* placeholders on first appearance. *Empty:* "Your list is clear. Tell me what you need." (only in the session it was emptied). *Error:* "Couldn't load your list · Retry". A failed tick puts the box back with "Couldn't save that · Retry". *Stale/offline:* "Offline · showing your list as of 6:42 pm. Ticking is paused until you're back online." (read-only offline, 0017).
- **Visual:** existing tokens only (bright, 0048): round `color.border.strong` box, `color.success.fill` with a white tick when ticked, `color.text.muted` + strikethrough.

### Getting items on
| From | What happens |
|---|---|
| **Chat**, typed or pasted | Items go under the store named before them. Duplicates merge into one row (quantities join with "+"); items already on aren't re-added. No store → **Anywhere**, plus a quick reply "Put it under MD Oriental Market" when Kitchen can guess (SL1: kept only if tapped). |
| **Staples answer** | **Add these to my list** under the reply, keeping stores; then "On your list" (disabled). |
| **Out / Low receipt** (SL3) | **Add fish sauce to my list** in the receipt, including after "Update your kitchen" and auto-Out. Never added unless tapped; hidden if already on. |
| **Recipe "Need"** (later) | When recipes exist: **Add to shopping list** on the Need group. |

### Removing and editing
- **Chat:** "take oat milk off the list", "move hoisin to Publix", "make it 2 limes". Receipts with Undo.
- **On a row: ⋯ → Remove**, not swipe: swipe is hidden and needs a button alternative anyway (WCAG 2.5.7), and Meal plan already uses ⋯. The row becomes "Green onion removed · **Undo**" until your next message.

### Done shopping (SL2)
Opens **"Add to your kitchen?"** (§5), "From your shopping list": **Got it** items pre-selected, then **Not ticked** items unselected (in case you forgot to tick). **Add N items** adds them ("Not sure where" unless said) and takes them off the list; the rest stays, ticks included. **Do later** → To review "3 items to add · Shopping list". **Skip** changes nothing. "I'm done shopping" in chat offers the same sheet.

### Receipts and copy (0020: warm, brief, no exclamation marks)
| Case | Reply / receipt line |
|---|---|
| The first-test message | "Got it. Pho's saved, and your list is ready." · "Added beef pho" · "On your list, MD Oriental Market: garlic, ginger, green onion, shallot, culantro, lemongrass, sweet potato, coconut milk" · "On your list, Publix: oatmilk" · muted: "Ginger was in there twice, so it's on once." One Undo. |
| No store | "Hoisin → your list (Anywhere)" |
| Already on | "Garlic's already on your list." |
| Remove / move | "Took oatmilk off your list." · "Hoisin → Publix" |
| Not on the list | "Hoisin isn't on your list. Add it under Publix?" [Add it] [No thanks] |
| Staples / offer tapped | "On your list: fish sauce, rice noodles" |
| Done shopping | "Added 6 to your kitchen. 3 things are still on your list." |

### Wireframe
```
PHONE · at the store (Levi ticked garlic)   Done shopping → sheet
┌──────────────────────────────┐   ┌──────────────────────────────┐
│ Kitchen                  (V) │   │ Add to your kitchen?         │
├──────────────────────────────┤   │ From your shopping list      │
│ ▾ SHOPPING LIST · 11 · 2 got │   │              [Unselect all]  │
│   MD ORIENTAL MARKET · 8     │   │ GOT IT                       │
│   ☑ Garlic (struck)  Levi  ⋯ │   │ ☑ Garlic                     │
│   ☑ Ginger (struck)        ⋯ │   │ ☑ Ginger                     │
│   ☐ Green onion            ⋯ │   │ NOT TICKED                   │
│   ☐ Shallot                ⋯ │   │ ☐ Green onion                │
│   ☐ Culantro               ⋯ │   │ ☐ Shallot                    │
│   ☐ Lemongrass             ⋯ │   │ ☐ …                          │
│   ☐ Sweet potato           ⋯ │   │                              │
│   ☐ Coconut milk           ⋯ │   │ [       Add 2 items        ] │
│   PUBLIX · 2                 │   │ [ Do later ]       [ Skip ]  │
│   ☐ Oatmilk                ⋯ │   └──────────────────────────────┘
│   ☐ Hoisin                 ⋯ │
│   ANYWHERE · 1               │
│   ☐ Fish sauce  1 bottle   ⋯ │
│   [ Done shopping ]          │
│ ▸ KITCHEN · 5 items          │
├════════════ ═══ ═════════════┤
│ (dock: latest reply, receipt)│
│ [ Message Kitchen…     ] (➤) │
└──────────────────────────────┘
```

**For Frontend:** checkbox name "Garlic, got it, ticked by Levi"; ⋯ named "More for garlic". Levi's ticks arrive like other live changes (§6). Ticks aren't AI-interpreted, so they may show at once and revert on failure.

### If Vero answers differently
- **SL1 no stores:** one flat list, no headers or moves.
- **SL2 "straight into the kitchen":** Done shopping adds without the sheet; Undo on the receipt.
- **SL3 automatic:** the offer becomes a receipt line "Fish sauce → your list" with Undo.
- **Pending (raised with the orchestrator):** does "I bought garlic" in chat take garlic off the list? Assumed yes, matching SL2.

---

## Questions for Vero

UX1 (no "What changed" widget), UX2 (link + code) and UX3 (docked chat, plus Minimized): answered → 0017.

This design follows the Recs of the outstanding **M8** (after-cooking wording), **R2** (suggested recipe), **AI6** (allergen dishes left out of unprompted ideas), **UX4** (chat button), **D1** (a former member's items stay) and **SL1–SL3** (shopping list, §10), and notes the alternatives.

## Notes for Frontend + Accessibility

- **Keyboard focus stays in the composer after Send.** Never move focus on an incoming change, including Levi's.
- **One polite live region** announces the reply plus a receipt summary; batch Levi's live changes.
- **The chat dock must work without dragging:** a Show/Hide chat button with an expanded state, and a Minimize button (WCAG 2.5.7). Handle the on-screen keyboard and safe areas.
- **Floating chat button:** named "Open chat" ("Open chat, new reply" with the dot); focus moves to it on minimize and back to the composer on open; it never covers content or the home indicator.
- **Allergy flags and fallbacks** are text, never colour or an icon alone.
- **Accordion bars** are buttons with an expanded state, and the "Updated" dot needs text.
- **Sheets/dialogs** trap focus, treat Esc and swipe-down as Do later, return focus to the control that opened them, and keep their buttons above the keyboard.
- **Checklist rows** are real checkboxes, with the whole row as the tap target (44 px is the aim).
- **Highlights and reordering** respect reduced motion; "New"/"Updated" text means colour is never the only cue.
- **Undo's accessible name** says what it undoes ("Undo: chicken thighs moved to freezer"). Used quick replies stay readable but disabled.
- **Translation-ready (0015):** all copy in strings; relative dates and times use locale formatting.
- **No optimistic updates** for changes the AI interprets; the typing indicator covers the wait.
- **Test** the ~900 px breakpoint, a phone in landscape, and 200% text zoom.
