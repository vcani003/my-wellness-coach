/**
 * Operation: a union keyed by `type` (backend-data.md §6).
 * Every operation also carries `common`: { opId, evidence?, corrects? }.
 */
import { z } from "zod";
import {
  BatchWhich,
  Id,
  Location,
  MealStatus,
  Quantity,
  RestrictionKind,
  ReviewKind,
  ShoppingSource,
  StockLevel,
  fact,
  optionalFact,
} from "./common";

/** `evidence` is the user's exact words; required for chat. `corrects` links the event this fixes. */
const common = {
  opId: Id,
  evidence: z.string().min(1).max(2000).optional(),
  corrects: Id.optional(),
};

/** `{itemId}` (exact) or `{name}` (as said; matched by the backend, 0011). */
export const ItemTarget = z.union([
  z.strictObject({ itemId: Id }),
  z.strictObject({ name: z.string().min(1).max(200) }),
]);
export type ItemTarget = z.infer<typeof ItemTarget>;

const itemName = z.string().min(1).max(200);

/**
 * An item, optionally narrowed to one of its open batches (0025): `{itemId, batchId}` exactly, or
 * `{itemId | name, which: "oldest" | "newest"}` ("the new eggs" → `{name: "eggs", which: "newest"}`).
 * Without a batch, each operation has its default (see backend-data.md §6): use takes the
 * oldest first.
 */
export const ItemBatchTarget = z.union([
  z.strictObject({ itemId: Id }),
  z.strictObject({ name: itemName }),
  z.strictObject({ itemId: Id, batchId: Id }),
  z.strictObject({ itemId: Id, which: BatchWhich }),
  z.strictObject({ name: itemName, which: BatchWhich }),
]);
export type ItemBatchTarget = z.infer<typeof ItemBatchTarget>;

/** Exactly one batch: by ID, or the oldest / newest open one. */
export const BatchTarget = z.union([
  z.strictObject({ itemId: Id, batchId: Id }),
  z.strictObject({ itemId: Id, which: BatchWhich }),
  z.strictObject({ name: itemName, which: BatchWhich }),
]);
export type BatchTarget = z.infer<typeof BatchTarget>;

export const MealTarget = z.strictObject({ mealId: Id });

/**
 * Plan or cook: a meal, or `{ideaId}` = the live meal chosen from that idea card. Lets "plan the
 * omelette" choose and plan in ONE change set (one receipt, one Undo); with no live meal for the
 * idea → UNKNOWN_TARGET. Put the `meal.choose` first in the same proposal.
 */
export const MealStepTarget = z.union([MealTarget, z.strictObject({ ideaId: Id })]);

export const ItemFields = z.object({
  name: fact(z.string().min(1).max(200)),
  quantity: optionalFact(Quantity),
  location: optionalFact(Location),
  frozen: optionalFact(z.boolean()),
  opened: optionalFact(z.boolean()),
  /** When the user says it happened ("yesterday"); ISO 8601. */
  occurredAt: optionalFact(z.iso.datetime({ offset: true })),
});
export type ItemFields = z.infer<typeof ItemFields>;

/** Fields `item.update` may set back to unknown. Never `name` (only the name is required, 0011). */
export const ClearableItemField = z.enum(["quantity", "location", "frozen", "opened", "occurredAt"]);
export type ClearableItemField = z.infer<typeof ClearableItemField>;

export const ItemAdd = z.object({
  ...common,
  type: z.literal("item.add"),
  fields: ItemFields,
});

/** Name changes apply to the item; every other field to one batch (default: the oldest open one). */
export const ItemUpdate = z.object({
  ...common,
  type: z.literal("item.update"),
  target: ItemBatchTarget,
  fields: ItemFields.partial(),
  clear: z.array(ClearableItemField).optional(),
});

/**
 * Without a batch: an amount comes off the oldest batch first (spilling into the next when the
 * units match), and `stock` applies to the whole item (Out closes every batch). With a batch:
 * only that batch (Out closes it; the item is Out once its last batch closes, 0011).
 */
export const ItemUse = z.object({
  ...common,
  type: z.literal("item.use"),
  target: ItemBatchTarget,
  fields: z.object({
    stock: optionalFact(StockLevel),
    amountUsed: optionalFact(Quantity),
  }),
});

export const ItemRemove = z.object({
  ...common,
  type: z.literal("item.remove"),
  target: ItemTarget,
  fields: z.object({ reason: optionalFact(z.string().max(500)) }).optional(),
});

/** "Those are gone" (0025): one batch closes. The item is Out once its last batch closes (0011). */
export const ItemBatchClose = z.object({
  ...common,
  type: z.literal("item.batch.close"),
  target: BatchTarget,
});

/**
 * "Still have them" (0025): the receipt's one-tap choice for an older batch. Records that it's
 * still there and dismisses the choice. Button only (not in the AI's schema).
 */
export const ItemBatchKeep = z.object({
  ...common,
  type: z.literal("item.batch.keep"),
  target: z.strictObject({ itemId: Id, batchId: Id }),
});

/**
 * "I defrosted the chicken" (0025, AI8). Sets the batch's "defrosted on" date (when the user said
 * it happened, else now) and `frozen: false`. Without a batch: the oldest frozen open batch,
 * else the oldest open one.
 */
export const ItemDefrost = z.object({
  ...common,
  type: z.literal("item.defrost"),
  target: ItemBatchTarget,
  fields: z.object({ defrostedOn: optionalFact(z.iso.datetime({ offset: true })) }).optional(),
});

/**
 * A dish the user names in chat that isn't on an idea card (MI1 Rec, 0013 M1: naming it counts as
 * choosing it): a new `chosen` meal with this title and no idea. `notes` are the user's own words
 * about it ("with coconut milk, lemongrass, kaffir lime leaves"), kept in the event for the recipe.
 */
export const NamedDish = z.strictObject({
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(2000).optional(),
});
export type NamedDish = z.infer<typeof NamedDish>;

export const MealChoose = z.object({
  ...common,
  type: z.literal("meal.choose"),
  target: z.union([z.strictObject({ ideaId: Id }), z.strictObject({ mealId: Id }), NamedDish]),
});

export const MealPlan = z.object({
  ...common,
  type: z.literal("meal.plan"),
  target: MealStepTarget,
});

export const MealTransition = z.object({
  ...common,
  type: z.literal("meal.transition"),
  target: MealStepTarget,
  to: MealStatus,
  /** After-cooking note; only with `to: "done"` (0013). Stored as said. */
  note: z.string().max(2000).optional(),
});

export const RecipeIngredient = z.object({
  name: z.string().min(1).max(200),
  /** As written in the recipe ("2", "1 cup"), kept as said (0015). Absent = not given. */
  amount: z.string().min(1).max(100).optional(),
  itemId: Id.optional(),
  /** An assumed basic such as salt (0019). */
  basic: z.boolean().optional(),
});
export type RecipeIngredient = z.infer<typeof RecipeIngredient>;

export const RecipeSave = z.object({
  ...common,
  type: z.literal("recipe.save"),
  target: MealTarget,
  source: z.enum(["user", "ai"]),
  text: z.string().max(20000),
  ingredients: z.array(RecipeIngredient).max(100),
  steps: z.array(z.string().max(2000)).max(100),
  basicsAssumed: z.array(z.string().max(200)).max(50),
});

export const ChecklistTick = z.object({
  ...common,
  type: z.literal("checklist.tick"),
  target: MealTarget,
  ingredient: z.string().min(1).max(200),
  ticked: z.boolean(),
});

/**
 * An entry in a To review card. `itemId` when it refers to a kitchen item; `shoppingItemId` when
 * it's waiting on the shopping list (the name is copied from the list).
 */
export const ReviewEntry = z.object({
  name: z.string().min(1).max(200),
  itemId: Id.optional(),
  shoppingItemId: Id.optional(),
});
export type ReviewEntry = z.infer<typeof ReviewEntry>;

/** A shopping-list entry to queue: the ID is enough, the backend takes the name from the list. */
export const ReviewShoppingEntry = z.strictObject({ shoppingItemId: Id });

/**
 * "Do later" on a sheet. With `mealId`: a meal's card (0013). Without: the shopping list's
 * "Done shopping" sheet (0027, ux.md §10), kind `add-to-kitchen`, every entry a list item.
 * There's one shopping-list card at a time; queuing again adds to it.
 */
export const ReviewQueue = z.object({
  ...common,
  type: z.literal("review.queue"),
  kind: ReviewKind,
  mealId: Id.optional(),
  items: z.array(z.union([ReviewShoppingEntry, ReviewEntry])).max(100),
});

/**
 * A chosen shopping-list item for "Done shopping", with kitchen facts it may add (the name comes
 * from the list). Declared before `ReviewResolve`, which reuses it.
 */
export const ShoppingDoneFields = ItemFields.pick({ quantity: true, location: true, frozen: true, opened: true }).partial();
export const ShoppingDoneItem = z.strictObject({ shoppingItemId: Id, fields: ShoppingDoneFields.optional() });

/**
 * Close a To review card. For a meal's card, the kitchen changes are item.* ops in the same
 * proposal. For a shopping-list card done, `items` are the chosen ones: they go through exactly
 * `shopping.done`'s rules, and the card closes only if they all go in (all or nothing).
 */
export const ReviewResolve = z.object({
  ...common,
  type: z.literal("review.resolve"),
  target: z.strictObject({ reviewId: Id }),
  outcome: z.enum(["done", "skipped"]),
  items: z.array(ShoppingDoneItem).min(1).max(100).optional(),
});

export const RestrictionFields = z.object({
  kind: RestrictionKind,
  subject: fact(z.string().min(1).max(200)),
  /** The person's own words (0019). Stored as said, only ever shown back. */
  note: optionalFact(z.string().max(1000)),
});

const restriction = {
  fields: RestrictionFields,
  /** Whose profile. Absent = the speaker. */
  forUserId: Id.optional(),
};

export const RestrictionAdd = z.object({
  ...common,
  ...restriction,
  type: z.literal("profile.restriction.add"),
});
export const RestrictionUpdate = z.object({
  ...common,
  ...restriction,
  type: z.literal("profile.restriction.update"),
});
export const RestrictionRemove = z.object({
  ...common,
  ...restriction,
  type: z.literal("profile.restriction.remove"),
});

/**
 * The owner confirms a restriction another member added for them (AI7, 0019): Settings' "Keep".
 * Only the owner may; already verified → a no-change. Button only in MVP 1 (not in the AI's schema).
 */
export const RestrictionVerify = z.object({
  ...common,
  type: z.literal("profile.restriction.verify"),
  target: z.strictObject({ restrictionId: Id }),
});

export const PreferenceSave = z.object({
  ...common,
  type: z.literal("profile.preference.save"),
  fields: z.object({ statement: fact(z.string().min(1).max(500)) }),
  /** The message where the user said "yes" to "Want me to remember that?" (0012). */
  confirmedByMessageId: Id,
});

export const PreferenceRemove = z.object({
  ...common,
  type: z.literal("profile.preference.remove"),
  fields: z.object({ statement: fact(z.string().min(1).max(500)) }),
});

// ─── Shopping list (0027, SL1–SL3) ───────────────────────────────────────────────────

/** `{shoppingItemId}` (exact) or `{name}` (as said; matched against items open on the list). */
export const ShoppingTarget = z.union([
  z.strictObject({ shoppingItemId: Id }),
  z.strictObject({ name: z.string().min(1).max(200) }),
]);
export type ShoppingTarget = z.infer<typeof ShoppingTarget>;

export const ShoppingFields = z.object({
  name: fact(z.string().min(1).max(200)),
  quantity: optionalFact(Quantity),
  /** Where to buy it ("MD Oriental", "Publix"), as said (SL1). Absent = "Anywhere". */
  store: optionalFact(z.string().min(1).max(100)),
});
export type ShoppingFields = z.infer<typeof ShoppingFields>;

/** Fields `shopping.update` may set back to unknown. Never `name`. */
export const ClearableShoppingField = z.enum(["quantity", "store"]);
export type ClearableShoppingField = z.infer<typeof ClearableShoppingField>;

/**
 * Put something on the list. If an item with the same standard name is already open on the
 * list, it merges: no duplicate, and a newly given store or quantity replaces the old one.
 */
export const ShoppingAdd = z.object({
  ...common,
  type: z.literal("shopping.add"),
  fields: ShoppingFields,
  /** Absent = "chat". */
  source: ShoppingSource.optional(),
});

/** "Move hoisin to Publix", "make it 2 lemongrass", a rename. */
export const ShoppingUpdate = z.object({
  ...common,
  type: z.literal("shopping.update"),
  target: ShoppingTarget,
  fields: ShoppingFields.partial(),
  clear: z.array(ClearableShoppingField).optional(),
});

/** Tick = "got it" (0027), not bought or used. Shared by the kitchen; who ticked is kept. */
export const ShoppingTick = z.object({
  ...common,
  type: z.literal("shopping.tick"),
  target: ShoppingTarget,
  ticked: z.boolean(),
});

export const ShoppingRemove = z.object({
  ...common,
  type: z.literal("shopping.remove"),
  target: ShoppingTarget,
});

/**
 * "Done shopping" (SL2). The chosen items must be open and ticked. Each one goes into the kitchen
 * with `item.add`'s rules (restocks a low/out item of the same name, else adds a new one; the
 * list's quantity is used unless `fields.quantity` is given) and leaves the list as moved.
 * Ticked items not chosen stay on the list. All or nothing within this operation.
 */
export const ShoppingDone = z.object({
  ...common,
  type: z.literal("shopping.done"),
  items: z.array(ShoppingDoneItem).min(1).max(100),
});

export const ChangesetRevert = z.object({
  ...common,
  type: z.literal("changeset.revert"),
  target: z.strictObject({ changeSetId: Id }),
});

export const Operation = z.discriminatedUnion("type", [
  ItemAdd,
  ItemUpdate,
  ItemUse,
  ItemRemove,
  ItemBatchClose,
  ItemBatchKeep,
  ItemDefrost,
  MealChoose,
  MealPlan,
  MealTransition,
  RecipeSave,
  ChecklistTick,
  ReviewQueue,
  ReviewResolve,
  RestrictionAdd,
  RestrictionUpdate,
  RestrictionRemove,
  RestrictionVerify,
  PreferenceSave,
  PreferenceRemove,
  ShoppingAdd,
  ShoppingUpdate,
  ShoppingTick,
  ShoppingRemove,
  ShoppingDone,
  ChangesetRevert,
]);
export type Operation = z.infer<typeof Operation>;
export type OperationType = Operation["type"];
export type OperationOf<T extends OperationType> = Extract<Operation, { type: T }>;

/** Operations that pasted text may produce (backend-data.md §6, §7); everything else needs typed evidence. */
export const PASTE_ALLOWED_OPERATION_TYPES = ["recipe.save", "shopping.add"] as const satisfies readonly OperationType[];

export const PROFILE_OPERATION_TYPES = [
  "profile.restriction.add",
  "profile.restriction.update",
  "profile.restriction.remove",
  "profile.restriction.verify",
  "profile.preference.save",
  "profile.preference.remove",
] as const satisfies readonly OperationType[];
