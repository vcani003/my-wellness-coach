/**
 * ⚠️ FAKE RECIPES (the stand-in AI, NOT the real one): the templates behind "make me a sample
 * recipe" (0059 PF10), so the recipe and week screens can be clicked through without the real AI.
 * Every ingredient that isn't a to-taste basic gets an amount for 2, and the steps are concrete for
 * the kind of dish (eggs, pasta, curry or stew, stir-fry, anything else). The stand-in never writes
 * a recipe for a dish someone asks for, and never answers questions about one: only the real model
 * does (PF10).
 *
 * Generic on purpose: word lists, not a recipe book.
 */
import type { RecipeOutput } from "../meals/model-output";

type Ingredient = RecipeOutput["ingredients"][number];

export type DishKind = "eggs" | "pasta" | "curry" | "stir-fry" | "general";

export function dishKind(title: string): DishKind {
  const t = title.toLowerCase();
  if (/\b(omelett?e|tamago\w*|frittata|scrambled|eggs?)\b/.test(t)) return "eggs";
  if (/\b(pasta|penne|spaghetti|linguine|fusilli|macaroni|lasagne|lasagna|carbonara)\b/.test(t)) return "pasta";
  if (/\b(curry|stew|soup|chili|chilli|braise|pho|casserole)\b/.test(t)) return "curry";
  if (/\b(stir.?fry|fried rice|noodles?|rice bowl|bowl|pad thai)\b/.test(t)) return "stir-fry";
  return "general";
}

const PROTEIN = /\b(chicken|beef|pork|lamb|mince|tofu|fish|salmon|cod|shrimp|prawns?|turkey|bacon|sausages?|ham|tuna)\b/i;
const STARCH = /\b(pasta|penne|spaghetti|linguine|fusilli|macaroni|noodles?|rice|bánh phở|bread)\b/i;
const LIQUID = /\b(coconut milk|coconut cream|stock|broth|milk|cream|wine)\b/i;
const FLAVOUR =
  /\b(sauce|paste|dashi|hondashi|powder|seasoning|spices?|curry base|garlic|ginger|lemon ?grass|lime leaves|kaffir|chill?i|sugar|mirin|vinegar|honey|miso|herbs?|limes?|lemons?)\b/i;
const EGGS = /\beggs?\b/i;

/** A sensible amount for 2, from the ingredient's name. */
export function fakeAmount(name: string): string {
  const n = name.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/\beggs?\b/, "4"],
    [/\b(packet|sachet)\b/, "1 packet"],
    [/\bcoconut (milk|cream)\b/, "1 can (400 ml)"],
    [/\b(stock|broth)\b/, "500 ml"],
    [/\b(pasta|penne|spaghetti|linguine|fusilli|macaroni|noodles?|bánh phở)\b/, "200 g"],
    [/\brice\b/, "1 cup (200 g)"],
    [/\b(chicken|beef|pork|lamb|mince|turkey|tofu|fish|salmon|cod)\b/, "400 g"],
    [/\b(shrimp|prawns?)\b/, "250 g"],
    [/\b(bacon|ham|sausages?)\b/, "150 g"],
    [/\b(milk|cream)\b/, "100 ml"],
    [/\b(hondashi|dashi|powder)\b/, "1 tsp"],
    [/\b(sugar|mirin|honey)\b/, "1 tsp"],
    [/\b(sauce|paste|vinegar|miso)\b/, "1 tbsp"],
    [/\bgarlic\b/, "2 cloves"],
    [/\bginger\b/, "2 cm piece"],
    [/\blemon ?grass\b/, "2 stalks"],
    [/\b(lime leaves|kaffir)\b/, "4 leaves"],
    [/\b(onions?|shallots?|limes?|lemons?)\b/, "1"],
    [/\bpotato(es)?\b/, "2 medium"],
    [/\btomato(es)?\b/, "2"],
    [/\bcarrots?\b/, "2"],
    [/\b(spinach|greens|kale|herbs?|basil|coriander|cilantro|parsley|mint)\b/, "a handful"],
    [/\b(cheese|parmesan|cheddar|feta)\b/, "40 g"],
    [/\bbutter\b/, "1 tbsp"],
    [/\b(seasoning|spices?|chill?i)\b/, "1 tsp"],
  ];
  for (const [re, amount] of rules) if (re.test(n)) return amount;
  return /s$/.test(n.trim()) ? "2" : "100 g";
}

const list = (names: string[]) => new Intl.ListFormat("en", { type: "conjunction" }).format(names);

/** The steps for this kind of dish, naming its own ingredients and amounts. At least 4. */
export function fakeSteps(title: string, ingredients: Ingredient[], opts: { salt: boolean }): string[] {
  const kind = dishKind(title);
  const rolled = /\b(tamago\w*|rolled|japanese)\b/i.test(title);
  const mains = ingredients.filter((i) => !i.basic);
  const pick = (re: RegExp) => mains.filter((i) => re.test(i.name));
  const eggs = pick(EGGS);
  const protein = pick(PROTEIN).filter((i) => !eggs.includes(i));
  const starch = pick(STARCH).filter((i) => !protein.includes(i));
  const liquid = pick(LIQUID).filter((i) => !protein.includes(i) && !starch.includes(i));
  const flavour = pick(FLAVOUR).filter((i) => ![...protein, ...starch, ...liquid].includes(i));
  const veg = mains.filter((i) => ![...eggs, ...protein, ...starch, ...liquid, ...flavour].includes(i));
  const the = (xs: Ingredient[]) => list(xs.map((i) => `the ${i.name}`));
  const withAmounts = (xs: Ingredient[]) => list(xs.map((i) => (i.amount ? `${i.amount} ${i.name}` : i.name)));
  const finish = opts.salt ? "Taste, add salt if it needs it, and serve" : "Taste and serve";
  const steps: string[] = [];

  if (kind === "eggs") {
    const egg = eggs[0];
    const beat = egg ? `Crack the ${egg.amount ? `${egg.amount} ` : ""}${egg.name} into a bowl` : "Crack the eggs into a bowl";
    steps.push(`${beat} and beat until smooth${flavour.length ? `, with ${withAmounts(flavour)}` : opts.salt ? ", with a pinch of salt" : ""}.`);
    if (veg.length || protein.length) steps.push(`Chop ${the([...veg, ...protein])} finely.`);
    steps.push("Heat a non-stick pan over medium-low heat and wipe it with a little of the oil.");
    if (rolled) {
      steps.push("Pour in a thin layer of egg and cook for about 1 minute, until just set on top, then roll it to one side of the pan.");
      steps.push("Oil the pan again, add another thin layer, lift the roll so the egg runs under it, and roll it back up. Repeat until the egg is used up.");
      steps.push("Rest the roll for 2 minutes, then slice it into 2 cm pieces and serve.");
    } else {
      steps.push(`Pour in the egg${veg.length || protein.length ? ` and ${the([...veg, ...protein])}` : ""} and cook for 2–3 minutes, pulling the set edges to the middle, until just set.`);
      steps.push("Fold it in half, slide it onto a plate and serve straight away.");
    }
    return steps;
  }

  if (kind === "pasta") {
    const pasta = starch[0];
    steps.push(`Bring a large pot of salted water to the boil and cook ${pasta ? `the ${pasta.amount ? `${pasta.amount} of ` : ""}${pasta.name}` : "the pasta"} until al dente, about 10 minutes. Keep a cup of the pasta water.`);
    steps.push(`Meanwhile, heat 1 tbsp of the oil in a large pan over medium heat${protein.length ? ` and brown ${the(protein)} for 5–6 minutes` : ""}.`);
    if (veg.length || flavour.length) steps.push(`Add ${the([...flavour, ...veg])} and cook for 3–4 minutes, until soft.`);
    if (liquid.length) steps.push(`Pour in ${the(liquid)} and simmer for 3 minutes.`);
    steps.push("Toss the drained pasta in the pan, loosening it with a splash of the pasta water.");
    steps.push(`${finish}.`);
    return steps;
  }

  if (kind === "curry") {
    const chop = [...protein, ...veg];
    steps.push(chop.length ? `Cut ${the(chop)} into bite-size pieces.` : "Get everything chopped and measured before you start.");
    steps.push("Heat 1 tbsp of the oil in a large pot over medium heat.");
    if (protein.length) steps.push(`Brown ${the(protein)} for 5 minutes, turning once.`);
    if (flavour.length) steps.push(`Stir in ${the(flavour)} and cook for 1 minute, until fragrant.`);
    steps.push(`Add ${veg.length ? `${the(veg)} and ` : ""}${liquid.length ? the(liquid) : "500 ml water"}, bring to a simmer and cook for 20–25 minutes, until everything is tender.`);
    const rice = starch.filter((i) => /rice|noodle|bánh phở/i.test(i.name));
    if (rice.length) steps.push(`Meanwhile, cook ${the(rice)} as the packet says.`);
    steps.push(`${finish}.`);
    return steps;
  }

  if (kind === "stir-fry") {
    const cut = [...protein, ...veg];
    steps.push(cut.length ? `Cut ${the(cut)} into thin, even strips.` : "Get everything chopped and measured before you start: a stir-fry moves fast.");
    if (starch.length) steps.push(`Cook ${the(starch)} as the packet says, then drain.`);
    steps.push("Heat 1 tbsp of the oil in a wok or large pan over high heat until it shimmers.");
    if (protein.length) steps.push(`Stir-fry ${the(protein)} for 3–4 minutes until browned, then set it aside.`);
    if (veg.length) steps.push(`Stir-fry ${the(veg)} for 2–3 minutes, so they stay crisp.`);
    steps.push(`Put everything back in the pan${flavour.length || liquid.length ? ` with ${the([...flavour, ...liquid])}` : ""} and toss for 1–2 minutes.`);
    steps.push(`${finish} hot.`);
    return steps;
  }

  const prep = mains.filter((i) => !flavour.includes(i) && !liquid.includes(i));
  steps.push(prep.length ? `Wash and cut ${the(prep)} into bite-size pieces.` : "Get everything chopped and measured before you start.");
  steps.push("Heat 1 tbsp of the oil in a large pan over medium heat.");
  if (protein.length) steps.push(`Cook ${the(protein)} for 5–6 minutes, until browned and cooked through.`);
  const rest = [...veg, ...starch, ...flavour, ...liquid];
  steps.push(rest.length ? `Add ${the(rest)} and cook for 5 minutes, stirring often.` : "Cook for 5 minutes, stirring often.");
  steps.push(`${finish} warm.`);
  return steps;
}

/** The dish's defining ingredient when nothing names it ("Japanese rolled omelette" → eggs). */
export function definingIngredient(title: string, ingredients: Ingredient[]): Ingredient | null {
  const kind = dishKind(title);
  if (kind === "eggs" && !ingredients.some((i) => EGGS.test(i.name))) return { name: "eggs", amount: "4", item: null, basic: false };
  if (kind === "pasta" && !ingredients.some((i) => STARCH.test(i.name))) return { name: "pasta", amount: "200 g", item: null, basic: false };
  return null;
}

/**
 * A sample recipe's main ingredients when the kitchen doesn't name them (PF10): a few everyday ones
 * for this kind of dish, each with an amount, so the In your kitchen / Need split has something in
 * both (whatever matches the kitchen moves to In your kitchen through the same guard as the real one).
 */
export function sampleIngredients(dish: string): string[] {
  switch (dishKind(dish)) {
    case "eggs":
      return ["eggs", "spring onions", "soy sauce"];
    case "pasta":
      return ["pasta", "garlic", "tomatoes", "parmesan"];
    case "curry":
      return ["chicken", "onions", "curry paste", "coconut milk", "rice"];
    case "stir-fry":
      return ["noodles", "chicken", "carrots", "soy sauce", "garlic"];
    default:
      return ["rice", "eggs", "spring onions", "soy sauce", "garlic"];
  }
}
