/**
 * Operation: a union keyed by `type` (backend-data.md §6).
 * Every operation also carries `common`: { opId, evidence?, corrects? }.
 */
import { z } from "zod";
import {
  Id,
  Location,
  MealStatus,
  Quantity,
  RestrictionKind,
  ReviewKind,
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

export const MealTarget = z.strictObject({ mealId: Id });

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

export const ItemUpdate = z.object({
  ...common,
  type: z.literal("item.update"),
  target: ItemTarget,
  fields: ItemFields.partial(),
  clear: z.array(ClearableItemField).optional(),
});

export const ItemUse = z.object({
  ...common,
  type: z.literal("item.use"),
  target: ItemTarget,
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

export const MealChoose = z.object({
  ...common,
  type: z.literal("meal.choose"),
  target: z.union([z.strictObject({ ideaId: Id }), z.strictObject({ mealId: Id })]),
});

export const MealPlan = z.object({
  ...common,
  type: z.literal("meal.plan"),
  target: MealTarget,
});

export const MealTransition = z.object({
  ...common,
  type: z.literal("meal.transition"),
  target: MealTarget,
  to: MealStatus,
  /** After-cooking note; only with `to: "done"` (0013). Stored as said. */
  note: z.string().max(2000).optional(),
});

export const RecipeIngredient = z.object({
  name: z.string().min(1).max(200),
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

/** An entry in a To review card. `itemId` when it refers to a kitchen item. */
export const ReviewEntry = z.object({
  name: z.string().min(1).max(200),
  itemId: Id.optional(),
});
export type ReviewEntry = z.infer<typeof ReviewEntry>;

export const ReviewQueue = z.object({
  ...common,
  type: z.literal("review.queue"),
  kind: ReviewKind,
  mealId: Id,
  items: z.array(ReviewEntry).max(100),
});

export const ReviewResolve = z.object({
  ...common,
  type: z.literal("review.resolve"),
  target: z.strictObject({ reviewId: Id }),
  outcome: z.enum(["done", "skipped"]),
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
  PreferenceSave,
  PreferenceRemove,
  ChangesetRevert,
]);
export type Operation = z.infer<typeof Operation>;
export type OperationType = Operation["type"];
export type OperationOf<T extends OperationType> = Extract<Operation, { type: T }>;

export const PROFILE_OPERATION_TYPES = [
  "profile.restriction.add",
  "profile.restriction.update",
  "profile.restriction.remove",
  "profile.preference.save",
  "profile.preference.remove",
] as const satisfies readonly OperationType[];
