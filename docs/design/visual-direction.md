# Visual direction: Kitchen OS layout, cream style

**Status:** Accepted direction ([0042](../decisions/0042-kitchen-os-ui.md), Vero, 2026-10-15) · tokens ported 2026-10-15 (Phase 2) · UI/UX specialist
**Supersedes:** Clay & Honey ([0024](../decisions/0024-visual-direction-clay-and-honey.md)). The old three-direction study and `preview.html` are kept in git history only; `preview.html` still shows Clay & Honey and is out of date.
**Source of truth for values:** [`src/app/globals.css`](../../src/app/globals.css). This doc explains them; if the two disagree, the CSS wins and this doc gets fixed.

---

## 1. The direction

- **Layout and navigation: Kitchen OS.** A phone app with five places in a bottom dock (Today, Kitchen, Plan, Meals, List), a header with household avatars, and the chat (reply, chips, message box) above the dock, plus a "What changed" bar with Undo. The screens are Frontend's Phase 3; flows stay in [`ux.md`](../architecture/ux.md).
- **Visual system: RecipeCat cream.** Warm cream paper, brown "ink" outlines, peach accents, a dashed peach **stitch** inside cards, **washi tape** on hero cards, hand-drawn **sticker art**, and **Lumi**, the assistant's cat (she/her, KOS10, [0045](../decisions/0045-kitchen-os-features.md)): the voice in chat and a main visual element, not a corner decoration. Rounded **Fredoka** headings over **Nunito** body text. **Light and dark** ("night kitchen") themes.
- **Not taken from Kitchen OS:** its bright "kawaii" palette (coral / mint / lavender gradients, `kitchen.css`). Vero chose cream colours with the Kitchen OS layout, so every Kitchen OS colour is re-mapped to a cream token (§4, "Kitchen OS → cream").

### Credit and the public-repo caveat
The tokens, sticker art and cat art come from Vero's private **recipe-cat** repo: tokens from `design/build_tokens.py` / `src/styles/tokens.css` (with its WCAG report in `design/tokens.json`), art from `public/art/`, and the layout look from `src/kitchen/ui/kitchen.css` and `explorations/kitchen-os/prototype-bright.html`. recipe-cat has **no licence file**, so the art is Vero's own, all rights reserved. **This repo is public (0037). Before anything on `ui/kitchen-os` is pushed, Vero confirms the ported art and tokens may be published (0042).** Fredoka and Nunito are SIL Open Font License and self-hosted by `next/font`.

---

## 2. Calm, in the cream style

Calm (0022) still holds. Cream is playful, so calm here means **playful in the art, quiet in the behaviour**:

1. **Colour means something.** Cream and ink everywhere; peach for the one main action; butter for "New / Updated"; matcha for done; sky for focus; plum **only** for allergies.
2. **Status is information, not alarm.** "Low" is a fact, not a warning. Counts are plain text, never red bubbles.
3. **Room to breathe.** 16 px body, 44 px or larger tap targets, one obvious action per card.
4. **Nothing moves unless you did something.** Short, soft motion. The small "pop" overshoot is for Lumi and celebrations only (§5). Lumi is still when idle (no ambient blink); she tilts only while she's writing and hops once when happy. Reduced motion turns every movement off.
5. **Always reversible, never scolding.** Undo is always beside the change. Voice per 0020: warm, brief, practical.
6. **Words carry meaning, not colour alone** (0002). Stitch, tape, stickers and Lumi are decoration; they never carry meaning on their own.

**Still avoided:** alarm-red badges and counting dots · warning triangles (recipe-cat's `warning.svg` was deliberately not ported) · nagging and expiry countdowns · toasts that vanish · "Oops!" · endless spinners.

**Where cream bends the old calm rules** (open for Vero, see the report's proposed question): cream uses small ALL-CAPS eyebrows ("STEP 4 OF 12") and a springy pop on enter. The tokens support both, but default to calm: `ease-gentle` everywhere, `ease-pop` only for Lumi. recipe-cat's Lumi also blinks on a loop; that is left out for calm.

### Calm in the moments that matter (unchanged in meaning, restyled)
| Moment | Cream look |
|---|---|
| **"What changed" bar** | Raised cream card with ink outline; a matcha tick (`success.text`) per line; **Undo** in `accent.text`. It stays put. |
| **"New" / "Updated"** | Butter wash (`highlight.bg`) plus the word "New" / "Updated". Fades in once (`motion.duration.slow`). |
| **Allergy flag** (0019) | The one reserved colour: soft plum panel, firm plum bar, the word **Allergy**, whose allergy and their note. Plum is never used for anything else, including Kitchen OS's lavender "est." pill. |
| **Errors** (0018) | In place, plain sentence, a way forward, `error.text` on `error.bg`. |
| **Offline / stale** | Neutral muted line, not a warning colour. |

---

## 3. Design philosophy (Vero, 0038)
Four checks for every screen and mockup:
1. **If it looks boring, adjust the layout.**
2. **No focal point? Use contrast.**
3. **If it doesn't stand out, exaggerate the scale.**
4. **If it feels plain, add more details.**

Fixes stay inside the **cream tokens**. In cream, "add more details" has ready answers: a stitch, a washi strip on the hero card, a sticker, Lumi. "Exaggerate the scale" uses `text-display` and the large stickers. Calm (§2) still holds: contrast and scale make the focal point, noise doesn't.

---

## 4. Tokens

Rules: semantic names only (0017, 0031). Tailwind's default palette, type, radii, shadows and spacing are reset, so only these exist. Utility names are the token names: `color.text.muted` → `--color-text-muted` → `text-text-muted`. Dark mode is the same names with new values; components never change for it.

**Themes.** Light is the default. Dark turns on automatically when the phone is in dark mode (`prefers-color-scheme`), or with `<html data-theme="dark">`; `<html data-theme="light">` forces light even on a dark phone. Dark mode is in MVP 1 (KOS14, 0045). A theme switch in Settings is not built yet (Phase 3 or later; it only needs to set `data-theme`). `tests/ui/design-tokens.test.ts` checks that the dark theme is complete, that its two copies match, every contrast pair below, and the meta colours.

### Colour

| Token | Role | Light | Dark |
|---|---|---|---|
| `surface.default` | Page and stage | `#FFF6EC` | `#2B1E17` |
| `surface.raised` | Cards, chat, dock, sheets | `#FFFDF8` | `#3B2A21` |
| `surface.sunken` | Message box, tags, group headers | `#F7EADC` | `#241913` |
| `surface.soft` *(new)* | Quiet peach fill: ingredient chips, pills | `#FFE9DE` | `#523829` |
| `text.default` | Main text (ink) | `#5B3A29` | `#FFEEDD` |
| `text.muted` | Secondary text | `#7E5843` | `#E5C7AE` |
| `text.faint` *(new)* | **Disabled only**, never for reading or placeholders | `#A88B78` | `#A88A74` |
| `text.on-accent` *(new)* | Text on peach / butter / matcha fills | `#5B3A29` | `#3A2418` |
| `text.inverse` | Legacy alias of `text.on-accent` (existing buttons) | `#5B3A29` | `#3A2418` |
| `text.on-error` *(new)* | Text on a destructive (`error.text`) button | `#FFFDF8` | `#2B1E17` |
| `border.default` | Decorative dividers only | `#ECDCCB` | `#54402F` |
| `border.strong` | Input and checkbox edges | `#7E5843` | `#C49A7C` |
| `border.outline` *(new)* | The sticker ink outline on cards, buttons, chips | `#5B3A29` | `#C49A7C` |
| `border.stitch` *(new)* | Dashed inner stitch (decorative) | `#FFB89A` | `#B27459` |
| `accent.default` | Primary button fill, chat button (peach) | `#FFB89A` | `#F7A786` |
| `accent.strong` *(new)* | Pressed / hover on the accent | `#F59873` | `#FFBFA4` |
| `accent.text` | Links, Undo, eyebrows | `#A84A26` | `#FFB89A` |
| `accent.soft` | Your own chat bubble | `#FFE9DE` | `#523829` |
| `focus-ring` | Keyboard focus (sky, never brown) | `#2B7A97` | `#8FD3EA` |
| `highlight.bg` / `.text` | "New" / "Updated" | `#FFF1CC` / `#7A4E0E` | `#4A3A1C` / `#FFD98E` |
| `success.bg` / `.text` | Done, receipt tick | `#E4F0DC` / `#3E6834` | `#33402C` / `#BEE0B1` |
| `warning.bg` / `.text` | "Can't undo this now" | `#FFF1CC` / `#7A4E0E` | `#4A3A1C` / `#FFD98E` |
| `error.bg` / `.text` | Errors | `#FFE1DC` / `#9E2B25` | `#4E2622` / `#FFAAA1` |
| `info.bg` / `.text` *(new)* | Neutral notes | `#E0F0F5` / `#2C6273` | `#22383F` / `#B5DEEA` |
| `allergy.bg` / `.text` / `.border` | **Reserved: allergy flags only** (KOS15, 0045) | `#F6E9F4` / `#5A2A57` / `#87487F` | `#3F2440` / `#F4D6F0` / `#C88DC1` |
| `selected.bg` / `.border` | Chosen card, selected option | `#FFE9DE` / `#A84A26` | `#523829` / `#FFB89A` |
| `place.fridge` / `.freezer` / `.pantry` *(new)* | Place tiles (Kitchen OS) | `#E4F0DC` / `#E0F0F5` / `#FFF1CC` | `#33402C` / `#22383F` / `#4A3A1C` |
| `scrim` *(new)* | Behind sheets | ink at 35% | near-black at 60% |

Cream has no plum, so the allergy colours are a cream-warmed version of the 0024 plum, with new dark values.

**Art colours** (`--art-ink`, `--art-cream`, `--art-peach`, `--art-blush`, `--art-matcha`, `--art-butter`, `--art-sky`) are plain CSS variables, not utilities. They match the hexes baked into the SVGs, stay the same in both themes, and are for art only (washi tape, Lumi). Never use them for UI text or fills.

### Kitchen OS → cream (for Frontend's Phase 3)
| Kitchen OS (`kitchen.css`) | Use instead |
|---|---|
| `--bg`, `--surface`, `--card` | `surface.default`, `surface.raised`, `surface.raised` + `border.outline` |
| `--ink`, `--ink-2`, `--ink-3` | `text.default`, `text.muted`, `text.muted` (`--ink-3` fails AA as text) |
| `--line` | `border.default` |
| `--coral` button gradient, `--coral-soft` | `accent.default` fill with `text.on-accent` and an ink outline; `surface.soft` |
| `--mint` / `--lemon` / `--red` / `--sky` (+ `-soft`) | `success.*` / `warning.*` / `error.*` / `info.*` |
| `--lav`, `--lav-soft` ("est." pill, edit note) | `info.*`. **Never lavender**: it reads as the allergy plum |
| `.tile.t-fridge / t-freezer / t-pantry` | `place.fridge / freezer / pantry` |
| `.hero` pink→orange gradient, white text | `card-stitched` + `washi-tape` on `surface.raised`; no gradient |
| soft blurred shadows | `shadow-card` (offset "sticker" shadow) |
| `outline: 3px solid var(--sky)` | `focus-ring`, already global |
| 36 px `.btn.small`, `.seg`, 40 px `.qty` | grow to `spacing.tap` (44 px) |

### Type
Fredoka (headings, `font-heading`; `h1`–`h3` get it by default) and Nunito (body, `font-body`). Both are variable fonts, so any weight works. Sizes follow the Kitchen OS phone scale: cream's 18 px body was made for a full-screen cooking canvas and would crowd a screen that also holds a header, chat and dock.

| Token | Size / line | Used for |
|---|---|---|
| `text.caption` | 13 / 18 px | Eyebrows, "New", meta lines (Kitchen OS's 12 px raised to 13) |
| `text.small` | 14 / 20 px | Reasons, receipt lines, chips |
| `text.body` | 16 / 22 px | Chat, item names, message box (16 px stops iPhone zoom) |
| `text.title` | 20 / 24 px | Card titles, meal names |
| `text.heading` | 22 / 28 px | Header title |
| `text.display` *(new)* | 30 / 34 px | Hero titles (Today greeting) |
| `text.step` *(new)* | 24–28 px, 1.25 | One cook step at a time |
| `font.weight.regular / medium / strong` | 500 / 600 / 800 | Body / Fredoka headings and labels / names and buttons |

### Space, size, shape, depth
- **Space:** unchanged 4 px base, `spacing.1`–`7` = 4 · 8 · 12 · 16 · 24 · 32 · 48 px; `spacing.tap` 44 px.
- **New sizes:** `spacing.icon-lg` 28 · `spacing.tile` 46 · `spacing.sticker-sm/md/lg` 56 / 72 / 96 · `spacing.lumi` 64 px (Lumi beside a greeting).
- **Radius:** `xs` 8 · `sm` 12 · `md` 20 (rows, tiles) · `lg` 28 (cards) · `sheet` 32 · `button` pill · `full`.
- **Outline widths** (CSS variables): `--border-hair` 2 px · `--border-thin` 2.5 px (chips, inputs, stitch) · `--border-card` 3 px · `--border-stitch-inset` 9 px.
- **Shadows** (theme-aware): `shadow-card` 0 6px 0 offset · `shadow-sticker` · `shadow-pop` (sheets, menus) · `shadow-dock` · `shadow-fab` · `shadow-glow` (butter glow, optional "this changed").
- **Focus:** 3 px `focus-ring` with a 2 px gap, on everything.

### Components in `globals.css`
- **`.card-stitched`:** raised surface, 3 px ink outline, `radius.lg`, offset shadow, dashed peach stitch 9 px inside. Decorative only.
- **`.washi-tape`** (+ `data-tone="peach | sky | blush | butter"`, matcha by default): a strip on top of a hero card. Put it on an `aria-hidden` element inside a positioned card. At most one per screen, on the focal card (0038 check 2).

---

## 5. Motion
| Token | Value | Use |
|---|---|---|
| `motion.duration.quick` | 150 ms | Press, hover |
| `motion.duration.gentle` | 300 ms | Sheets, dock, a place's content rising in |
| `motion.duration.slow` | 560 ms | Highlight fade-in |
| `--motion-distance` | 10 px | How far content rises on enter |
| `ease-gentle` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Default for everything |
| `ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | Leaving |
| `ease-pop` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Small overshoot: **Lumi and celebrations only** |

**Reduced motion:** all durations become 0 ms, `--motion-distance` becomes 0 and `ease-pop` loses its overshoot. Things just appear, and Lumi stays still.

---

## 6. Contrast (WCAG 2.2 AA)
Text needs 4.5:1. Control edges, focus and meaningful marks need 3:1. Computed with the WCAG relative-luminance formula and enforced by `tests/ui/design-tokens.test.ts`. **Every pair passes in both themes.**

| Pair | Min | Light | Dark |
|---|---|---|---|
| `text.default` on `surface.default` / `raised` / `sunken` / `soft` | 4.5 | 9.44 / 9.92 / 8.53 / 8.63 | 14.24 / 12.04 / 15.14 / 9.47 |
| `text.muted` on `surface.default` / `raised` / `sunken` / `soft` | 4.5 | 5.84 / 6.14 / 5.28 / 5.34 | 10.08 / 8.52 / 10.72 / 6.70 |
| `accent.text` on `surface.default` / `raised` / `sunken` | 4.5 | 5.35 / 5.62 / 4.84 | 9.67 / 8.17 / 10.28 |
| `text.on-accent` on `accent.default` / `accent.strong` | 4.5 | 6.04 / 4.62 | 7.49 / 9.16 |
| `text.on-error` on `error.text` (destructive button) | 4.5 | 7.31 | 8.85 |
| `highlight.text` on `highlight.bg` | 4.5 | 6.40 | 8.14 |
| `success.text` on `success.bg` | 4.5 | 5.50 | 7.58 |
| `warning.text` on `warning.bg` | 4.5 | 6.40 | 8.14 |
| `error.text` on `error.bg` / `surface.raised` | 4.5 | 6.04 / 7.31 | 7.09 / 7.48 |
| `info.text` on `info.bg` | 4.5 | 5.79 | 8.56 |
| `allergy.text` on `allergy.bg` / `surface.raised` | 4.5 | 9.39 / 10.85 | 10.23 / 10.22 |
| `text.default` on `allergy.bg` | 4.5 | 8.59 | 12.05 |
| `text.default` on `place.fridge` / `freezer` / `pantry` | 4.5 | 8.55 / 8.62 / 8.98 | 9.70 / 10.86 / 9.68 |
| `border.strong` on `surface.raised` / `sunken` | 3 | 6.14 / 5.28 | 5.37 / 6.75 |
| `border.outline` on `surface.raised` | 3 | 9.92 | 5.37 |
| `focus-ring` on `surface.default` / `raised` / `sunken` | 3 | 4.53 / 4.77 / 4.10 | 9.74 / 8.23 / 10.36 |
| `selected.border` on `selected.bg` | 3 | 4.89 | 6.43 |
| `allergy.border` on `allergy.bg` / `surface.raised` | 3 | 5.48 / 6.33 | 5.23 / 5.22 |

**Watch-outs for Frontend:**
- **Peach `accent.default` is only 1.64:1 against `surface.raised` in light.** That's fine for a labelled button (its text identifies it), but give primary buttons the ink `border.outline`, as cream does, so the shape reads.
- **`text.faint`** (3.12:1 light) is for disabled text only. Placeholders use `text.muted`.
- **Native checkboxes** use `accent-accent-default` (peach) today. The browser picks the tick colour, so check it in both themes, or swap to the paw-check sticker in Phase 3.

---

## 7. Lumi
Lumi is the assistant (KOS10): the voice in chat and the mascot. "Kitchen" stays the name of the Kitchen place. Two forms:
- **Small inline Lumi**, [`src/ui/lumi/Lumi.tsx`](../../src/ui/lumi/Lumi.tsx): ported from Kitchen OS `Cat.tsx` and recoloured with the cream art colours. Four states:
  - `idle`: eyes open, still.
  - `think`: eyes glance up; head tilts gently while she is writing a reply (Phase 3 decides whether she sits beside the typing dots or replaces them).
  - `happy`: smiling eyes, one hop (`ease-pop`).
  - `sleep`: closed eyes. For empty and quiet states.
  Decorative by default; pass a translated `title` when she is the only thing saying something.
- **Large cream illustrations**, `LUMI_ART` → `public/art/lumi/`: idle, thinking, listening, working, celebrating, sleeping, alert, chef, bubble. Use them for focal moments (Today greeting, empty places, a finished cook), with `spacing.sticker-lg` or larger (0038 check 3: exaggerate the scale).
- **Where she appears** is Phase 3's layout: beside replies in the chat, on Today's greeting, and in empty states. Never as a nag: Lumi doesn't wave for attention, bounce on a timer or show a count.

## 8. Art inventory (`public/art/`)
Ported from recipe-cat `public/art/`, sanitised: each SVG lost its hard-coded English `<title>` / `aria-label` (0015: names come from translations) and is marked `aria-hidden="true"`, so it's decorative by default. A component that needs a name gives it one through next-intl (`<img alt={t(...)}>`). No scripts or external references (checked on copy).

| Folder | Files | Notes |
|---|---|---|
| `lumi/` | 9: `idle`, `thinking`, `listening`, `working`, `celebrating`, `sleeping`, `alert`, `chef`, `bubble` | Lumi (§7). Kept recipe-cat's names (`class="lumi"`, `data-lumi-state`, eyes group `lumi-eyes`) so its styles port easily. The small Lumi's states pair with them as idle → `idle`, think → `thinking`, happy → `celebrating`, sleep → `sleeping`. |
| `food/` | 13 dish stickers: baking, bbq, burgers, curry, dumplings, fried-rice, pasta, ramen, salads, soups, stir-fry, sushi, tacos | For meal ideas / recipes. `pho.svg` not ported (recipe-cat sample data). |
| `icons/` | 14: back, basket, bowl, close, flame, leaf, mic, paw-check, pin, plus, sparkle, star, undo, zzz | Phosphor stays for everything else (frontend's call). |
| `kitchen/` | *(not ported)* | The 25 equipment stickers were removed before commit (0046). Art is ported only when a feature uses it. |

**Not ported:** `cuisine/` (cuisine ranking, a RecipeCat feature), `ingredients/` (pho-only), `food-pho.svg`, `app-icon.svg` (RecipeCat's icon), the timer / play / pause / star-anise / warning icons, comic panels and sounds. **Food catalog (KOS2 / KOS9):** recipe-cat's catalog gives each food an emoji, and the UI keeps the emoji. The dish stickers in `food/` are meals, not ingredients; only `pasta`, `ramen` and `dumplings` match catalog keys. recipe-cat's unported `ingredients/` set (made for pho) would cover 11 more catalog keys (see the Phase 2 report); porting them is a later call.
