/**
 * The bright design tokens (0048, docs/design/visual-direction.md §4–6): every text / background
 * pair the components use meets WCAG 2.2 AA, the app is light only (no dark theme anywhere), and
 * the browser meta colours match the CSS.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { META_COLORS } from "@/ui/theme/meta-colors";

const css = readFileSync(fileURLToPath(new URL("../../src/app/globals.css", import.meta.url)), "utf8");

type Theme = Record<string, string>;

function colorVars(block: string): Theme {
  const out: Theme = {};
  for (const m of block.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const themeBlock = /@theme static \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
const light = colorVars(themeBlock);
delete light["*"];
delete light.transparent;
delete light.current;

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

type Pair = [string, string, number];
const on = (fg: string, bgs: string[], min: number): Pair[] => bgs.map((bg) => [fg, bg, min]);

/** [foreground, background, minimum]. 4.5 = text (1.4.3), 3 = UI edges, focus and meaningful marks (1.4.11). */
const PAIRS: Pair[] = [
  ...on("text-default", ["surface-default", "surface-raised", "surface-sunken", "surface-soft", "accent-soft", "selected-bg"], 4.5),
  ...on("text-default", ["highlight-bg", "success-bg", "warning-bg", "error-bg", "info-bg", "allergy-bg"], 4.5),
  ...on("text-default", ["place-fridge", "place-freezer", "place-pantry", "hero-start", "hero-end"], 4.5),
  ...on("text-muted", ["surface-default", "surface-raised", "surface-sunken", "surface-soft", "hero-start", "hero-end"], 4.5),
  ...on("accent-text", ["surface-default", "surface-raised", "surface-sunken", "surface-soft", "hero-start", "hero-end"], 4.5),
  // The primary button: ink on every stop of the coral → orange gradient, and on its hover stops.
  ...on("text-on-accent", ["accent-default", "accent-end", "accent-strong"], 4.5),
  ["text-inverse", "accent-default", 4.5],
  ["text-on-error", "error-text", 4.5],
  // The "What changed" card (success-bg): its lines, the undone/rejected lines, View, and focus on it.
  ...on("text-muted", ["success-bg"], 4.5),
  ...on("accent-text", ["success-bg"], 4.5),
  ["focus-ring", "success-bg", 3],
  // A segmented control: unchosen (muted on sunken) and chosen (dark coral on coral-soft, with its ring).
  ["text-muted", "surface-sunken", 4.5],
  ["accent-text", "selected-bg", 4.5],
  ["highlight-text", "highlight-bg", 4.5],
  ["highlight-text", "surface-raised", 4.5],
  ["success-text", "success-bg", 4.5],
  ["success-text", "surface-raised", 4.5],
  ["warning-text", "warning-bg", 4.5],
  ["warning-text", "surface-raised", 4.5],
  ["error-text", "error-bg", 4.5],
  ["error-text", "surface-raised", 4.5],
  ["error-text", "surface-default", 4.5],
  ["info-text", "info-bg", 4.5],
  ["allergy-text", "allergy-bg", 4.5],
  ["allergy-text", "surface-raised", 4.5],
  // A ticked checkbox: the green fill against the card, and the white tick on the fill.
  ["success-fill", "surface-raised", 3],
  ["text-on-fill", "success-fill", 3],
  ...on("border-strong", ["surface-default", "surface-raised", "surface-sunken"], 3),
  ...on("focus-ring", ["surface-default", "surface-raised", "surface-sunken", "hero-start", "hero-end"], 3),
  ["selected-border", "selected-bg", 3],
  ["selected-border", "surface-raised", 3],
  ["allergy-border", "allergy-bg", 3],
  ["allergy-border", "surface-raised", 3],
];

describe("design tokens (bright, 0048)", () => {
  it("parses the theme", () => {
    expect(Object.keys(light).length).toBeGreaterThan(30);
  });

  it.each(PAIRS)("%s on %s ≥ %d:1", (fg, bg, min) => {
    expect(light[fg], fg).toMatch(/^#[0-9a-f]{6}$/);
    expect(light[bg], bg).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrast(light[fg], light[bg])).toBeGreaterThanOrEqual(min);
  });

  it("documents why the primary button has ink text: white on coral fails AA", () => {
    expect(contrast("#ffffff", light["accent-default"])).toBeLessThan(4.5);
    expect(light["text-on-accent"]).toBe(light["text-default"]);
  });

  it("is light only: no dark theme, no data-theme switch, and color-scheme is light", () => {
    expect(css).not.toMatch(/prefers-color-scheme/);
    expect(css).not.toMatch(/data-theme/);
    expect(css).not.toMatch(/color-scheme:\s*dark/);
    expect(css).toMatch(/color-scheme:\s*light/);
    // Every colour is defined once, in the one theme block (no second set of values elsewhere).
    const outside = css.replace(themeBlock, "");
    expect(outside).not.toMatch(/--color-[a-z0-9-]+:\s*#/);
  });

  // Light only means no big dark surfaces either (0048): every fill a panel can use stays light.
  // (Small dark marks, like the new-reply dot or a destructive button's fill, use text tokens.)
  it.each(Object.keys(light).filter((k) => /^(surface-|place-|hero-)|-bg$/.test(k)))("%s is a light fill", (k) => {
    expect(luminance(light[k])).toBeGreaterThan(0.35);
  });

  it("keeps the cream-only pieces out (0048): no stitch, no washi tape, no sticker art", () => {
    expect(css).not.toMatch(/card-stitched|washi-tape|--art-|border-stitch|border-outline|surface-ink|on-ink/);
  });

  it("keeps the browser meta colours equal to the CSS tokens, with a single light value", () => {
    expect(META_COLORS).toEqual({ surfaceDefault: light["surface-default"], accentDefault: light["accent-default"] });
  });
});
