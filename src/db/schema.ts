/**
 * Drizzle schema (backend-data.md §3, §4). The same schema and migrations run on PGlite
 * (local dev and tests) and, later, on Neon.
 *
 * - `events` is the append-only source of truth.
 * - Everything below "Projections" is a ready-made current-state copy, written in the same
 *   transaction as the events, and rebuildable from them (`rebuildProjections`).
 * - Statuses and kinds are plain `text`, not Postgres enums: the meal lifecycle lives in one
 *   transitions table in code (0013), so changing it needs no migration.
 * - Actor columns (`createdBy`, `actor_id` …) deliberately have no foreign key: a deleted member's
 *   rows stay and read back as a missing reference (D1 Rec, 0018).
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { Fact, Location, Msg, Quantity, StockLevel } from "@/contracts/common";
import type { RecipeIngredient, ReviewEntry } from "@/contracts/operations";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

const audit = {
  createdAt: ts("created_at").notNull(),
  createdBy: text("created_by").notNull(),
  updatedAt: ts("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
};

// ─── Shared: identity and membership ────────────────────────────────────────────────

/** Minimal placeholder. Better Auth's tables arrive with the sign-in milestone. */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  email: text("email").unique(),
  /** Tester agent account (0021): may only join `isTest` kitchens. */
  isTest: boolean("is_test").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const kitchens = pgTable("kitchens", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  isTest: boolean("is_test").notNull().default(false),
  /** Bumped once per change set that saved at least one event. Polled via `/version`. */
  version: integer("version").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    kitchenId: text("kitchen_id")
      .notNull()
      .references(() => kitchens.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.kitchenId, t.userId] }), index("memberships_user_idx").on(t.userId)],
);

// ─── Shared: the event store ──────────────────────────────────────────────────────────

export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    /** `kitchen:<id>` or `user:<id>` (profile). */
    stream: text("stream").notNull(),
    /** Position in the stream: 1, 2, 3… Never collides: writers lock the stream first. */
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    /** Payload schema version, so old events stay readable. */
    v: integer("v").notNull().default(1),
    actorId: text("actor_id").notNull(),
    via: text("via").notNull(),
    recordedAt: ts("recorded_at").notNull(),
    occurredAt: ts("occurred_at"),
    changeSetId: text("change_set_id").notNull(),
    sourceMessageId: text("source_message_id"),
    /** The change set this event undoes. */
    reverses: text("reverses"),
    /** The event this one fixes ("no, I froze the yogurt"). */
    corrects: text("corrects"),
    payload: jsonb("payload").notNull(),
  },
  (t) => [
    uniqueIndex("events_stream_seq_uq").on(t.stream, t.seq),
    index("events_change_set_idx").on(t.changeSetId),
    check("events_via_ck", sql`${t.via} in ('chat', 'button', 'system')`),
  ],
);

/**
 * One row per applied ProposedChange. It is the idempotency record (`proposalId`), the
 * "Since your last visit" feed, and the Undo ledger (which entities each change set touched).
 */
export const changeSets = pgTable(
  "change_sets",
  {
    id: text("id").primaryKey(),
    kitchenId: text("kitchen_id")
      .notNull()
      .references(() => kitchens.id, { onDelete: "cascade" }),
    proposalId: text("proposal_id").notNull(),
    actorId: text("actor_id").notNull(),
    via: text("via").notNull(),
    /** Kitchen version this change set produced; null when nothing was saved (all rejected). */
    version: integer("version"),
    /** Entity keys touched, e.g. `item:<id>`. Drives Undo conflicts and STALE_TARGET. */
    touched: jsonb("touched").$type<string[]>().notNull(),
    summaries: jsonb("summaries").$type<Msg[]>().notNull(),
    /** The stored result (without `state`), replayed on an idempotent retry. */
    result: jsonb("result").notNull(),
    revertsChangeSetId: text("reverts_change_set_id"),
    revertedByChangeSetId: text("reverted_by_change_set_id"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("change_sets_kitchen_proposal_uq").on(t.kitchenId, t.proposalId),
    index("change_sets_kitchen_version_idx").on(t.kitchenId, t.version),
  ],
);

// ─── Kitchen: meal ideas (not kitchen state) ─────────────────────────────────────────

/**
 * Meal idea cards, so "Choose" / "Add that" points at a real idea (0005). Not events: ideas
 * are suggestions, not facts about the kitchen.
 */
export const mealIdeas = pgTable(
  "meal_ideas",
  {
    id: text("id").primaryKey(),
    kitchenId: text("kitchen_id")
      .notNull()
      .references(() => kitchens.id, { onDelete: "cascade" }),
    setId: text("set_id").notNull(),
    name: text("name").notNull(),
    why: text("why").notNull(),
    uses: jsonb("uses").$type<string[]>().notNull(),
    missing: jsonb("missing").$type<string[]>().notNull(),
    basedOnVersion: integer("based_on_version").notNull(),
    assistantMessageId: text("assistant_message_id"),
    createdAt: ts("created_at").notNull(),
    createdBy: text("created_by").notNull(),
  },
  (t) => [index("meal_ideas_kitchen_idx").on(t.kitchenId)],
);

// ─── Projections: Kitchen ─────────────────────────────────────────────────────────────

export const items = pgTable(
  "items",
  {
    id: text("id").primaryKey(),
    kitchenId: text("kitchen_id")
      .notNull()
      .references(() => kitchens.id, { onDelete: "cascade" }),
    name: jsonb("name").$type<Fact<string>>().notNull(),
    standardName: text("standard_name").notNull(),
    quantity: jsonb("quantity").$type<Fact<Quantity>>(),
    location: jsonb("location").$type<Fact<Location>>(),
    frozen: jsonb("frozen").$type<Fact<boolean>>(),
    opened: jsonb("opened").$type<Fact<boolean>>(),
    /** `low` or `out`; null = unknown. `out` rows stay here for history and matching. */
    stock: jsonb("stock").$type<Fact<StockLevel>>(),
    occurredAt: jsonb("occurred_at").$type<Fact<string>>(),
    addedAt: ts("added_at").notNull(),
    lastUsedAt: ts("last_used_at"),
    ...audit,
  },
  (t) => [index("items_kitchen_idx").on(t.kitchenId, t.standardName)],
);

export const meals = pgTable(
  "meals",
  {
    id: text("id").primaryKey(),
    kitchenId: text("kitchen_id")
      .notNull()
      .references(() => kitchens.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** chosen | planned | cooking | done | cancelled; checked against the transitions table in code. */
    status: text("status").notNull(),
    ideaId: text("idea_id"),
    planPosition: integer("plan_position"),
    chosenAt: ts("chosen_at").notNull(),
    recipeId: text("recipe_id"),
    note: text("note"),
    cookedAt: ts("cooked_at"),
    ...audit,
  },
  (t) => [index("meals_kitchen_idx").on(t.kitchenId, t.status)],
);

/** Every saved version is kept; the meal points at the latest (`meals.recipe_id`). */
export const recipes = pgTable(
  "recipes",
  {
    id: text("id").primaryKey(),
    kitchenId: text("kitchen_id")
      .notNull()
      .references(() => kitchens.id, { onDelete: "cascade" }),
    mealId: text("meal_id").notNull(),
    version: integer("version").notNull(),
    source: text("source").notNull(),
    text: text("text").notNull(),
    ingredients: jsonb("ingredients").$type<RecipeIngredient[]>().notNull(),
    steps: jsonb("steps").$type<string[]>().notNull(),
    basicsAssumed: jsonb("basics_assumed").$type<string[]>().notNull(),
    ...audit,
  },
  (t) => [index("recipes_meal_idx").on(t.kitchenId, t.mealId)],
);

/** Shared ticks (0013, M6). A row exists only while ticked; who ticked = `updated_by`. */
export const checklistTicks = pgTable(
  "checklist_ticks",
  {
    kitchenId: text("kitchen_id")
      .notNull()
      .references(() => kitchens.id, { onDelete: "cascade" }),
    mealId: text("meal_id").notNull(),
    ingredientKey: text("ingredient_key").notNull(),
    ingredient: text("ingredient").notNull(),
    ...audit,
  },
  (t) => [primaryKey({ columns: [t.kitchenId, t.mealId, t.ingredientKey] })],
);

/** To review cards, fed by "Do later" (0013). */
export const reviews = pgTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    kitchenId: text("kitchen_id")
      .notNull()
      .references(() => kitchens.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    mealId: text("meal_id").notNull(),
    items: jsonb("items").$type<ReviewEntry[]>().notNull(),
    /** pending | done | skipped */
    status: text("status").notNull(),
    ...audit,
  },
  (t) => [index("reviews_kitchen_idx").on(t.kitchenId, t.status)],
);

/**
 * The shared shopping list (0027). Every item ever put on the list stays, with `status`
 * open | removed | moved, for history and Undo; KitchenState shows only the open ones.
 * Who ticked = `ticked_by` (shared ticks, like the recipe checklist).
 */
export const shoppingItems = pgTable(
  "shopping_items",
  {
    id: text("id").primaryKey(),
    kitchenId: text("kitchen_id")
      .notNull()
      .references(() => kitchens.id, { onDelete: "cascade" }),
    name: jsonb("name").$type<Fact<string>>().notNull(),
    standardName: text("standard_name").notNull(),
    quantity: jsonb("quantity").$type<Fact<Quantity>>(),
    /** Null = "Anywhere" (SL1). */
    store: jsonb("store").$type<Fact<string>>(),
    /** chat | staples | recipe | stock-offer */
    source: text("source").notNull(),
    position: integer("position").notNull(),
    /** open | removed | moved */
    status: text("status").notNull(),
    tickedAt: ts("ticked_at"),
    tickedBy: text("ticked_by"),
    movedToItemId: text("moved_to_item_id"),
    ...audit,
  },
  (t) => [index("shopping_items_kitchen_idx").on(t.kitchenId, t.status)],
);

// ─── Projections: shared profile ──────────────────────────────────────────────────────

/** Allergies and diets (0012, 0019). Saved only when said; the note is stored as said. */
export const profileRestrictions = pgTable(
  "profile_restrictions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    /** allergy | diet */
    kind: text("kind").notNull(),
    subject: jsonb("subject").$type<Fact<string>>().notNull(),
    subjectKey: text("subject_key").notNull(),
    note: jsonb("note").$type<Fact<string>>(),
    ...audit,
  },
  (t) => [index("profile_restrictions_user_idx").on(t.userId)],
);

/** Lasting preferences, saved only after "Want me to remember that?" → yes (0012). */
export const profilePreferences = pgTable(
  "profile_preferences",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    statement: jsonb("statement").$type<Fact<string>>().notNull(),
    statementKey: text("statement_key").notNull(),
    confirmedByMessageId: text("confirmed_by_message_id").notNull(),
    ...audit,
  },
  (t) => [index("profile_preferences_user_idx").on(t.userId)],
);

// ─── Shared: rate limits ──────────────────────────────────────────────────────────────

/**
 * Fixed-window counters (backend-data.md §7): chat messages per user per hour and per day, and
 * access-code attempts per IP and overall. `key` names the limit and who it's for (an IP is
 * stored only as a keyed hash). Old windows are pruned; nothing here is history.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: ts("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] }), index("rate_limits_window_idx").on(t.windowStart)],
);
