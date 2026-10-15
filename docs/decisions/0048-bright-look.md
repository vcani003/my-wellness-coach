# 0048: The bright prototype look, light only

**Status:** Accepted · 2026-10-15 · Decided by Vero. Replaces the cream visual system in [0042](0042-kitchen-os-ui.md). Reverses [0045](0045-kitchen-os-features.md) KOS14 (dark theme). Narrows [0046](0046-cream-style-details.md).

- **The look comes from recipe-cat's `explorations/kitchen-os/prototype-bright.html`:**
  - warm white background and plain white cards that float on soft shadows, with no outlines and no stitching;
  - plum ink text;
  - coral → orange gradient main buttons;
  - a soft colour for each place;
  - Fredoka for headings and Nunito for body text.
  The Kitchen OS layout from 0042 stays as built.
- **Light only for now.** There's no dark theme; KOS14 is reversed. Tokens still go through one place, so dark mode can be added later.
- **Food is shown as an emoji on a soft coloured tile.** The emoji comes from the food catalog (KOS2) when it lands.
- **Lumi is the prototype's simple line-drawn cat:** idle, thinking, happy and sleeping. The cream illustrations, washi tape and stitched borders are removed. Cream art that nothing uses any more is deleted from the repo (0046: art only when a feature uses it).
- **Rules that still apply:**
  - no looping animation (0046), so the prototype's looping blink and tail wag are dropped;
  - short caps labels are allowed;
  - the pop is only for Lumi and celebrations;
  - one colour stays reserved for allergy flags (KOS15);
  - WCAG AA contrast (0002). The prototype's white text on coral fails AA, so main buttons need a fix that passes.
