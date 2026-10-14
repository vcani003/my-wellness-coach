/**
 * The two token values the browser needs OUTSIDE CSS (the viewport's theme colour and the PWA
 * manifest), which can't read CSS variables. Keep them equal to `--color-surface-default` and
 * `--color-accent-default` in src/app/globals.css (Clay & Honey, 0024).
 */
export const META_COLORS = {
  surfaceDefault: "#faf4ec",
  accentDefault: "#9a4e2f",
} as const;
