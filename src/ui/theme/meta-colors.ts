/**
 * The token values the browser needs OUTSIDE CSS (the viewport's theme colour and the PWA
 * manifest), which can't read CSS variables. Keep them equal to `--color-surface-default` and
 * `--color-accent-default` in src/app/globals.css, light and dark (cream, 0042).
 * tests/ui/design-tokens.test.ts fails if they drift.
 */
export const META_COLORS = {
  surfaceDefault: "#fff6ec",
  accentDefault: "#ffb89a",
  dark: {
    surfaceDefault: "#2b1e17",
    accentDefault: "#f7a786",
  },
} as const;
