/**
 * The cream design tokens (0042, docs/design/visual-direction.md §4–5): every text / background
 * pair the components use meets WCAG 2.2 AA in BOTH themes, the dark theme is complete, its two
 * copies (automatic and data-theme) never drift, and the browser meta colours match the CSS.
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

const darkBlocks = [...css.matchAll(/\/\* dark-theme:start \*\/([\s\S]*?)\/\* dark-theme:end \*\//g)].map((m) =>
  m[1].replace(/\s+/g, " ").trim(),
);
const dark: Theme = colorVars(darkBlocks[0] ?? "");

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

/** [foreground, background, minimum]. 4.5 = text (1.4.3), 3 = UI edges and focus (1.4.11, 2.4.13-ish). */
const PAIRS: [string, string, number][] = [
  ...["surface-default", "surface-raised", "surface-sunken", "surface-soft", "accent-soft", "selected-bg"].map(
    (bg) => ["text-default", bg, 4.5] as [string, string, number],
  ),
  ...["highlight-bg", "success-bg", "warning-bg", "error-bg", "info-bg", "allergy-bg"].map(
    (bg) => ["text-default", bg, 4.5] as [string, string, number],
  ),
  ...["place-fridge", "place-freezer", "place-pantry"].map((bg) => ["text-default", bg, 4.5] as [string, string, number]),
  ...["surface-default", "surface-raised", "surface-sunken", "surface-soft"].map(
    (bg) => ["text-muted", bg, 4.5] as [string, string, number],
  ),
  ...["surface-default", "surface-raised", "surface-sunken", "surface-soft"].map(
    (bg) => ["accent-text", bg, 4.5] as [string, string, number],
  ),
  ["text-on-accent", "accent-default", 4.5],
  ["text-on-accent", "accent-strong", 4.5],
  ["text-inverse", "accent-default", 4.5],
  ["text-on-error", "error-text", 4.5],
  ["highlight-text", "highlight-bg", 4.5],
  ["highlight-text", "surface-raised", 4.5],
  ["success-text", "success-bg", 4.5],
  ["success-text", "surface-raised", 4.5],
  ["warning-text", "warning-bg", 4.5],
  ["error-text", "error-bg", 4.5],
  ["error-text", "surface-raised", 4.5],
  ["error-text", "surface-default", 4.5],
  ["info-text", "info-bg", 4.5],
  ["allergy-text", "allergy-bg", 4.5],
  ["allergy-text", "surface-raised", 4.5],
  ...["surface-default", "surface-raised", "surface-sunken"].map((bg) => ["border-strong", bg, 3] as [string, string, number]),
  ...["surface-default", "surface-raised"].map((bg) => ["border-outline", bg, 3] as [string, string, number]),
  ...["surface-default", "surface-raised", "surface-sunken"].map((bg) => ["focus-ring", bg, 3] as [string, string, number]),
  ["selected-border", "selected-bg", 3],
  ["selected-border", "surface-raised", 3],
  ["allergy-border", "allergy-bg", 3],
  ["allergy-border", "surface-raised", 3],
];

describe("design tokens (cream, 0042)", () => {
  it("parses the light theme", () => {
    expect(Object.keys(light).length).toBeGreaterThan(30);
  });

  it("has exactly two identical dark blocks (automatic + data-theme)", () => {
    expect(darkBlocks).toHaveLength(2);
    expect(darkBlocks[0]).toBe(darkBlocks[1]);
  });

  it("gives every light colour a dark value", () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it("keeps [data-theme=light] winning over the automatic dark theme", () => {
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\)/);
  });

  for (const [name, theme] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    it.each(PAIRS)(`${name}: %s on %s ≥ %d:1`, (fg, bg, min) => {
      expect(theme[fg], fg).toMatch(/^#[0-9a-f]{6}$/);
      expect(theme[bg], bg).toMatch(/^#[0-9a-f]{6}$/);
      expect(contrast(theme[fg], theme[bg])).toBeGreaterThanOrEqual(min);
    });
  }

  it("keeps the browser meta colours equal to the CSS tokens", () => {
    expect(META_COLORS.surfaceDefault).toBe(light["surface-default"]);
    expect(META_COLORS.accentDefault).toBe(light["accent-default"]);
    expect(META_COLORS.dark.surfaceDefault).toBe(dark["surface-default"]);
    expect(META_COLORS.dark.accentDefault).toBe(dark["accent-default"]);
  });
});
