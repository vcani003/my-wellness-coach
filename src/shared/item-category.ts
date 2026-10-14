/**
 * The kitchen's own guess at an item's category (CAT1 Rec): a deterministic keyword map, in code,
 * covering English plus common Vietnamese and other Asian pantry words. Used:
 * - to sort items saved before categories existed (computed on read, never written; 0028), and
 * - as the fallback when an `item.add` arrives without a category and the kitchen has no
 *   remembered choice for that name.
 * Pure and client-safe (no server imports), so the UI can share it.
 *
 * How a name is matched (all accent- and case-insensitive, plurals folded the same way as
 * standard names, so "Nước mắm", "nuoc mam" and "NUOC MAM" are one):
 * 1. A "priority" word wins outright: leftovers ("leftover", "cooked", "thừa") and containers
 *    ("canned", "jar"), so "pho leftovers" → leftovers and "canned tomatoes" → canned & jarred.
 * 2. Otherwise the **longest** matching phrase wins: "fish sauce" (2 words) beats "fish".
 * 3. A tie goes to the phrase that ends **last**, the English head noun: "egg noodles" → noodles,
 *    "chili sauce" → sauce. Vietnamese puts the head first, so its compounds are listed in full
 *    ("cà chua", "bánh phở").
 * 4. No match → `other`, confidence low.
 *
 * Accent folding makes some Vietnamese words collide ("bò" beef / "bơ" butter, "dầu" oil / "đậu"
 * bean), so those appear only inside longer phrases. Easy to extend: add a word to a list.
 *
 * A Vietnamese entry may carry an English gloss after "|" ("nước mắm|fish sauce"). Search uses it,
 * so typing "fish" also finds "nước mắm" (CAT1: "the name you used or the English name").
 */
import type { Confidence, Fact, ItemCategory } from "@/contracts/common";
import { foldText, singularWord } from "./text";

/** English fallback names, in the CAT1 order. The UI's own names live in en.json (`category.*`). */
export const CATEGORY_LABEL_EN: Record<ItemCategory, string> = {
  produce: "Produce",
  meat_seafood: "Meat & seafood",
  dairy_eggs: "Dairy & eggs",
  rice_noodles_grains: "Rice, noodles & grains",
  sauces_condiments: "Sauces & condiments",
  spices_seasonings: "Spices & seasonings",
  canned_jarred: "Canned & jarred",
  baking: "Baking",
  snacks_sweets: "Snacks & sweets",
  drinks: "Drinks",
  leftovers: "Leftovers",
  other: "Other",
};

/** Words that decide the category whatever else the name says. */
const PRIORITY: Partial<Record<ItemCategory, string[]>> = {
  leftovers: ["leftover", "leftovers", "left over", "cooked", "thừa|leftovers", "đồ ăn thừa|leftovers"],
  canned_jarred: ["canned", "tinned", "can", "cans", "jar", "jarred", "đồ hộp|canned", "hộp|canned"],
};

const KEYWORDS: Record<Exclude<ItemCategory, "other">, string[]> = {
  produce: [
    "apple", "banana", "orange", "lemon", "lime", "avocado", "tomato", "cherry tomato", "potato",
    "sweet potato", "onion", "red onion", "green onion", "spring onion", "scallion", "shallot",
    "garlic", "ginger", "lemongrass", "galangal", "turmeric root", "carrot", "cucumber", "lettuce",
    "spinach", "kale", "cabbage", "napa cabbage", "bok choy", "choy sum", "gai lan",
    "chinese broccoli", "broccoli", "cauliflower", "bell pepper", "red pepper", "green pepper",
    "chili", "chilli", "chile", "thai chili", "bird eye chili", "jalapeno", "mushroom", "shiitake",
    "enoki", "eggplant", "aubergine", "zucchini", "squash", "pumpkin", "corn", "celery", "herb",
    "basil", "thai basil", "cilantro", "mint", "parsley", "dill", "chive", "bean sprout",
    "daikon", "radish", "taro", "yam", "okra", "bitter melon", "mango", "papaya", "pineapple",
    "grape", "berry", "strawberry", "blueberry", "raspberry", "watermelon", "melon", "pear",
    "peach", "plum", "kiwi", "lychee", "longan", "rambutan", "dragon fruit", "jackfruit",
    "durian", "persimmon", "coconut", "kaffir lime leaf", "lime leaf", "makrut lime leaf",
    "kaffir lime leaves", "lime leaves", "chilies", "chillies",
    "tofu", "salad", "vegetable", "veggie", "fruit", "green bean", "pea", "snow pea", "asparagus",
    "beet", "leek", "arugula",
    // Vietnamese
    "rau|vegetables", "rau muống|water spinach", "rau thơm|herbs", "rau răm|vietnamese coriander",
    "húng quế|thai basil", "tía tô|perilla", "kinh giới|vietnamese balm", "hành|onion",
    "hành lá|scallion", "hành tím|shallot", "hành tây|onion", "tỏi|garlic", "gừng|ginger",
    "sả|lemongrass", "ớt|chili", "chanh|lime", "ngò|cilantro", "ngò gai|culantro",
    "lá chanh|lime leaves", "giá|bean sprouts", "bắp cải|cabbage", "cải thảo|napa cabbage",
    "cải ngọt|choy sum", "cải bẹ xanh|mustard greens", "cà chua|tomato", "cà rốt|carrot",
    "cà tím|eggplant", "dưa leo|cucumber", "dưa chuột|cucumber", "khoai tây|potato",
    "khoai lang|sweet potato", "khoai môn|taro", "nấm|mushrooms", "bí đỏ|pumpkin",
    "bí xanh|winter melon", "mướp|luffa", "khổ qua|bitter melon", "xoài|mango", "đu đủ|papaya",
    "dứa|pineapple", "dưa hấu|watermelon", "chuối|banana", "bắp|corn", "ngô|corn",
    "đậu hũ|tofu", "đậu phụ|tofu", "đậu que|green beans", "bơ trái|avocado", "trái cây|fruit",
  ],
  meat_seafood: [
    "meat", "chicken", "chicken breast", "chicken thigh", "chicken wing", "beef", "ground beef",
    "pork", "ground pork", "pork belly", "pork chop", "lamb", "turkey", "duck", "bacon", "ham",
    "sausage", "chinese sausage", "steak", "mince", "rib", "short rib", "fish", "salmon", "tuna",
    "cod", "tilapia", "catfish", "mackerel", "anchovy", "shrimp", "prawn", "crab", "lobster",
    "squid", "octopus", "scallop", "clam", "mussel", "oyster", "fish ball", "fish cake",
    "beef ball", "meatball", "seafood",
    // Vietnamese
    "thịt|meat", "thịt bò|beef", "bò viên|beef balls", "thịt heo|pork", "thịt lợn|pork",
    "heo|pork", "thịt gà|chicken", "gà|chicken", "thịt băm|ground meat", "thịt xay|ground meat",
    "ba chỉ|pork belly", "sườn|ribs", "vịt|duck", "cá|fish", "cá hồi|salmon", "tôm|shrimp",
    "mực|squid", "cua|crab", "nghêu|clams", "sò|clams", "chả lụa|pork roll", "giò lụa|pork roll",
    "chả cá|fish cake", "lạp xưởng|chinese sausage", "xúc xích|sausage", "hải sản|seafood",
  ],
  dairy_eggs: [
    "milk", "whole milk", "cheese", "cream cheese", "butter", "yogurt", "yoghurt", "cream",
    "heavy cream", "sour cream", "whipping cream", "half and half", "egg", "duck egg", "ghee",
    "parmesan", "mozzarella", "cheddar", "feta", "kefir", "oat milk", "soy milk", "almond milk",
    // Vietnamese
    "sữa|milk", "sữa tươi|milk", "sữa chua|yogurt", "phô mai|cheese", "trứng|eggs",
    "trứng gà|eggs", "trứng vịt|duck eggs", "trứng cút|quail eggs", "bơ lạt|butter",
  ],
  rice_noodles_grains: [
    "rice", "jasmine rice", "basmati", "basmati rice", "sticky rice", "glutinous rice",
    "brown rice", "sushi rice", "noodle", "rice noodle", "egg noodle", "glass noodle",
    "vermicelli", "rice vermicelli", "ramen", "udon", "soba", "lo mein", "pasta", "spaghetti",
    "macaroni", "penne", "oat", "oatmeal", "quinoa", "bread", "baguette", "tortilla", "bagel",
    "cereal", "granola", "couscous", "barley", "rice paper", "spring roll wrapper",
    "dumpling wrapper", "wonton wrapper", "panko", "breadcrumb", "bun",
    // Vietnamese
    "gạo|rice", "gạo nếp|sticky rice", "nếp|sticky rice", "bánh phở|rice noodles",
    "phở khô|dried rice noodles", "bún|rice vermicelli", "miến|glass noodles",
    "hủ tiếu|rice noodles", "mì|noodles", "mì gói|instant noodles", "mì trứng|egg noodles",
    "bánh tráng|rice paper", "bánh mì|baguette", "bánh canh|thick noodles",
    "bánh hỏi|fine vermicelli", "bánh đa|rice crackers",
  ],
  sauces_condiments: [
    "sauce", "soy sauce", "dark soy sauce", "light soy sauce", "fish sauce", "oyster sauce",
    "hoisin", "hoisin sauce", "sriracha", "hot sauce", "chili sauce", "sweet chili sauce",
    "chili garlic sauce", "black bean sauce", "plum sauce", "ketchup", "mustard", "mayo",
    "mayonnaise", "kewpie", "vinegar", "rice vinegar", "black vinegar", "oil", "olive oil",
    "sesame oil", "vegetable oil", "canola oil", "cooking oil", "chili oil", "chili crisp",
    "sambal", "sambal oelek", "gochujang", "doenjang", "miso", "shrimp paste", "curry paste",
    "dressing", "salsa", "mirin", "cooking wine", "rice wine", "shaoxing wine", "tahini",
    "worcestershire", "ponzu", "teriyaki", "tamari", "honey", "maple syrup", "syrup",
    // Vietnamese
    "nước mắm|fish sauce", "nước tương|soy sauce", "xì dầu|soy sauce", "tương|bean sauce",
    "tương ớt|chili sauce", "tương đen|hoisin", "dầu hào|oyster sauce", "mắm|fermented fish sauce",
    "mắm tôm|shrimp paste", "mắm ruốc|shrimp paste", "mắm nêm|anchovy sauce",
    "sa tế|chili satay", "nước màu|caramel sauce", "dầu ăn|cooking oil", "dầu mè|sesame oil",
    "dầu điều|annatto oil", "giấm|vinegar", "dấm|vinegar", "mật ong|honey",
  ],
  spices_seasonings: [
    "salt", "pepper", "black pepper", "white pepper", "peppercorn", "cumin", "paprika",
    "turmeric", "cinnamon", "star anise", "five spice", "chinese five spice", "curry powder",
    "chili powder", "chili flake", "red pepper flake", "garlic powder", "onion powder", "msg",
    "oregano", "dried thyme", "bay leaf", "bay leaves", "clove", "cardamom", "coriander", "coriander seed",
    "nutmeg", "bouillon", "stock cube", "chicken powder", "seasoning", "spice", "dashi",
    "furikake", "sichuan pepper", "fennel seed", "sesame seed",
    // Vietnamese
    "muối|salt", "tiêu|pepper", "hạt tiêu|pepper", "hạt nêm|seasoning powder", "bột ngọt|msg",
    "mì chính|msg", "hồi|star anise", "quế|cinnamon", "ngũ vị hương|five spice", "nghệ|turmeric",
    "bột nghệ|turmeric", "ớt bột|chili powder", "bột cà ri|curry powder", "gia vị|seasoning",
    "mè|sesame seeds", "vừng|sesame seeds", "hành phi|fried shallots", "tỏi phi|fried garlic",
  ],
  canned_jarred: [
    "coconut milk", "coconut cream", "tomato paste", "crushed tomato", "peanut butter", "jam",
    "jelly", "pickle", "kimchi", "olive", "chicken stock", "chicken broth", "beef broth",
    "vegetable broth", "broth", "stock", "bamboo shoot", "water chestnut", "bean", "black bean",
    "chickpea", "lentil", "pickled mustard green", "nutella",
    // Vietnamese
    "nước cốt dừa|coconut milk", "dưa chua|pickled greens", "dưa cải|pickled mustard greens",
    "cá hộp|canned fish", "pate|pâté", "măng|bamboo shoots",
  ],
  baking: [
    "flour", "all purpose flour", "bread flour", "rice flour", "glutinous rice flour", "sugar",
    "brown sugar", "powdered sugar", "icing sugar", "palm sugar", "rock sugar", "baking soda",
    "baking powder", "yeast", "cornstarch", "corn starch", "tapioca starch", "tapioca flour",
    "potato starch", "vanilla", "vanilla extract", "cocoa", "cocoa powder", "chocolate chip",
    "condensed milk", "evaporated milk", "gelatin", "agar",
    // Vietnamese
    "bột|flour", "bột mì|flour", "bột gạo|rice flour", "bột nếp|glutinous rice flour",
    "bột năng|tapioca starch", "bột bắp|cornstarch", "đường|sugar", "đường phèn|rock sugar",
    "đường thốt nốt|palm sugar", "sữa đặc|condensed milk", "bột rau câu|agar",
  ],
  snacks_sweets: [
    "chip", "crisp", "potato chip", "cookie", "cookies", "brownies", "biscuit", "cracker", "candy", "chocolate",
    "ice cream", "popcorn", "pretzel", "nut", "peanut", "cashew", "almond", "walnut",
    "granola bar", "snack", "dessert", "cake", "mochi", "pocky", "seaweed snack", "dried fruit",
    "shrimp cracker",
    // Vietnamese
    "bánh|cakes", "bánh quy|cookies", "bánh ngọt|pastries", "bánh flan|flan", "kẹo|candy",
    "mứt|candied fruit", "chè|sweet soup", "đậu phộng|peanuts", "lạc|peanuts",
    "hạt điều|cashews", "bánh phồng tôm|shrimp crackers", "kem|ice cream",
  ],
  drinks: [
    "water", "sparkling water", "juice", "orange juice", "soda", "coke", "coffee", "tea",
    "green tea", "milk tea", "beer", "wine", "kombucha", "coconut water", "lemonade",
    "sake", "soju", "whiskey", "vodka",
    // Vietnamese
    "nước|water", "nước suối|bottled water", "nước ngọt|soda", "nước dừa|coconut water",
    "nước cam|orange juice", "trà|tea", "cà phê|coffee", "bia|beer", "rượu|liquor",
  ],
  leftovers: [
    "soup", "stew", "curry", "chili con carne", "fried rice", "casserole", "lasagna", "congee",
    "takeout", "dumpling",
    // Vietnamese
    "phở|pho", "phở bò|beef pho", "phở gà|chicken pho", "bún bò|bun bo", "bún bò huế|bun bo hue",
    "cơm|cooked rice", "cơm chiên|fried rice", "canh|soup", "cháo|congee", "thịt kho|braised pork",
    "cá kho|braised fish", "cà ri|curry", "lẩu|hot pot",
  ],
};

interface Keyword {
  tokens: string[];
  category: ItemCategory;
  priority: boolean;
  gloss?: string;
}

/** The same folding as a name: accents, case, punctuation and simple plurals. */
const tokensOf = (text: string): string[] => foldText(text).split(" ").filter(Boolean).map(singularWord);

function compile(): Keyword[] {
  const out: Keyword[] = [];
  const add = (category: ItemCategory, words: string[], priority: boolean) => {
    for (const w of words) {
      const [word, gloss] = w.split("|");
      out.push({ tokens: tokensOf(word), category, priority, ...(gloss ? { gloss } : {}) });
    }
  };
  for (const [c, words] of Object.entries(PRIORITY)) add(c as ItemCategory, words, true);
  for (const [c, words] of Object.entries(KEYWORDS)) add(c as ItemCategory, words, false);
  return out;
}
const COMPILED = compile();

interface Hit {
  kw: Keyword;
  start: number;
  end: number;
}

function hits(tokens: string[]): Hit[] {
  const found: Hit[] = [];
  for (const kw of COMPILED) {
    const n = kw.tokens.length;
    if (n === 0) continue;
    for (let i = 0; i + n <= tokens.length; i++) {
      if (kw.tokens.every((t, j) => tokens[i + j] === t)) found.push({ kw, start: i, end: i + n });
    }
  }
  return found;
}

export interface CategoryGuess {
  category: ItemCategory;
  /** False = nothing matched, so it's `other` with low confidence. */
  matched: boolean;
}

/** The kitchen's keyword guess for a name (as said or standard). Deterministic. */
export function guessCategory(name: string): CategoryGuess {
  const found = hits(tokensOf(name));
  if (found.length === 0) return { category: "other", matched: false };
  const pool = found.some((h) => h.kw.priority) ? found.filter((h) => h.kw.priority) : found;
  const best = pool.reduce((a, b) =>
    b.kw.tokens.length > a.kw.tokens.length || (b.kw.tokens.length === a.kw.tokens.length && b.end > a.end) ? b : a,
  );
  return { category: best.kw.category, matched: true };
}

/** `guessCategory` as a fact: `inferred`, medium when a word matched, else `other` / low. */
export function guessCategoryFact(name: string): Fact<ItemCategory> {
  const g = guessCategory(name);
  const confidence: Confidence = g.matched ? "medium" : "low";
  return { value: g.category, basis: "inferred", confidence };
}

/**
 * English glosses of the Vietnamese words in a name ("nước mắm" → ["fish sauce"]), for search.
 * Only the longest phrases count: "nước mắm" glosses as "fish sauce", not also "water".
 */
export function englishGlosses(name: string): string[] {
  const found = hits(tokensOf(name));
  const inside = (a: Hit, b: Hit) => b !== a && b.start <= a.start && b.end >= a.end && b.end - b.start > a.end - a.start;
  const out = new Set<string>();
  for (const h of found) if (h.kw.gloss && !found.some((b) => inside(h, b))) out.add(h.kw.gloss);
  return [...out];
}
