/**
 * A food's emoji on a soft tile tinted by where it's kept (0048; prototype `.tile`). Purely
 * presentational: the emoji is aria-hidden and the food's name stays as text beside it.
 *
 * The emoji will come from the food catalog (KOS2) when it lands. Until then every food shows the
 * same neutral plate; no per-food mapping is invented here.
 */
export const FALLBACK_FOOD_EMOJI = "🍽️";

export type TilePlace = "fridge" | "freezer" | "pantry" | "counter" | "unknown";

export function FoodTile({ emoji, place }: { emoji?: string | null; place?: TilePlace | null }) {
  return (
    <span aria-hidden="true" data-food-tile="" data-emoji={emoji || FALLBACK_FOOD_EMOJI} data-place={place ?? "unknown"} className="place-tile" />
  );
}
