# Item actions (Epic A): UX spec

**Status:** Proposed · 2026-10-15 · UI/UX specialist. Implements [0030](../decisions/0030-item-actions.md) (IA1); doesn't change it. Builds on ux.md §3 (Kitchen, See all), the chat receipt (`src/ui/chat/Receipt.tsx`) and [visual-direction.md](visual-direction.md) (calm; Clay & Honey tokens).
**For:** Backend (ops, validation, conflicts) and Frontend (menu, sheets, swipe, tests). Strings in §8 go into `en.json` as-is.

> **Note (2026-10-16, Backend, KOS3):** brought over from the parked Epic A branch because [0036](../decisions/0036-item-action-details.md) points here. It predates the Kitchen OS layout ([0042](../decisions/0042-kitchen-os-ui.md)) and [0045](../decisions/0045-kitchen-os-features.md) KOS3 ("tap an item to edit it"), so the ⋯ menu, Clay & Honey look and the "offline: disabled" state (now [0044](../decisions/0044-offline-for-buttons.md)) are for UX to re-cut. The backend calls are in [backend-data.md §6](../architecture/backend-data.md) ("Tap an item to edit it"); Out / Low use the KOS4 level control.

## 1. The ⋯ button and menu

```
 FRIDGE
 ┌──────────────────────────────────────────────┐
 │ Fish sauce                                 ⋯ │  ← 44×44 button, right edge, every row
 │ 1 bottle · added 3 days ago · Running low    │
 └──────────────────────────────────────────────┘
                              ┌──────────────────────┐
                              │ Used up / Out        │
                              │ Running low          │  (or "Plenty left" if already low)
                              │ Move to…             │
                              │ Change type…         │
                              │ Edit name / amount   │
                              │ ──────────────────── │
                              │ Remove (added by…)   │  ← last, after a divider, error text colour
                              └──────────────────────┘
```

- **Where:** every item row in the Kitchen widget and in See all (both By place and By type, and search results). Not on To review rows or inside the batch list; those keep what they have.
- **Opening:** tap / click the **⋯** button; **right-click** anywhere on the row (desktop, opens at the pointer); **long-press** on the row (touch, 500 ms, a light haptic where supported). One menu for all three. Uses the existing Base UI `Menu` primitive, anchored to ⋯ (or the pointer). No nested submenus: "Move to…" and "Change type…" open a sheet (§2).
- **Multi-batch rows:** the row itself stays the batch disclosure (0025); ⋯ is a separate button beside it, so tapping the row still expands batches. Menu actions apply to the **whole item** (all open batches). The batch list keeps its note, reworded (§8).
- **Keyboard:** ⋯ is a `button` with `aria-haspopup="menu"` and the label "Actions for fish sauce". Enter / Space / ↓ open it with focus on the first item; ↑↓, Home / End, type-ahead; Esc closes and returns focus to ⋯. Shift+F10 or the Menu key on a focused ⋯ also opens it. Long-press and right-click are shortcuts only; ⋯ is always the accessible path (WCAG 2.5.1, 2.5.7).
- **Hidden while:** loading, or when the row is saving (⋯ shows as disabled with "Saving…" under the name).

## 2. Each action

All go through the same validate → apply path as chat, are recorded in history with who did it, and end in the "What changed" card (§4). No optimistic update: the row changes when the save returns ("Saving…" appears only if it takes over 300 ms).

| Action | Flow | Result |
|---|---|---|
| **Used up / Out** | One tap, no confirm (Undo covers it). | The item drops off the list (0011). Card: "Fish sauce: out". |
| **Running low** | One tap. If already low the item reads **Plenty left** and clears it. | Row shows "Running low" (or not). |
| **Move to…** | Sheet "Move fish sauce to…", radio list: Fridge · Freezer · Pantry · **Counter** · Not sure where. Current place is selected and labelled "now". **Move** / **Cancel**. Move is disabled until a different place is picked. | Row moves to that group with "Updated". Moving into / out of Freezer uses the same op as saying "froze it" / "took it out of the freezer" in chat (Backend owns what that sets). |
| **Change type…** | Sheet "What kind of thing is fish sauce?", radio list of the 12 types in their fixed order, current one selected ("now"). **Save** / **Cancel**. | Saved as `said`; By type view moves it. |
| **Edit name / amount** | Sheet (below). | Row updates with "Updated". |
| **Remove (added by mistake)** | One confirm dialog, the only one (0030). | Item disappears. Card: "Fish sauce: removed". |

**Counter** is a new group, ordered Fridge · Freezer · Pantry · Counter · Not sure where (group label "Counter", location word "counter").

**Edit sheet**

```
 ┌ Edit fish sauce ───────────────────────┐
 │ Name                                   │
 │ [ Fish sauce                        ]  │
 │ Amount (optional)                      │
 │ [ 1 bottle                          ]  │
 │ Leave it empty if you're not sure.     │
 │                     [Cancel]  [Save]   │
 └────────────────────────────────────────┘
```
- Prefilled with the current name and the amount **as said**. Amount is free text, the way people say it ("half a bag", "about 6"); Backend parses it like chat does and keeps `asSaid`.
- **Empty amount is allowed** and saves the amount as unknown (no made-up default). The row then shows no amount.
- **Name:** trimmed, required, at most 60 characters. Errors appear under the field on Save, not while typing, linked with `aria-describedby`; focus moves to the field. Amount: at most 40 characters.
- Renaming to the name of another item is allowed; nothing merges (out of scope).
- Save is disabled when nothing changed. Enter in a field submits.
- Phone: bottom sheet; desktop: centred dialog (existing `Dialog`). Focus starts in Name; Esc / Cancel closes and returns focus to ⋯.

**Remove confirm**

```
 ┌───────────────────────────────────────┐
 │ Remove fish sauce?                    │
 │ It'll stay in history.                │
 │                  [Cancel]  [Remove]   │
 └───────────────────────────────────────┘
```
Focus starts on **Cancel** (the safe choice). Remove uses the muted error colour, not alarm red.

## 3. Phone: swipe left to remove

Touch devices only (`pointer: coarse`); never on desktop.

```
 │ Fish sauce                   │ 🗑 Remove │   ← revealed 88 px button
```
- A horizontal drag starts after 12 px of movement within 30° of horizontal; otherwise the page scrolls as normal.
- Release past **72 px** (or a quick flick): the row settles open showing a **Remove** button (88 px wide, full row height, `color.error.*` tint, icon + word). Release earlier: it slides back.
- **Tapping Remove opens the same one confirm as §2.** There is no full-swipe-to-delete, so a slip of the thumb can never remove anything.
- Only one row open at a time. Scrolling, tapping elsewhere or swiping right closes it.
- Reduced motion: no slide; the row snaps open or closed.
- Screen readers and keyboards never need the swipe: Remove is always in ⋯. The revealed button is hidden from the accessibility tree while closed.
- Offline: swipe is disabled (the row doesn't move).

## 4. "What changed" + Undo outside chat

Widget actions don't add anything to the chat (chats are private and per person, 0017). The receipt appears **where you acted**:

```
 ▾ KITCHEN · 12 items                         See all
 ┌ ✓ What changed ──────────────────────────────────┐
 │ Fish sauce: out                           Undo   │
 └──────────────────────────────────────────────────┘
 FRIDGE
 ...
```
- **Kitchen widget:** a receipt card at the top of the widget body (below To review). **See all:** the same card stuck under the page header so it's visible while scrolled.
- Same look and behaviour as the chat receipt: tick, one plain line, **Undo** named for the change ("Undo: fish sauce out"). After Undo the line is struck through with "Undone". If Undo is refused: "Can't undo this now. Tell me what to fix."
- It **stays put** (no timer). It's replaced by your next item action in that view, and cleared by your next chat message or by **Dismiss** (×, labelled "Dismiss").
- Focus moves to its Undo after the action (the row may have gone). A polite live region announces the line, e.g. "Done. Fish sauce: out."
- The other person sees the change through the existing shared cues ("Updated", the name tag, "Since your last visit").

## 5. States

| State | What happens |
|---|---|
| **Empty kitchen** | No rows, so no menu. The existing empty line stays. |
| **Saving** | Row shows "Saving…" in muted text; its ⋯ and swipe are disabled. Other rows still work. |
| **Save failed** | The receipt slot shows, in place: "I couldn't save that, so nothing changed." + **Try again**. The row is unchanged. Sheets stay open on failure so typed text isn't lost; the message shows inside the sheet. |
| **Offline** | The menu still opens, with every action disabled and one line at the top: "You're offline. Changes need a connection." Sheets can't open. (Queuing changes offline is a later feature, FE2 b.) |
| **Someone else changed it first** | Backend rejects a stale change. "Levi just changed fish sauce, so nothing changed. Here's the latest." The row refreshes; open sheets close. |
| **Someone else removed it / it's out** | "Fish sauce isn't in the kitchen any more." The row disappears. |
| **Undo after someone else's change** | Existing rule: "Can't undo this now. Tell me what to fix." |
| **Widget crashed** | Unchanged (0018): the widget's own fallback; chat keeps working. |

## 6. Shared kitchen

Actions are as shared as chat changes: who did it is recorded, and the other person sees "Updated" plus your name tag. Undo appears only for the person who did it (0017).

## 7. Tester script additions

1. Menu on a Fridge row → Running low → row shows "Running low"; Undo clears it.
2. Move to… → Counter → a Counter group appears with the item.
3. Edit name / amount → clear the amount → Save → no amount shown. Empty name → error under the field.
4. Phone: swipe left on a row → Remove → confirm → gone; Undo brings it back.
5. Keyboard only: Tab to ⋯, open, Used up / Out, focus lands on Undo, Enter undoes.
6. Household: tester A changes an item while B's Edit sheet is open; B's Save shows the "just changed" line.

## 8. Copy (`en.json`, new `kitchen.actions` namespace)

```json
"actions": {
  "button": "Actions for {name}",
  "out": "Used up / Out",
  "low": "Running low",
  "notLow": "Plenty left",
  "move": "Move to…",
  "changeType": "Change type…",
  "edit": "Edit name / amount",
  "remove": "Remove (added by mistake)",
  "saving": "Saving…",
  "now": "now",
  "cancel": "Cancel",
  "save": "Save",
  "moveTitle": "Move {name} to…",
  "moveConfirm": "Move",
  "typeTitle": "What kind of thing is {name}?",
  "editTitle": "Edit {name}",
  "nameLabel": "Name",
  "amountLabel": "Amount (optional)",
  "amountHint": "Leave it empty if you're not sure.",
  "nameRequired": "Give it a name.",
  "nameTooLong": "That name's a bit long. Keep it under {max} characters.",
  "amountTooLong": "Keep the amount under {max} characters.",
  "removeTitle": "Remove {name}?",
  "removeBody": "It'll stay in history.",
  "removeConfirm": "Remove",
  "swipeRemove": "Remove",
  "dismiss": "Dismiss",
  "failed": "I couldn't save that, so nothing changed.",
  "tryAgain": "Try again",
  "offline": "You're offline. Changes need a connection.",
  "conflict": "{who} just changed {name}, so nothing changed. Here's the latest.",
  "gone": "{name} isn't in the kitchen any more.",
  "announce": "Done. {changes}"
}
```
Also: `kitchen.groups.counter` = "Counter", `location.counter` = "counter", and `kitchen.batches.viewOnly` becomes "To change one batch, tell me in chat." Receipt lines and Undo labels reuse the existing `receipt.*` and `msg.*` strings (add `msg` entries for "removed", "renamed", "type changed", "amount changed" if Backend adds new result codes).
