# Visual direction: Kitchen OS layout, bright look (light only)

**Status:** Accepted direction ([0048](../decisions/0048-bright-look.md), Vero, 2026-10-15) · tokens ported 2026-10-15 · UI/UX specialist
**Supersedes:** the cream visual system of [0042](../decisions/0042-kitchen-os-ui.md) (the Kitchen OS layout from 0042 stays), and the dark theme of KOS14 ([0045](../decisions/0045-kitchen-os-features.md)). Earlier directions (Clay & Honey, cream) are in git history only.
**Source of truth for values:** [`src/app/globals.css`](../../src/app/globals.css). This doc explains them; if the two disagree, the CSS wins and this doc gets fixed.

---

## 1. The direction

- **Layout and navigation: Kitchen OS, unchanged** (0042). Five places in a bottom dock (Today, Kitchen, Plan, Meals, List), a header with household avatars, the chat (reply, chips, message box) above the dock, and a "What changed" card with Undo. Flows stay in [`ux.md`](../architecture/ux.md).
- **Visual system: the bright prototype** (0048). A warm white page; plain white cards and rows that float on soft plum-tinted shadows, with **no outlines and no stitching**; plum ink text; **coral → orange gradient pill** buttons; a **soft tint per place** (fridge sky, freezer lavender, pantry lemon); food shown as an **emoji on a soft tile**; and **Lumi**, the line-drawn cat. Fredoka headings over Nunito body text.
- **Light only.** No dark theme and no `data-theme` switch. Every colour still goes through one set of semantic names, so a dark theme can be added later by giving the same names new values.
- **Light means light everywhere.** No big dark surfaces: the prototype's ink "you" bubble, ink receipt bar and ink selected segment were all made light (§4). Only small marks (the new-reply dot, a destructive button's fill) may be dark. `tests/e2e/places.spec.ts` sweeps every place for dark panels.

### Credit and the public-repo caveat
The look comes from Vero's private **recipe-cat** repo, `explorations/kitchen-os/prototype-bright.html`: its `:root` colours and shadows, its `.card`, `.tile`, `.btn`, `.dock`, `.chip`, `.hero` and `.receipt` rules, and the `cat()` SVG that is now Lumi. Text colours were darkened where the prototype's fail AA (§6). recipe-cat has **no licence file**, so this is Vero's own work, all rights reserved. **This repo is public (0037). Before anything on `ui/kitchen-os` is pushed, Vero confirms the ported tokens and the cat drawing may be published (0042).** The cream illustrations (`public/art/lumi`, `food`, `icons`) were deleted in this milestone, since nothing used them any more (0046). Fredoka and Nunito are SIL Open Font License and self-hosted by `next/font`.

---

## 2. Calm, in the bright look

Calm (0022) still holds, as narrowed by 0046 and 0048:

1. **Colour means something.** Warm white and plum ink everywhere; the coral gradient for the one main action; lemon for "New / Updated"; mint for done and "saved"; deep sky for focus; **berry only for allergies**.
2. **Status is information, not alarm.** Counts are plain text, never red bubbles.
3. **Room to breathe.** 16 px body, 44 px or larger tap targets (the prototype's 36–40 px controls grow), one obvious action per card.
4. **Nothing moves unless you did something.** Short, soft motion. **No looping animation** (0046): the prototype's blink loop, tail wag and rocking tilt are dropped. The pop overshoot is only for Lumi and celebrations. Reduced motion turns every movement off.
5. **Always reversible, never scolding.** Undo is always beside the change. Voice per 0020.
6. **Words carry meaning, not colour alone** (0002). Tints, emoji and Lumi are decoration. The chosen segment is bolder and ringed as well as coloured.
7. **Short caps labels are fine** (0046): 13 px, e.g. "LUMI", "WHAT CHANGED".

**Still avoided:** alarm-red badges and counting dots, warning triangles, expiry countdowns, toasts that vanish, "Oops!", endless spinners, skeleton shimmer loops.

---

## 3. Design philosophy (Vero, 0038)
1. **If it looks boring, adjust the layout.**
2. **No focal point? Use contrast.** Today's hero is the one gradient card on the page; everything else is white.
3. **If it doesn't stand out, exaggerate the scale.** `text.display` and Lumi in her large halo (`spacing.lumi-lg`).
4. **If it feels plain, add more details.** Emoji tiles, place tints, Lumi's halo, the hero's soft circle.

Fixes stay inside the bright tokens.

---

## 4. Tokens

Rules: semantic names only (0017, 0031). Tailwind's default palette, type, radii, shadows and spacing are reset, so only these exist. Utility names are the token names: `color.text.muted` → `--color-text-muted` → `text-text-muted`. Names were kept from cream where the role is the same, so components kept working; `tests/ui/design-tokens.test.ts` checks contrast, that no dark theme exists, that every fill is light, and that the meta colours match.

### Colour

| Token | Role | Value | Prototype source |
|---|---|---|---|
| `surface.default` | Page and stage | `#FFFBF8` | `--bg` |
| `surface.raised` | Cards, rows, chat bubbles, dock, sheets | `#FFFFFF` | `--card` |
| `surface.sunken` | Message box, tags, segmented controls | `#F7F1F6` | new (plum-tinted) |
| `surface.soft` | Quiet coral fill: your own bubble, step numbers | `#FFEDE9` | `--coral-soft` |
| `text.default` | Ink | `#33263A` | `--ink` |
| `text.muted` | Secondary text | `#6F6278` | `--ink-2` |
| `text.faint` | **Disabled only** (fails 4.5:1 on purpose) | `#A99EB2` | `--ink-3` |
| `text.on-accent` / `text.inverse` | Text on the coral gradient: **ink** (see §6) | `#33263A` | replaces `--coral-ink` white |
| `text.on-error` | Text on a destructive button | `#FFFFFF` | |
| `text.on-fill` *(new)* | The white tick on a ticked checkbox | `#FFFFFF` | |
| `border.default` | Decorative dividers and dashed ghosts | `#F1EBF1` | `--line` |
| `border.strong` | Input and checkbox edges (≥ 3:1) | `#8E8098` | darker than the prototype's `#DCD2E0`, which fails |
| `border.accent` *(new)* | Chip edge (decorative) | `#FFD5CE` | `.chip` border |
| `accent.default` → `accent.end` *(new)* | The primary gradient, Send, chat button | `#FF7A6B` → `#FFB36B` | `--coral` → `--coral-2` |
| `accent.strong` | Hover on the gradient | `#F2665A` | |
| `accent.text` | Coral as text: links, Undo, eyebrows, chips, active dock place | `#B23A2A` | `--coral` fails as text |
| `accent.soft` | Active dock place, soft pills | `#FFEDE9` | `--coral-soft` |
| `focus-ring` | Keyboard focus | `#1F6FD1` | `--sky` darkened (`#3D9BFF` is 2.86:1) |
| `highlight.bg` / `.text` | "New" / "Updated", recipe edits | `#FFF4D0` / `#8A5A00` | `--lemon-soft` / darkened `--lemon` |
| `success.bg` / `.text` | Done; **the "What changed" card** | `#DCF7EE` / `#0D6E52` | `--mint-soft` / darkened `--mint` |
| `success.fill` *(new)* | A ticked checkbox | `#17A07A` | darkened `--mint` |
| `warning.bg` / `.text` | "Can't undo this now", Low | `#FFF4D0` / `#8A5A00` | lemon |
| `error.bg` / `.text` | Errors | `#FFE4E6` / `#B42030` | `--red-soft` / darkened `--red` |
| `info.bg` / `.text` | Neutral notes | `#E3F0FF` / `#1F63B8` | sky |
| `allergy.bg` / `.text` / `.border` | **Reserved: allergy flags only** (KOS15) | `#FBE6F6` / `#8E1A6B` / `#B8338F` | new: berry |
| `selected.bg` / `.border` | Chosen segment, chosen card | `#FFEDE9` / `#B23A2A` | |
| `place.fridge` / `.freezer` / `.pantry` | Place and food tiles | `#E3F0FF` / `#EFEAFF` / `#FFF4D0` | `--sky-soft` / `--lav-soft` / `--lemon-soft` |
| `hero.start` → `hero.end` *(new)* | Today's hero card, Lumi's halo | `#FFE3EC` → `#FFF0DA` | `.cat-wrap` gradient |
| `scrim` | Behind sheets | ink at 35% | |

**Allergy colour (KOS15).** Lavender is now the freezer's tint, so the old plum allergy colour would read as "freezer". Allergy moved to **berry** (hue about 320°): between error red (about 355°) and freezer lavender (about 255°), and used for nothing else. Its badge also keeps a 2 px berry border and the word "Allergy".

**Cat colours** are plain CSS variables (`--cat-line #4A3542`, `--cat-fur #FFF`, `--cat-ear #FFC3D3`, `--cat-blush #FFB3C7`, `--cat-brow #FFB36B`), for Lumi only, never UI.

**Gradients** (CSS variables): `--gradient-accent` (coral → orange), `--gradient-accent-strong` (hover), `--gradient-hero` (pink → peach).

**Not ported from the prototype:** the body's coloured radial blobs (they sit outside its phone frame), the hero's pink → orange gradient with white text (fails AA; replaced by the soft hero gradient with ink text), the ink "you" bubble, the ink receipt bar, the ink selected segment, the 36–40 px controls, and the shimmer skeleton (a loop).

### Type
Fredoka (headings, `font-heading`; `h1`–`h3` get it by default) and Nunito (body). Unchanged from cream.

| Token | Size / line | Used for |
|---|---|---|
| `text.caption` | 13 / 18 px | Eyebrows, "New", meta lines |
| `text.small` | 14 / 20 px | Reasons, receipt lines, chips |
| `text.body` | 16 / 22 px | Chat, item names, message box |
| `text.title` | 20 / 24 px | Card titles, meal names |
| `text.heading` | 22 / 28 px | Header title |
| `text.display` | 30 / 34 px | Hero titles (Today) |
| `text.step` | 24–28 px, 1.25 | One cook step at a time |
| `font.weight.regular / medium / strong` | 500 / 600 / 800 | Body / Fredoka headings / names and buttons. Caps labels use 900, like the prototype. |

### Space, size, shape, depth
- **Space:** 4 px base, `spacing.1`–`7` = 4 · 8 · 12 · 16 · 24 · 32 · 48 px; `spacing.tap` 44 px.
- **Sizes:** `spacing.tile` 46 (food / place tile) · `spacing.lumi` 64 (empty states) · `spacing.lumi-lg` 88 (focal cards) · `spacing.avatar` 32 · `spacing.fab` 56. The cream sticker sizes are gone.
- **Radius:** `xs` 8 · `sm` 12 · `tile` 16 · `md` 20 (rows) · `lg` 24 (cards, the prototype's `--r`) · `sheet` 32 · `button` pill.
- **Shadows** (prototype): `shadow-card` = `0 1px 3px rgb(70 40 90 / .05), 0 10px 28px rgb(70 40 90 / .08)` · `shadow-pop` = `0 2px 6px … / .06, 0 24px 60px … / .14` (sheets, menus) · `shadow-soft` (segments, small buttons) · `shadow-dock` (upward, behind the chat) · `shadow-fab` (coral glow under primary buttons) · `shadow-hero`.
- **No outlines.** Cards, rows, the dock, sheets, menus and avatars have no borders. Inputs and checkboxes keep a `border.strong` edge, because a field needs a visible boundary (1.4.11).
- **Focus:** 3 px `focus-ring` with a 2 px gap, on everything.

### Components in `globals.css`
| Class | Look |
|---|---|
| `.card` | White, `radius.lg`, `shadow-card`. |
| `.hero` | Today's focal card: `--gradient-hero`, a soft white circle top-right, `shadow-hero`. |
| `.row-card` | White row, `radius.md`, `shadow-card`. |
| `.btn` | White pill, `shadow-card`, 44 px. `.btn-primary`: coral gradient, ink text, coral glow. `.btn-small`, `.btn-quiet`, `.btn-icon`, `.btn-danger`. |
| `.chip` | White pill, `accent.text`, 1.5 px `border.accent`, 44 px. |
| `.seg-group` / `.seg-option` | Sunken pill; the chosen option is `selected.bg` with `accent.text`, 900 weight and a 2 px inset `selected.border` ring. |
| `.place-tile` | 46 px soft tile, `radius.tile`, tinted by `data-place`; holds a place icon or (FoodTile) an emoji. |
| `.bubble-lumi` / `.bubble-you` | Lumi: white with the soft shadow. You: `surface.soft` with ink text. |
| `.receipt` | "What changed": `success.bg` card, ink text, mint ticks, coral Undo pill, soft shadow. |
| `.check-box` | 30 px round, `border.strong`; ticked = `success.fill` with a white tick. |
| `.lumi-halo` | Lumi's round `--gradient-hero` halo (44 / 64 / 88 px). |
| `.sheet` | White sheet on `shadow-pop`. |

---

## 5. Motion
| Token | Value | Use |
|---|---|---|
| `motion.duration.quick` | 150 ms | Press (buttons scale to 0.97), hover |
| `motion.duration.gentle` | 300 ms | Sheets, a place's content rising in, Lumi's one tilt |
| `motion.duration.slow` | 560 ms | Highlight fade-in, Lumi's hop |
| `--motion-distance` | 10 px | How far content rises on enter |
| `ease-gentle` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Default |
| `ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | Leaving |
| `ease-pop` | `cubic-bezier(0.3, 1.6, 0.5, 1)` | The prototype's hop: **Lumi and celebrations only** |

**Reduced motion:** all durations become 0 ms, `--motion-distance` becomes 0, `ease-pop` loses its overshoot and Lumi's head never animates.

---

## 6. Contrast (WCAG 2.2 AA)
Text needs 4.5:1; control edges, focus and meaningful marks need 3:1. Computed with the WCAG relative-luminance formula and enforced by `tests/ui/design-tokens.test.ts`. **Every pair passes.**

### The primary button fix
White on coral `#FF7A6B` is **2.55:1** and fails AA (even the 3:1 large-text rule; our buttons are 16 px). Two fixes were possible:
- **Darker coral stops with white text.** White needs every stop at about `#D0403C` or darker (`#C83A3A` gives 5.09:1), which turns the bright coral into brick red and loses the prototype's look.
- **Ink text on the prototype's own gradient (chosen).** Ink `#33263A` is **5.58:1** on the coral end, **8.05:1** on the orange end and **4.61:1** on the hover coral. The colours stay exactly the prototype's.

The same ink text is used on Send, the chat button and the Undo pill. This is easy to reverse: it's one token, `text.on-accent`.

### Results
| Pair | Min | Ratio |
|---|---|---|
| `text.default` on `surface.default` / `raised` / `sunken` / `soft` | 4.5 | 13.80 / 14.20 / 12.76 / 12.54 |
| `text.muted` on `surface.default` / `raised` / `sunken` / `soft` / `success.bg` | 4.5 | 5.52 / 5.68 / 5.11 / 5.02 / 5.03 |
| `text.muted` on `hero.start` | 4.5 | 4.72 |
| `accent.text` on `surface.default` / `raised` / `sunken` / `soft` / `success.bg` | 4.5 | 5.78 / 5.95 / 5.34 / 5.25 / 5.26 |
| `text.on-accent` (ink) on `accent.default` / `accent.end` / `accent.strong` | 4.5 | 5.58 / 8.05 / 4.61 |
| `text.on-error` on `error.text` (destructive button) | 4.5 | 6.58 |
| `highlight.text` / `warning.text` on their bg | 4.5 | 5.39 |
| `success.text` on `success.bg` | 4.5 | 5.52 |
| `error.text` on `error.bg` / `surface.raised` | 4.5 | 5.48 / 6.58 |
| `info.text` on `info.bg` | 4.5 | 5.14 |
| `allergy.text` on `allergy.bg` / `surface.raised` | 4.5 | 7.07 / 8.37 |
| `text.default` on `place.fridge` / `freezer` / `pantry` / `allergy.bg` | 4.5 | 12.29 / 12.09 / 12.92 / 12.00 |
| `text.default` on `hero.start` / `hero.end` | 4.5 | 11.80 / 12.66 |
| `accent.text` on `selected.bg` (chosen segment) | 4.5 | 5.25 |
| `border.strong` on `surface.raised` / `sunken` | 3 | 3.69 / 3.32 |
| `focus-ring` on `surface.default` / `raised` / `sunken` / `success.bg` | 3 | 4.80 / 4.94 / 4.44 / 4.37 |
| `selected.border` on `selected.bg` | 3 | 5.25 |
| `allergy.border` on `allergy.bg` / `surface.raised` | 3 | 4.54 / 5.37 |
| `success.fill` on `surface.raised`; white tick on `success.fill` | 3 | 3.31 / 3.31 |

**Watch-outs for Frontend:**
- **Coral as a fill is only 2.25–2.55:1 against white or mint.** That's fine for a labelled button (its ink text names it), but never use `accent.default` for text or a meaningful mark; use `accent.text`.
- **`text.faint`** (2.55:1) is for disabled text only. Placeholders use `text.muted`.
- **White cards on the warm white page have no outline**, only the shadow. Nothing may depend on seeing a card's edge.

---

## 7. Lumi
Lumi is the assistant (KOS10): the voice in chat and the mascot. [`src/ui/lumi/Lumi.tsx`](../../src/ui/lumi/Lumi.tsx) draws the prototype's line-drawn cat with the `--cat-*` colours, in four states:
- `idle`: eyes open, still. No blink.
- `think`: eyes glance up and the head tilts once, then holds while she writes.
- `happy`: smiling eyes and one hop (`ease-pop`), e.g. when a reply lands or the list is all bought.
- `sleep`: closed eyes, for quiet empty states.

`LumiHalo` puts her in a round soft halo: 44 px beside replies, 64 px in empty states, 88 px on focal cards (Today, sign-in, loading). She is decorative by default; pass a translated `title` when she is the only thing saying something. She never waves for attention, bounces on a timer or shows a count. The cream illustrations and `LUMI_ART` are gone.

## 8. Emoji food tiles
[`src/ui/primitives/FoodTile.tsx`](../../src/ui/primitives/FoodTile.tsx) shows a food's emoji on a 46 px soft tile tinted by where it's kept (`data-place`: fridge sky, freezer lavender, pantry lemon, unknown coral-soft).
- **Decorative:** the tile is `aria-hidden`, and the emoji is drawn by CSS (`content: attr(data-emoji)`), so a row's text stays the food's name.
- **Where:** Kitchen item rows and Today's "Use it up". Shopping and recipe rows keep their checkboxes instead (as in the prototype).
- **Which emoji:** for now every food shows the same neutral 🍽️. The real emoji comes from the food catalog (KOS2) when it lands; no per-food mapping is invented before then.
