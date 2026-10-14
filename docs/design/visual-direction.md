# Visual direction: calm

**Status:** Proposed, for Vero to choose (V1) · 2026-10-14 · UI/UX specialist
**See it:** open [`preview.html`](preview.html) in a browser and switch between the three directions.

Decision 0022 makes calm the starting mood. This doc says what calm means in Kitchen, offers three ways to look calm, and recommends one. **Vero chooses.** Whichever she picks becomes the token file Frontend implements (0017, frontend §4).

---

## 1. What calm means here

Kitchen is used standing at the counter, mid-task, often tired. Calm means the screen never raises your pulse and never makes you hunt.

1. **Quiet by default, clear when it matters.** Most of the screen is soft neutrals. Colour only appears when it *means* something, so when it does appear you notice it.
2. **Status is information, not alarm.** "Low" is a fact about the yogurt, not a warning. Counts are plain text ("To review (1)"), never red bubbles.
3. **Room to breathe.** Generous spacing, readable 16 px text, one obvious action per card, short lists grouped under plain headings.
4. **Nothing moves unless you did something.** Motion is short and soft, with no bounce, shake, pulse or looping animation. With reduced motion turned on, changes just appear.
5. **Always reversible, never scolding.** Undo is always visible beside the change. The voice is warm, brief and practical (0020): no lecturing, no guilt, no exclamation marks.
6. **Words carry meaning, not colour alone** (0002). Every highlight, flag and state has text; colour and icons only reinforce it.

**What we avoid:** alarm-red badges and counting dots · warning triangles · dense lists and tiny grey text · ALL-CAPS headings · nagging ("Don't forget!", streaks, expiry countdowns, "you haven't logged…") · toasts that vanish before you've read them · modal pop-ups for things that can wait · "Oops!" or "Something went wrong" · spinners that spin forever with no words.

### Calm in the moments that matter

| Moment | How it looks | Never |
|---|---|---|
| **"What changed" receipt** (0007, 0011) | A raised card under the reply. A small tick in the success colour, one plain line per change, and **Undo** beside it. It stays put; it's part of the conversation. | A green flash, a toast that disappears, confetti |
| **Undo** | A quiet text button in the accent colour, always in the same place. Once used, the lines are struck through with "Undone" in muted text. If it can't undo: "Can't undo this now. Tell me what to fix." | A red "Reverted!" banner or a confirmation dialog |
| **"New" / "Updated"** | A soft butter-coloured wash on the row plus a small "New" or "Updated" label. It fades in once and stays until your next message (ux §1). | Blinking, pulsing, or colour with no label |
| **Allergy flag** (0019) | The **one reserved colour** in each direction: a soft plum panel with a firm plum bar on the left, a shield icon, the word **Allergy**, whose allergy it is and their own note. It sits right above Choose and can't be dismissed. Plum is never used for anything else, so it becomes a signal you learn. | Red, warning triangles, "Danger", "Safe", or any medical advice |
| **To review** (0013) | One quiet line at the top of Kitchen: "To review (1)" with what it is and a chevron. | A badge, a dot on the app icon, a pop-up |
| **Errors** (0018) | Shown in place, in a plain sentence, with a way forward: "I couldn't save that, so nothing changed. [Try again]". Muted brick text on a pale tint, inside the widget or bubble it belongs to. Everything else keeps working. | A full-screen error, a modal, an error code, blame |
| **Offline / stale** | A neutral line: "Offline · showing your kitchen as of 6:42 pm". | A warning colour; it's not your fault and not urgent |

---

## 2. What's the same in all three

- **Token names are semantic** (named for their role, not their look), so dark mode later is just a second set of values under `[data-theme="dark"]` with no component changes (0017). In CSS, dots become hyphens: `color.text.muted` → `--color-text-muted`. (Frontend's example name `color.danger` is `color.error.*` here.)
- **Type sizes** (one scale for all, chosen for reading at arm's length; 16 px also stops iPhone zooming into the message box):

| Token | Size / line height | Used for |
|---|---|---|
| `font.size.caption` | 13 / 18 px | "New" labels, "added 3 days ago", group headings |
| `font.size.small` | 15 / 22 px | Receipt lines, card details, the allergy note |
| `font.size.body` | 16 / 24 px | Chat, item names, the message box |
| `font.size.title` | 18 / 24 px | Widget titles, meal names |
| `font.size.heading` | 22 / 28 px | Screen titles (Recipe, See all) |

- **Spacing:** a 4 px base. `space.1`–`space.7` = 4 · 8 · 12 · 16 · 24 · 32 · 48 px. Rows have 12 px vertical padding, cards 16 px inside, widgets 24 px apart. Tap targets are 44 px (frontend §6).
- **Focus:** a 2 px ring in `color.focus-ring`, with a 2 px gap in the surface colour, so it shows on every background including filled buttons.
- **Reduced motion:** all `motion.duration.*` tokens become 0 ms. Highlights appear at full strength at once, nothing slides, and the typing dots become the static words "Kitchen is writing…".
- **Fonts** are all free for commercial use under the SIL Open Font License, from Google Fonts. In the app, Next.js downloads them at build time and serves them itself (`next/font`), so no request goes to Google from Vero's phone. **Icons:** [Lucide](https://lucide.dev) (ISC licence) for A and B, [Phosphor](https://phosphoricons.com) (MIT) for C; both are free for commercial use.

---

## 3. The three directions

### A. Linen & Sage
*"A slow morning: linen light, a pot of herbs on the sill."*

Warm off-white paper, soft sage green and a gentle serif for headings. It feels homely and grown-up, like a good cookbook. Butter-yellow "New" washes read as fresh. The plum allergy flag and brick error sit far from sage, so they stay unmistakable.

- **Type:** **Fraunces** (a soft, warm serif) for widget titles and meal names only, at 18 px and up, weight 560. **Figtree** (a friendly, very legible sans) for everything else, 400 / 500 / 600.
- **Shape:** medium-soft corners. Cards have a whisper of warm shadow plus a hairline border.
- **Motion:** unhurried, a plain gentle ease.
- **Icons:** Lucide, 1.5 px stroke, rounded ends.
- **Microcopy:** "Got it. Eggs are in, and the chicken's in the freezer." · "Undone. The chicken's back in the fridge." · "I couldn't save that, so nothing changed. Try again?" · "Your kitchen is empty. Tell me what you've got."

### B. Still Water
*"Cool and clear, like a glass of water on a quiet table."*

Misty blue-grey surfaces, a deep teal accent, flat cards with hairline borders and almost no shadow. The calm of a tidy, airy room. It's the most minimal and the easiest to read: Atkinson Hyperlegible was designed by the Braille Institute for low-vision readers. It can feel a little cool for a kitchen.

- **Type:** **Atkinson Hyperlegible** for everything, 400 and 700. One family, so it's the lightest to load.
- **Shape:** the crispest corners. Depth comes from borders, not shadows.
- **Motion:** the quickest of the three, still soft, with a smooth slow-down at the end.
- **Icons:** Lucide, 1.75 px stroke.
- **Microcopy:** "Done. Eggs added; chicken thighs → freezer." · "Undone." · "Couldn't save that. Nothing changed. [Try again]" · "1 thing to review."

### C. Clay & Honey
*"Cosy and rounded: an afternoon with tea in a hand-thrown mug."*

Cream surfaces, a terracotta-clay accent, big round corners, soft diffused shadows and a rounded typeface. The warmest and most playful. The trade-offs: the clay accent sits closer to the brick error colour (words still tell them apart), and the larger corners and padding fit slightly less on a phone screen.

- **Type:** **Nunito** (rounded ends) for everything, 400 / 600 / 700.
- **Shape:** the roundest corners; pill-shaped buttons.
- **Motion:** the slowest of the three, with a soft settle.
- **Icons:** Phosphor Regular, 2 px stroke, rounded.
- **Microcopy:** "All set: eggs are in, and the chicken's tucked in the freezer." · "No problem, that's undone." · "That didn't save, so nothing's changed. Want to try again?" · "Welcome back. One thing's waiting in To review."

**In every direction** the allergy flag reads, word for word: "**Allergy** · Contains shrimp: [Husband]'s seafood allergy. Medicine on hand?" with their own note under it (0019). No direction changes that wording.

---

## 4. Tokens

### Colour (light theme)

| Token | Role | A. Linen & Sage | B. Still Water | C. Clay & Honey |
|---|---|---|---|---|
| `color.surface.default` | Page and workspace | `#F7F4EE` | `#F2F5F6` | `#FAF4EC` |
| `color.surface.raised` | Cards, chat dock, sheets | `#FFFDF9` | `#FFFFFF` | `#FFFBF6` |
| `color.surface.sunken` | Message box, tags, group headers | `#EEE9E0` | `#E6ECEE` | `#F1E8DC` |
| `color.text.default` | Main text | `#2E2A25` | `#1E2A30` | `#33281F` |
| `color.text.muted` | Secondary text ("added 3 days ago") | `#625B51` | `#52626A` | `#685A4D` |
| `color.text.inverse` | Text on the accent | `#FFFDF9` | `#FFFFFF` | `#FFFBF6` |
| `color.border.default` | Decorative dividers and card edges | `#E3DCD0` | `#D9E1E4` | `#E8DCCC` |
| `color.border.strong` | Edges of inputs and checkboxes | `#8A8274` | `#7C8A91` | `#94826F` |
| `color.accent.default` | Primary buttons, chat button | `#4D6A54` | `#37677A` | `#9A4E2F` |
| `color.accent.text` | Links, Undo, See all | `#43604A` | `#305E70` | `#8E4729` |
| `color.accent.soft` | Your own chat bubble | `#E4ECE3` | `#DDEAEE` | `#F6E3D8` |
| `color.focus-ring` | Keyboard focus | `#3B6E8C` | `#2E5FA8` | `#2F6A6A` |
| `color.highlight.bg` | "New" / "Updated" wash, new-reply dot | `#FBF0D2` | `#FAF2D3` | `#FAEFC9` |
| `color.highlight.text` | "New" / "Updated" label | `#6A4D10` | `#644C12` | `#654A0E` |
| `color.success.bg` | Success tint | `#E5EFE4` | `#E1F0E7` | `#E6EFE0` |
| `color.success.text` | Receipt tick, "Saved" | `#2F6640` | `#286445` | `#3A6135` |
| `color.allergy.bg` | Allergy panel (reserved) | `#F5EBF3` | `#F4EAF2` | `#F3E9F2` |
| `color.allergy.text` | Allergy text (reserved) | `#5E2B58` | `#5F2A59` | `#5A2A57` |
| `color.allergy.border` | Allergy bar and icon (reserved) | `#8C4C84` | `#8E4986` | `#87487F` |
| `color.warning.bg` | "Can't undo this now" and similar | `#F8EED9` | `#F9EFD8` | `#F8EDD6` |
| `color.warning.text` | Warning text | `#6E4D12` | `#6C4C10` | `#6B4A0F` |
| `color.error.bg` | Error tint | `#F9E9E6` | `#FBE8E6` | `#F9E6E3` |
| `color.error.text` | Error text | `#9A3329` | `#9C2F2A` | `#9B2D2A` |
| `color.selected.bg` | Chosen card, selected option | `#E4ECE3` | `#DDEAEE` | `#F6E3D8` |
| `color.selected.border` | Edge of the selected item | `#4D6A54` | `#37677A` | `#9A4E2F` |

### Type, shape, depth and motion

| Token | A. Linen & Sage | B. Still Water | C. Clay & Honey |
|---|---|---|---|
| `font.family.heading` | Fraunces, Georgia, serif | Atkinson Hyperlegible, system-ui, sans-serif | Nunito, system-ui, sans-serif |
| `font.family.body` | Figtree, system-ui, sans-serif | Atkinson Hyperlegible, system-ui, sans-serif | Nunito, system-ui, sans-serif |
| `font.weight.regular / medium / strong` | 400 / 500 / 600 | 400 / 400 / 700 | 400 / 600 / 700 |
| `radius.sm / md / lg` | 8 / 12 / 20 px | 6 / 10 / 16 px | 12 / 18 / 26 px |
| `radius.button` | 12 px | 10 px | 999 px (pill) |
| `elevation.card` | `0 1px 2px rgb(46 42 37 / .06)` + border | none (border only) | `0 2px 10px rgb(51 40 31 / .07)` |
| `elevation.dock` (dock, sheets) | `0 -4px 16px rgb(46 42 37 / .08)` | `0 -1px 0 #D9E1E4, 0 -2px 10px rgb(30 42 48 / .05)` | `0 -6px 24px rgb(51 40 31 / .10)` |
| `motion.duration.quick` (press, hover) | 120 ms | 100 ms | 140 ms |
| `motion.duration.gentle` (dock, sheets, accordion) | 280 ms | 240 ms | 320 ms |
| `motion.duration.slow` (highlight fade-in, reorder) | 480 ms | 400 ms | 560 ms |
| `motion.easing.gentle` | `cubic-bezier(0.25, 0.1, 0.25, 1)` | `cubic-bezier(0.2, 0, 0, 1)` | `cubic-bezier(0.33, 1, 0.68, 1)` |
| `icon.stroke` | 1.5 px | 1.75 px | 2 px |

None of the easings overshoot or bounce.

---

## 5. Contrast (WCAG 2.2 AA)

Computed with the WCAG relative-luminance formula. Text needs **4.5:1**; focus rings, control edges and meaningful non-text marks need **3:1**. **Every pair passes in all three directions; no compromises were needed.** `color.border.default` is decorative (card edges and dividers), which WCAG exempts, so it's never the only edge of a control; `color.border.strong` is used for those. Where a row lists several ratios they follow the order in the "Pair" column.

#### Contrast, direction A: Linen & Sage

| Pair | Needs | Ratio | |
|---|---|---|---|
| Body text on surface / raised / sunken | 4.5:1 | 13.0 / 14.0 / 11.8 | Pass |
| Muted text on surface / raised / sunken | 4.5:1 | 6.1 / 6.6 / 5.5 | Pass |
| Inverse text on accent (primary button, chat button) | 4.5:1 | 5.9 | Pass |
| Accent text (links, Undo, See all) on surface / raised | 4.5:1 | 6.4 / 6.9 | Pass |
| Body text on accent soft (your bubble) / selected | 4.5:1 | 11.8 / 11.8 | Pass |
| Body / label / muted text on the New–Updated wash | 4.5:1 | 12.5 / 6.9 / 5.9 | Pass |
| Success text on success tint / on raised | 4.5:1 | 5.7 / 6.7 | Pass |
| Allergy text on allergy tint | 4.5:1 | 9.2 | Pass |
| Warning text on warning tint | 4.5:1 | 6.7 | Pass |
| Error text on error tint / on raised | 4.5:1 | 6.2 / 7.2 | Pass |
| Focus ring vs surface / raised / sunken | 3:1 | 5.0 / 5.4 / 4.6 | Pass |
| Control border (inputs, checkboxes) vs surface / raised | 3:1 | 3.5 / 3.7 | Pass |
| Primary button and chat button vs surface | 3:1 | 5.5 | Pass |
| New-reply dot vs chat button | 3:1 | 5.3 | Pass |
| Allergy bar and icon vs raised / vs allergy tint | 3:1 | 5.9 / 5.2 | Pass |
| Selected border vs surface / raised | 3:1 | 5.5 / 5.9 | Pass |

#### Contrast, direction B: Still Water

| Pair | Needs | Ratio | |
|---|---|---|---|
| Body text on surface / raised / sunken | 4.5:1 | 13.4 / 14.7 / 12.3 | Pass |
| Muted text on surface / raised / sunken | 4.5:1 | 5.8 / 6.3 / 5.3 | Pass |
| Inverse text on accent (primary button, chat button) | 4.5:1 | 6.2 | Pass |
| Accent text (links, Undo, See all) on surface / raised | 4.5:1 | 6.5 / 7.1 | Pass |
| Body text on accent soft (your bubble) / selected | 4.5:1 | 12.0 / 12.0 | Pass |
| Body / label / muted text on the New–Updated wash | 4.5:1 | 13.1 / 7.2 / 5.6 | Pass |
| Success text on success tint / on raised | 4.5:1 | 5.9 / 7.0 | Pass |
| Allergy text on allergy tint | 4.5:1 | 9.1 | Pass |
| Warning text on warning tint | 4.5:1 | 6.9 | Pass |
| Error text on error tint / on raised | 4.5:1 | 6.2 / 7.4 | Pass |
| Focus ring vs surface / raised / sunken | 3:1 | 5.8 / 6.3 / 5.3 | Pass |
| Control border (inputs, checkboxes) vs surface / raised | 3:1 | 3.25 / 3.6 | Pass |
| Primary button and chat button vs surface | 3:1 | 5.7 | Pass |
| New-reply dot vs chat button | 3:1 | 5.5 | Pass |
| Allergy bar and icon vs raised / vs allergy tint | 3:1 | 6.1 / 5.2 | Pass |
| Selected border vs surface / raised | 3:1 | 5.7 / 6.2 | Pass |

#### Contrast, direction C: Clay & Honey

| Pair | Needs | Ratio | |
|---|---|---|---|
| Body text on surface / raised / sunken | 4.5:1 | 13.1 / 13.9 / 11.8 | Pass |
| Muted text on surface / raised / sunken | 4.5:1 | 6.1 / 6.5 / 5.5 | Pass |
| Inverse text on accent (primary button, chat button) | 4.5:1 | 5.8 | Pass |
| Accent text (links, Undo, See all) on surface / raised | 4.5:1 | 6.2 / 6.6 | Pass |
| Body text on accent soft (your bubble) / selected | 4.5:1 | 11.5 / 11.5 | Pass |
| Body / label / muted text on the New–Updated wash | 4.5:1 | 12.5 / 7.2 / 5.8 | Pass |
| Success text on success tint / on raised | 4.5:1 | 6.0 / 6.9 | Pass |
| Allergy text on allergy tint | 4.5:1 | 9.3 | Pass |
| Warning text on warning tint | 4.5:1 | 6.9 | Pass |
| Error text on error tint / on raised | 4.5:1 | 6.2 / 7.3 | Pass |
| Focus ring vs surface / raised / sunken | 3:1 | 5.7 / 6.0 / 5.1 | Pass |
| Control border (inputs, checkboxes) vs surface / raised | 3:1 | 3.4 / 3.6 | Pass |
| Primary button and chat button vs surface | 3:1 | 5.5 | Pass |
| New-reply dot vs chat button | 3:1 | 5.2 | Pass |
| Allergy bar and icon vs raised / vs allergy tint | 3:1 | 6.2 / 5.4 | Pass |
| Selected border vs surface / raised | 3:1 | 5.5 / 5.8 | Pass |

The tightest margins are the control borders (3.25–3.7:1). They pass, but Frontend shouldn't lighten them.

---

## 6. Recommendation: A. Linen & Sage

It's the calmest of the three **for a kitchen**:
- **Warm without being sleepy.** B is restful but a little clinical, and C is cosy but busier with its big round shapes and shadows.
- **Signals stay unmistakable.** Sage sits far from both the plum allergy colour and the brick error colour, so neither can be mistaken for an ordinary button. That matters most for the allergy flag.
- **Readable where it counts.** The serif appears only in titles and meal names, which gives a cookbook warmth, while lists, chat and receipts use Figtree, which is very legible.

**The cost:** two font families instead of one (a little more to download the first time), and Fraunces mustn't be used below 18 px. If Vero prefers the cleanest, most legible look, **B** is the strong second. The directions share the same token names, so mixing them is easy (for example A's colours with C's rounder corners).

**For Vero to decide (V1):** which direction: A, B or C, or a mix?
