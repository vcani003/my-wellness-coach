/**
 * Translatable system text (0015): `{ code, params, text }`, where `text` is the English
 * fallback. The UI translates by `code`; the templates here are the source English.
 */
import type { Msg } from "@/contracts/common";

type Params = Msg["params"];

const TEMPLATES: Record<string, string> = {
  // applied summaries
  ITEM_ADDED: "Added {name}",
  ITEM_RESTOCKED: "Added {name} (back in stock)",
  ITEM_ADDED_FROM_LIST: "Added {name} and took it off the shopping list",
  ITEM_RESTOCKED_FROM_LIST: "Added {name} (back in stock) and took it off the shopping list",
  ITEM_UPDATED: "Updated {name}",
  // IA6 (0036): a rename's own line. `from` is the old name, `name` the new one.
  ITEM_RENAMED: "Renamed {from} → {name}",
  ITEM_MOVED: "{name} → {location}",
  // categories (CAT1). `category` is the ID; `categoryName` the English name.
  ITEM_CATEGORY: "{name} → {categoryName}",
  CATEGORY_REMEMBERED: "I'll put {name} under {categoryName} from now on",
  // places (0041). `location` is the ID.
  PLACE_REMEMBERED: "I'll put {name} in the {location} from now on",
  ITEM_USED: "Used {name}",
  ITEM_LOW: "{name}: running low",
  ITEM_OUT: "{name}: out",
  // stock levels (0045 KOS4)
  ITEM_PLENTY: "{name}: plenty",
  ITEM_SOME: "{name}: some left",
  ITEM_RECORDED: "{name} wasn't in your kitchen, so I added it",
  ITEM_USED_RECORDED: "{name} wasn't in your kitchen; noted it as used",
  ITEM_REMOVED: "Removed {name}",
  ITEM_REMOVE_NOT_FOUND: "{name} wasn't in your kitchen",
  // batches (0025). ITEM_BATCH_ADDED's text is built in validate.ts ({name, batches, closedOldest, fromList}).
  ITEM_BATCH_ADDED: "Added {name} ({batches} batches)",
  ITEM_BATCH_USED_UP: "{name}: finished a batch ({left} left)",
  ITEM_BATCH_GONE: "{name}: those are gone ({left} left)",
  ITEM_BATCH_KEPT: "Kept the older {name}",
  ITEM_DEFROSTED: "{name}: defrosted",
  MEAL_CHOSEN: "Chose {title}",
  MEAL_PLANNED: "Added {title} to the meal plan",
  MEAL_STATUS: "{title}: {status}",
  MEAL_NOTE_SAVED: "Saved a note on {title}",
  RECIPE_SAVED: "Saved the recipe for {title}",
  MEAL_MADE_AGAIN: "Making {title} again",
  TICKED: "Ticked {ingredient}",
  UNTICKED: "Unticked {ingredient}",
  NO_CHANGE: "Nothing to change",
  REVIEW_QUEUED: "Saved for later in To review",
  REVIEW_RESOLVED: "Done with To review",
  RESTRICTION_ADDED: "Saved {name}'s {kind}: {subject}",
  RESTRICTION_UPDATED: "Updated {name}'s {kind}: {subject}",
  RESTRICTION_REMOVED: "Removed {name}'s {kind}: {subject}",
  RESTRICTION_VERIFIED: "Confirmed {name}'s {kind}: {subject}",
  FORMER_MEMBER_PROFILE: "Changed a former member's profile",
  PREFERENCE_SAVED: "I'll remember: {statement}",
  PREFERENCE_REMOVED: "Forgot: {statement}",
  UNDONE: "Undid that change",
  // notes (0010, 0019)
  BASICS_ASSUMED: "Assumes {basics}. Tell me if you don't have them.",
  // shopping list (0027)
  SHOPPING_ADDED: "Added {name} to the shopping list",
  SHOPPING_ADDED_STORE: "Added {name} to the shopping list ({store})",
  SHOPPING_ALREADY: "{name} is already on the shopping list",
  SHOPPING_STORE: "{name} → {store}",
  SHOPPING_UPDATED: "Updated {name} on the shopping list",
  SHOPPING_TICKED: "Got {name}",
  SHOPPING_UNTICKED: "Unticked {name}",
  SHOPPING_REMOVED: "Took {name} off the shopping list",
  SHOPPING_NOT_FOUND: "{name} isn't on the shopping list",
  SHOPPING_DONE: "Put {count} things from the shopping list in your kitchen: {names}",
  SHOPPING_REVIEW_QUEUED: "Saved for later in To review: {names}",
  // staples (0054)
  STAPLE_ADDED: "{name} is one of your staples now",
  STAPLE_ADDED_STORE: "{name} is one of your staples now ({store})",
  STAPLE_ALREADY: "{name} is already one of your staples",
  STAPLE_STORE: "{name}: usually from {store}",
  STAPLE_STORE_CLEARED: "{name}: from anywhere",
  STAPLE_REMOVED: "{name} isn't a staple any more",
  STAPLE_NOT_FOUND: "{name} isn't one of your staples",
  // rejections
  UNKNOWN_ITEM: "That item isn't in this kitchen",
  AMBIGUOUS_ITEM: "More than one item matches {name}",
  EVIDENCE_NOT_FOUND: "I couldn't find that in what you typed",
  NOT_SAID: "Allergies and diets are saved only when you say them",
  NOT_ALLOWED: "That isn't allowed",
  INVALID_TRANSITION: "{title} can't go from {from} to {to}",
  ALREADY_OUT: "{name} is already out",
  STALE_TARGET: "That changed since; please check and try again",
  UNKNOWN_TARGET: "I couldn't find that",
  UNDO_CONFLICT: "Can't undo this now: something changed it since. Tell me what to fix.",
  ALREADY_UNDONE: "That was already undone",
  INVALID_OPERATION: "That change doesn't make sense",
  UNDO_OF_UNDO: "An undo can't be undone; tell me what to fix",
  NOT_ON_LIST: "{name} isn't on the shopping list any more",
  NOT_TICKED: "{name} isn't ticked yet",
  ALREADY_MAKING: "{title} is already in your plan",
  RECIPE_LOCKED: "{title} is finished, so its recipe stays as it was. Make it again to change it.",
  // errors
  INVALID_PROPOSAL: "I couldn't understand that change, so nothing changed",
  SAVE_FAILED: "I couldn't save that, so nothing changed",
  RATE_LIMITED: "That's a lot of messages for now. Try again in {minutes} min.",
};

export function msg(code: string, params: Params = {}): Msg {
  const template = TEMPLATES[code] ?? code;
  const text = template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in params ? String(params[key]) : `{${key}}`,
  );
  return { code, params, text };
}
