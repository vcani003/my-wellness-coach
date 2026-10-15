/**
 * Moving between the Kitchen OS places in e2e tests (0042): the dock is a nav named "Places" with
 * one link per place (phone: at the bottom; desktop: the slim left nav). Using it, rather than
 * `page.goto`, keeps the chat mounted, as a real person's taps would.
 */
import { expect, type Page } from "@playwright/test";

export type PlaceName = "Today" | "Kitchen" | "Plan" | "Meals" | "List";

export const dock = (page: Page) => page.getByRole("navigation", { name: "Places" });

export async function goTo(page: Page, place: PlaceName) {
  const link = dock(page).getByRole("link", { name: place, exact: true });
  await link.click();
  await expect(link).toHaveAttribute("aria-current", "page");
}

/** The "Kitchen updated · Show" cue after your own change concerns another place (0035 f). */
export const cueShow = (page: Page, place: string) => page.getByRole("link", { name: `Show ${place}` });
