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
  ITEM_UPDATED: "Updated {name}",
  ITEM_MOVED: "{name} → {location}",
  ITEM_USED: "Used {name}",
  ITEM_LOW: "{name}: running low",
  ITEM_OUT: "{name}: out",
  ITEM_RECORDED: "{name} wasn't in your kitchen, so I added it",
  ITEM_USED_RECORDED: "{name} wasn't in your kitchen; noted it as used",
  ITEM_REMOVED: "Removed {name}",
  ITEM_REMOVE_NOT_FOUND: "{name} wasn't in your kitchen",
  MEAL_CHOSEN: "Chose {title}",
  MEAL_PLANNED: "Added {title} to the meal plan",
  MEAL_STATUS: "{title}: {status}",
  MEAL_NOTE_SAVED: "Saved a note on {title}",
  RECIPE_SAVED: "Saved the recipe for {title}",
  TICKED: "Ticked {ingredient}",
  UNTICKED: "Unticked {ingredient}",
  NO_CHANGE: "Nothing to change",
  REVIEW_QUEUED: "Saved for later in To review",
  REVIEW_RESOLVED: "Done with To review",
  RESTRICTION_ADDED: "Saved {name}'s {kind}: {subject}",
  RESTRICTION_UPDATED: "Updated {name}'s {kind}: {subject}",
  RESTRICTION_REMOVED: "Removed {name}'s {kind}: {subject}",
  PREFERENCE_SAVED: "I'll remember: {statement}",
  PREFERENCE_REMOVED: "Forgot: {statement}",
  UNDONE: "Undid that change",
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
  // errors
  INVALID_PROPOSAL: "I couldn't understand that change, so nothing changed",
  SAVE_FAILED: "I couldn't save that, so nothing changed",
};

export function msg(code: string, params: Params = {}): Msg {
  const template = TEMPLATES[code] ?? code;
  const text = template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in params ? String(params[key]) : `{${key}}`,
  );
  return { code, params, text };
}
