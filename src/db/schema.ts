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
  bigint,
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
import type { Fact, ItemCategory, Location, Msg, Quantity, StockLevel } from "@/contracts/common";
import type { RecipeIngredient, ReviewEntry } from "@/contracts/operations";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

const audit = {
  createdAt: ts("created_at").notNull(),
  createdBy: text("created_by").notNull(),
  updatedAt: ts("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
};

// ─── Shared: identity and membership ────────────────────────────────────────────────

/**
 * People. Sign-in (backend-data.md §7): an interim access code (`ACCESS_CODES`) and/or a
 * passphrase chosen through an invite link (SU1 Rec).
 */
export const users = pgTable(
  "users",
  {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  email: text("email").unique(),
  /** Tester agent account (0021): may only join `isTest` kitchens. */
  isTest: boolean("is_test").notNull().default(false),
  /**
   * Session generation ("Sign out everywhere", 0017). Every session cookie carries the epoch it
   * was issued under; bumping this rejects all older cookies. Cookies from before 0007 count as 0.
   */
  sessionEpoch: integer("session_epoch").notNull().default(0),
  /**
   * The passphrase, scrambled: `scrypt$ln=17,r=8,p=1$<salt>$<hash>` (algorithm, its parameters, a
   * per-user salt, the result; `src/lib/auth/passphrase.ts`). Null = no passphrase (access code
   * only, or not set up yet). Never selected outside sign-in, never logged or returned.
   */
  passphraseHash: text("passphrase_hash"),
  createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    // Sign-in is by name + passphrase, so a name is unique (case-insensitive) among people who
    // can sign in that way. Partial: older rows, seeds and tests may share a display name.
    uniqueIndex("users_signin_name_uq").on(sql`lower(${t.displayName})`).where(sql`${t.passphraseHash} is not null`),
  ],
);

/**
 * People who deleted their data (D1, 0015). Only the ID and when: it keeps their old kitchen
 * changes labelled "a former member", and a trigger (migration 0007) stops the ID from being
 * created again by `db:bootstrap` or a still-listed access code.
 */
export const deletedUsers = pgTable("deleted_users", {
  id: text("id").primaryKey(),
  deletedAt: ts("deleted_at").notNull(),
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

/**
 * Invite and reset links (SU1 Rec; backend-data.md §7). Only an SHA-256 of the link's random
 * token is stored; the token itself appears once, in the link. Single use (`usedAt`), 24 hours.
 * - `join`: anyone holding the link creates a new account in `kitchenId` (account cap 4, 0006).
 * - `reset`: `targetUserId` (a member of `kitchenId`) sets a new passphrase.
 * Not history: an invite goes when its kitchen, its creator or its target is deleted.
 */
export const invites = pgTable(
  "invites",
  {
    id: text("id").primaryKey(),
    kitchenId: text("kitchen_id")
      .notNull()
      .references(() => kitchens.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Hex SHA-256 of the raw token. */
    tokenHash: text("token_hash").notNull(),
    /** join | reset */
    purpose: text("purpose").notNull(),
    targetUserId: text("target_user_id").references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    /** Who used it: the new account (join) or the target (reset). No FK: it's a record. */
    usedBy: text("used_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("invites_token_hash_uq").on(t.tokenHash),
    index("invites_kitchen_idx").on(t.kitchenId),
    check("invites_purpose_ck", sql`${t.purpose} in ('join', 'reset')`),
    check("invites_target_ck", sql`(${t.purpose} = 'reset') = (${t.targetUserId} is not null)`),
  ],
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
    /** Card order within the set (0, 1, 2…), so "the second one" resolves (0013). */
    position: integer("position").notNull().default(0),
    createdAt: ts("created_at").notNull(),
    createdBy: text("created_by").notNull(),
  },
  (t) => [
    index("meal_ideas_kitchen_idx").on(t.kitchenId),
    // "The cards this user was last shown": latest set per person in a kitchen.
    index("meal_ideas_shown_idx").on(t.kitchenId, t.createdBy, t.createdAt),
  ],
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
    /**
     * CAT1 (migration 0010, additive). Null = saved before categories: read as the kitchen's
     * guess (`effectiveCategory`), computed on read and never written back (0028).
     */
    category: jsonb("category").$type<Fact<ItemCategory>>(),
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

/**
 * Item batches (0025): older and newer eggs. One row per batch, open or closed (closed ones stay
 * for history). The `items` row stays the one thing on the Kitchen list; its quantity, location,
 * stock and age columns are derived from these rows and still written, so code that predates
 * batches keeps reading it (0028). Migration 0008 backfilled one batch per existing item, with the
 * item's own ID.
 */
export const itemBatches = pgTable(
  "item_batches",
  {
    id: text("id").notNull(),
    kitchenId: text("kitchen_id")
      .notNull()
      .references(() => kitchens.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    /** Order added within the item (0, 1, 2…). */
    position: integer("position").notNull(),
    addedAt: ts("added_at").notNull(),
    occurredAt: jsonb("occurred_at").$type<Fact<string>>(),
    quantity: jsonb("quantity").$type<Fact<Quantity>>(),
    location: jsonb("location").$type<Fact<Location>>(),
    frozen: jsonb("frozen").$type<Fact<boolean>>(),
    opened: jsonb("opened").$type<Fact<boolean>>(),
    stock: jsonb("stock").$type<Fact<StockLevel>>(),
    defrostedOn: jsonb("defrosted_on").$type<Fact<string>>(),
    lastUsedAt: ts("last_used_at"),
    keptAt: ts("kept_at"),
    /** Set once closed: used up, "Those are gone", or replaced by a 4th batch. */
    closedAt: ts("closed_at"),
    closedReason: text("closed_reason"),
    ...audit,
  },
  (t) => [primaryKey({ columns: [t.kitchenId, t.id] }), index("item_batches_item_idx").on(t.kitchenId, t.itemId)],
);

/**
 * Categories the user said, remembered per kitchen by standard name (CAT1): "fish sauce goes
 * under sauces" makes later adds of fish sauce default to it. From `item.category.remembered`.
 */
export const itemCategoryPrefs = pgTable(
  "item_category_prefs",
  {
    kitchenId: text("kitchen_id")
      .notNull()
      .references(() => kitchens.id, { onDelete: "cascade" }),
    standardName: text("standard_name").notNull(),
    /** An `ItemCategory` ID. */
    category: text("category").notNull(),
    ...audit,
  },
  (t) => [primaryKey({ columns: [t.kitchenId, t.standardName] })],
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
    /** meal | shopping-list (0027). Added in 0004 with a default, so existing rows read as "meal". */
    origin: text("origin").notNull().default("meal"),
    /**
     * The meal's ID; '' for a shopping-list card. Kept NOT NULL so migration 0004 stays additive
     * only (0028); the store maps '' to "no meal".
     */
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
    /**
     * When the owner confirmed it (AI7, 0019): set when they add it themselves, edit its note, or
     * tap Keep. Null = added by another member and not yet verified ("Added by Vero").
     */
    verifiedAt: ts("verified_at"),
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

// ─── Chat: messages (P2 a) ─────────────────────────────────────────────────────────────

/**
 * Chat messages, so a conversation survives a reload and the interpreter's recent turns come
 * from the server, not the client (backend-data.md §6). **Private per person** (H2, 0017): every
 * read filters by user and kitchen. Not kitchen state and not events: a delete removes them (0015).
 * Text is stored exactly as typed or pasted and is only ever shown as plain text.
 */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    /** Insertion order: the history cursor. Strictly increasing, unlike timestamps. */
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    kitchenId: text("kitchen_id")
      .notNull()
      .references(() => kitchens.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** user | assistant */
    role: text("role").notNull(),
    text: text("text").notNull(),
    /** The turn's client-made ID; one row per role per turn, so a retry saves nothing twice. */
    clientMessageId: text("client_message_id").notNull(),
    /** The turn's change set, if it applied anything (assistant rows only). */
    changeSetId: text("change_set_id"),
    /** The ApplyResult without `state`, so a reloaded receipt can show "What changed". */
    receipt: jsonb("receipt"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("chat_messages_turn_uq").on(t.kitchenId, t.userId, t.clientMessageId, t.role),
    index("chat_messages_history_idx").on(t.kitchenId, t.userId, t.seq),
    check("chat_messages_role_ck", sql`${t.role} in ('user', 'assistant')`),
  ],
);
