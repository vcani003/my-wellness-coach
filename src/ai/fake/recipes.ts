/**
 * ⚠️ FAKE RECIPES (the stand-in AI, NOT the real one): templates so a preview on the stand-in
 * doesn't mislead (0059). Every ingredient that isn't a to-taste basic gets an amount for 2, the
 * steps are concrete for the kind of dish (eggs, pasta, curry or stew, stir-fry, anything else),
 * and the user's notes about HOW they want it ("season it with only hondashi", "a little sweet")
 * shape the recipe instead of becoming ingredient lines. Questions about an open recipe ("how much
 * eggs do I need?", "what are the measurements?") are answered from it with no change (PF2).
 *
 * Generic on purpose: word lists, not a recipe book. The real model writes the real recipes.
 */
import type { RecipeOutput } from "../meals/model-output";
import type { RecipeInput } from "../meals/types";

type Ingredient = RecipeOutput["ingredients"][number];
type Current = NonNullable<RecipeInput["refine"]>["current"];

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

const LIST_LEAD = /^(?:and\s+)?(?:with|(?:i|we)\s+(?:also\s+)?(?:have|'ve got|have got|got)|use)\s+(?:also\s+)?/i;
const LEAVE_OUT = /^(?:without|no|don'?t (?:want|use|add))\b/i;
const COOK_VERB = /^(?:season|flavou?r|top|finish|serve|sprinkle|garnish|sweeten|cook|fry|make)\b/i;
const NAMED_WITH = /\b(?:with|using)\s+(?:only\s+|just\s+|some\s+|a (?:little|bit of)\s+)?(?:the\s+)?([a-z][a-z' -]*?)\s*$/i;

export interface ReadNotes {
  /** Named as ingredients: "with coconut milk, lemongrass", "I have potatoes". */
  listed: string[];
  /** Named in how they want it: "season it with only hondashi" → hondashi. */
  seasoning: string[];
  /** How they want it, as said: shapes the summary and steps, never an ingredient line. */
  guidance: string[];
  /** "Only" a seasoning: no salt on top of it. */
  onlySeasoning: boolean;
  sweet: boolean;
}

/** Split the user's notes about a dish into ingredients and guidance. */
export function readNotes(notes: string): ReadNotes {
  const out: ReadNotes = { listed: [], seasoning: [], guidance: [], onlySeasoning: false, sweet: false };
  for (const raw of notes.split(/[.!?;\n]+/)) {
    const s = raw.trim();
    if (!s || LEAVE_OUT.test(s)) continue;
    if (LIST_LEAD.test(s)) {
      out.listed.push(
        ...s
          .replace(LIST_LEAD, "")
          .split(/\s*,\s*(?:and\s+)?|\s+and\s+/i)
          .map((x) => x.trim().replace(/^(?:a|an|some|the)\s+/i, ""))
          .filter(Boolean),
      );
      continue;
    }
    out.guidance.push(s);
    if (/\bsweet/i.test(s)) out.sweet = true;
    const named = COOK_VERB.test(s) ? NAMED_WITH.exec(s)?.[1]?.trim() : undefined;
    if (named) {
      out.seasoning.push(named);
      if (/\b(?:only|just)\b/i.test(s)) out.onlySeasoning = true;
    }
  }
  return out;
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

// ─── Questions about an open recipe (0059 PF2) ─────────────────────────────────────────

const ASKS_AMOUNT = /\b(how (?:much|many)|measurements?|amounts?|quantit(?:y|ies)|what are the ingredients)\b/i;
const ASKS_TIME = /\b(how long|what (?:temperature|heat)|how hot)\b/i;
/** "How much rice is left?" is about the kitchen, not the recipe. */
const ABOUT_KITCHEN = /\b(left|do (?:we|i) (?:still )?have|have we got|in the (?:fridge|freezer|pantry|kitchen)|on (?:the|my) list)\b/i;

/** A question about the recipe itself: answered from it, never a change. */
export function isFakeRecipeQuestion(text: string): boolean {
  const t = text.trim();
  if (/^(?:no|without)\b.*\?$/i.test(t)) return true;
  return (ASKS_AMOUNT.test(t) || ASKS_TIME.test(t)) && !ABOUT_KITCHEN.test(t);
}

const stem = (w: string) => w.toLowerCase().replace(/(?:es|s)$/, "");

/** The answer, from the recipe as it stands. */
export function answerRecipeQuestion(text: string, current: Current): string {
  const n = current.servings?.trim();
  const serves = n ? (/^\d+$/.test(n) ? `For ${n} servings` : `For ${n}`) : "For this recipe";
  if (ASKS_TIME.test(text)) {
    const timed = current.steps.filter((s) => /\b\d+(?:[–-]\d+)?\s*(?:minutes?|mins?|hours?|seconds?)\b|\bheat\b/i.test(s));
    return timed.length ? `From the recipe: ${timed.join(" ")}` : "The recipe doesn't give a time for that. Cook it until it looks done.";
  }
  const words = new Set((text.toLowerCase().match(/[a-zà-ỹ]+/g) ?? []).filter((w) => w.length >= 3).map(stem));
  const asked = current.ingredients.filter((i) => i.name.toLowerCase().split(/[^a-zà-ỹ]+/).some((w) => w.length >= 3 && words.has(stem(w))));
  const line = (i: Current["ingredients"][number]) => (i.amount ? `${i.amount} ${i.name}` : `${i.name} (no amount given)`);
  const shown = asked.length ? asked : current.ingredients;
  return `${serves}: ${shown.map(line).join(", ")}.`;
}
