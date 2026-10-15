/**
 * The token values the browser needs OUTSIDE CSS (the viewport's theme colour and the PWA
 * manifest), which can't read CSS variables. Keep them equal to `--color-surface-default` and
 * `--color-accent-default` in src/app/globals.css. Light only (0048).
 * tests/ui/design-tokens.test.ts fails if they drift.
 */
export const META_COLORS = {
  surfaceDefault: "#fffbf8",
  accentDefault: "#ff7a6b",
} as const;
