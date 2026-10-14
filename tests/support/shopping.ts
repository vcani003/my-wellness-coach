/**
 * Vero's message from the first real test (0026, 0027), and the shopping-list operations the AI
 * would propose for it. Ginger is said twice, so it must merge into one item.
 */
import type { OpInput } from "./memory-kitchen";
import { said } from "./memory-kitchen";

export const PHO_MESSAGE =
  "I've made a beef pho. I need to shop for … MD Oriental Market: garlic, ginger, green onion, shallot, culantro, lemongrass, sweet potato, ginger, coconut milk / Publix: oatmilk";

const MD = "MD Oriental Market";
const MD_ITEMS = ["garlic", "ginger", "green onion", "shallot", "culantro", "lemongrass", "sweet potato", "ginger", "coconut milk"];

export const phoShoppingOps: OpInput[] = [
  ...MD_ITEMS.map(
    (name): OpInput => ({ type: "shopping.add", evidence: name, fields: { name: said(name), store: said(MD) } }),
  ),
  { type: "shopping.add", evidence: "oatmilk", fields: { name: said("oatmilk"), store: said("Publix") } },
];

/** The list after the message: 9 distinct items, in the order said. */
export const PHO_LIST = [
  ["garlic", MD],
  ["ginger", MD],
  ["green onion", MD],
  ["shallot", MD],
  ["culantro", MD],
  ["lemongrass", MD],
  ["sweet potato", MD],
  ["coconut milk", MD],
  ["oatmilk", "Publix"],
] as const;
