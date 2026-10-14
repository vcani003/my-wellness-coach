/** Automated accessibility check for the e2e tests (frontend.md §6, §8). */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** Fails on serious or critical WCAG 2.2 A/AA issues (frontend.md §6). */
export async function expectAccessible(page: Page, checkpoint: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const minor = results.violations.filter((v) => !blocking.includes(v));
  if (minor.length) console.log(`[axe ${checkpoint}] minor:`, minor.map((v) => `${v.id} (${v.impact})`).join(", "));
  expect(blocking.map((v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), checkpoint).toEqual([]);
}
