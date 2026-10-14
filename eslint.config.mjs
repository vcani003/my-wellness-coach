import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Module boundaries (backend-data.md §5, §9):
 * - UI, AI and app code reach a domain only through its `commands`, `queries` or `public`.
 * - Domains reach each other only through `public.ts`.
 * - `shared/`, `db/` and `contracts/` never import a domain; `contracts/` stays pure.
 * Tests and scripts are exempt.
 */
const restrict = (patterns) => ({ "no-restricted-imports": ["error", { patterns }] });

/**
 * UI rules (frontend.md §4, §6, §7; decisions 0015, 0017):
 * - accessibility: the jsx-a11y rules (the plugin is registered by eslint-config-next) as errors;
 * - no hard-coded UI text: words go in src/lib/i18n/messages/en.json;
 * - no raw colours: only the semantic tokens in globals.css (hex values and Tailwind palette
 *   classes like `bg-white` are refused; the palette is also switched off in the theme);
 * - no raw HTML injection.
 */
const A11Y_RULES = [
  "alt-text", "anchor-has-content", "anchor-is-valid", "aria-activedescendant-has-tabindex", "aria-props",
  "aria-proptypes", "aria-role", "aria-unsupported-elements", "autocomplete-valid", "click-events-have-key-events",
  "heading-has-content", "html-has-lang", "iframe-has-title", "img-redundant-alt", "interactive-supports-focus",
  "label-has-associated-control", "media-has-caption", "mouse-events-have-key-events", "no-access-key",
  "no-autofocus", "no-distracting-elements", "no-interactive-element-to-noninteractive-role",
  "no-noninteractive-element-interactions", "no-noninteractive-element-to-interactive-role",
  "no-noninteractive-tabindex", "no-redundant-roles", "no-static-element-interactions", "role-has-required-aria-props",
  "role-supports-aria-props", "scope", "tabindex-no-positive",
];
const PALETTE = "white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const uiRules = {
  ...Object.fromEntries(A11Y_RULES.map((r) => [`jsx-a11y/${r}`, "error"])),
  "jsx-a11y/no-noninteractive-tabindex": ["error", { tags: [], roles: ["tabpanel"], allowExpressionValues: true }],
  "react/no-danger": "error",
  "no-restricted-syntax": [
    "error",
    {
      selector: "JSXText[value=/[A-Za-z]/]",
      message: "No hard-coded UI text (0015): put it in src/lib/i18n/messages/en.json and use useTranslations.",
    },
    {
      selector: "JSXAttribute[name.name=/^(aria-label|title|placeholder|alt)$/] > Literal[value=/[A-Za-z]/]",
      message: "No hard-coded UI text (0015): put it in en.json.",
    },
    {
      selector: "Literal[value=/#[0-9a-fA-F]{3,8}\\b/]",
      message: "No raw colours: use a semantic token from src/app/globals.css (0017).",
    },
    {
      selector: `Literal[value=/\\b(bg|text|border|ring|outline|fill|stroke|from|to|via|decoration|divide|placeholder)-(${PALETTE})(-\\d+)?\\b/]`,
      message: "No Tailwind palette colours: use a semantic token class (e.g. bg-surface-raised).",
    },
  ],
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/ui/**/*.tsx", "src/app/**/*.tsx"],
    rules: uiRules,
  },
  {
    files: ["src/app/**", "src/ui/**", "src/ai/**", "src/lib/**", "src/server/**"],
    rules: restrict([
      {
        group: [
          "@/domains/*/*",
          "!@/domains/*/commands",
          "!@/domains/*/queries",
          "!@/domains/*/public",
          "**/domains/*/*",
          "!**/domains/*/commands",
          "!**/domains/*/queries",
          "!**/domains/*/public",
        ],
        message: "Reach a domain only through its commands, queries or public.ts.",
      },
    ]),
  },
  {
    files: ["src/domains/**"],
    rules: restrict([
      {
        group: ["@/domains/*/*", "!@/domains/*/public"],
        message: "Domains reach each other only through public.ts; use a relative import inside your own domain.",
      },
    ]),
  },
  {
    files: ["src/shared/**", "src/db/**"],
    rules: restrict([{ group: ["@/domains/**", "**/domains/**"], message: "The shared layer never imports a domain." }]),
  },
  {
    files: ["src/contracts/**"],
    rules: restrict([
      {
        group: ["@/*", "!@/contracts", "!@/contracts/*", "node:*", "drizzle-orm", "drizzle-orm/*"],
        message: "Contracts are pure Zod: imported by the UI too, so no server code.",
      },
    ]),
  },
  globalIgnores([
    ".next/**",
    ".next-e2e/**",
    ".next-e2e-auth/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".data/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
