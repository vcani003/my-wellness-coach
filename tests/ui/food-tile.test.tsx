// @vitest-environment jsdom
/** FoodTile (0048): an emoji on a soft tile tinted by place; decorative, with a neutral fallback until KOS2. */
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FALLBACK_FOOD_EMOJI, FoodTile } from "@/ui/primitives/FoodTile";

afterEach(cleanup);

describe("FoodTile", () => {
  it("is hidden from screen readers (the name stays as text beside it)", () => {
    const { container } = render(<FoodTile emoji="🥚" place="fridge" />);
    const tile = container.firstElementChild!;
    expect(tile).toHaveAttribute("aria-hidden", "true");
    expect(tile).toHaveAttribute("data-emoji", "🥚");
    // Drawn by CSS, not as text, so a row's text stays the food's name ("Eggs …").
    expect(tile.textContent).toBe("");
  });

  it.each(["fridge", "freezer", "pantry"] as const)("is tinted for the %s", (place) => {
    const { container } = render(<FoodTile place={place} />);
    expect(container.firstElementChild).toHaveAttribute("data-place", place);
    expect(container.firstElementChild).toHaveClass("place-tile");
  });

  it("falls back to a neutral plate and a neutral tint", () => {
    const { container } = render(<FoodTile place={null} emoji={null} />);
    expect(container.firstElementChild).toHaveAttribute("data-emoji", FALLBACK_FOOD_EMOJI);
    expect(container.firstElementChild).toHaveAttribute("data-place", "unknown");
  });
});
