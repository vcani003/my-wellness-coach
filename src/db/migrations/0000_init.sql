CREATE TABLE "change_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"kitchen_id" text NOT NULL,
	"proposal_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"via" text NOT NULL,
	"version" integer,
	"touched" jsonb NOT NULL,
	"summaries" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"reverts_change_set_id" text,
	"reverted_by_change_set_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_ticks" (
	"kitchen_id" text NOT NULL,
	"meal_id" text NOT NULL,
	"ingredient_key" text NOT NULL,
	"ingredient" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "checklist_ticks_kitchen_id_meal_id_ingredient_key_pk" PRIMARY KEY("kitchen_id","meal_id","ingredient_key")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"stream" text NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"v" integer DEFAULT 1 NOT NULL,
	"actor_id" text NOT NULL,
	"via" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"occurred_at" timestamp with time zone,
	"change_set_id" text NOT NULL,
	"source_message_id" text,
	"reverses" text,
	"corrects" text,
	"payload" jsonb NOT NULL,
	CONSTRAINT "events_via_ck" CHECK ("events"."via" in ('chat', 'button', 'system'))
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" text PRIMARY KEY NOT NULL,
	"kitchen_id" text NOT NULL,
	"name" jsonb NOT NULL,
	"standard_name" text NOT NULL,
	"quantity" jsonb,
	"location" jsonb,
	"frozen" jsonb,
	"opened" jsonb,
	"stock" jsonb,
	"occurred_at" jsonb,
	"added_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kitchens" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_ideas" (
	"id" text PRIMARY KEY NOT NULL,
	"kitchen_id" text NOT NULL,
	"set_id" text NOT NULL,
	"name" text NOT NULL,
	"why" text NOT NULL,
	"uses" jsonb NOT NULL,
	"missing" jsonb NOT NULL,
	"based_on_version" integer NOT NULL,
	"assistant_message_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meals" (
	"id" text PRIMARY KEY NOT NULL,
	"kitchen_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"idea_id" text,
	"plan_position" integer,
	"chosen_at" timestamp with time zone NOT NULL,
	"recipe_id" text,
	"note" text,
	"cooked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"kitchen_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_kitchen_id_user_id_pk" PRIMARY KEY("kitchen_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "profile_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"statement" jsonb NOT NULL,
	"statement_key" text NOT NULL,
	"confirmed_by_message_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_restrictions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"subject" jsonb NOT NULL,
	"subject_key" text NOT NULL,
	"note" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" text PRIMARY KEY NOT NULL,
	"kitchen_id" text NOT NULL,
	"meal_id" text NOT NULL,
	"version" integer NOT NULL,
	"source" text NOT NULL,
	"text" text NOT NULL,
	"ingredients" jsonb NOT NULL,
	"steps" jsonb NOT NULL,
	"basics_assumed" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"kitchen_id" text NOT NULL,
	"kind" text NOT NULL,
	"meal_id" text NOT NULL,
	"items" jsonb NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"is_test" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "change_sets" ADD CONSTRAINT "change_sets_kitchen_id_kitchens_id_fk" FOREIGN KEY ("kitchen_id") REFERENCES "public"."kitchens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_ticks" ADD CONSTRAINT "checklist_ticks_kitchen_id_kitchens_id_fk" FOREIGN KEY ("kitchen_id") REFERENCES "public"."kitchens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_kitchen_id_kitchens_id_fk" FOREIGN KEY ("kitchen_id") REFERENCES "public"."kitchens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_ideas" ADD CONSTRAINT "meal_ideas_kitchen_id_kitchens_id_fk" FOREIGN KEY ("kitchen_id") REFERENCES "public"."kitchens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meals" ADD CONSTRAINT "meals_kitchen_id_kitchens_id_fk" FOREIGN KEY ("kitchen_id") REFERENCES "public"."kitchens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_kitchen_id_kitchens_id_fk" FOREIGN KEY ("kitchen_id") REFERENCES "public"."kitchens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_kitchen_id_kitchens_id_fk" FOREIGN KEY ("kitchen_id") REFERENCES "public"."kitchens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_kitchen_id_kitchens_id_fk" FOREIGN KEY ("kitchen_id") REFERENCES "public"."kitchens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "change_sets_kitchen_proposal_uq" ON "change_sets" USING btree ("kitchen_id","proposal_id");--> statement-breakpoint
CREATE INDEX "change_sets_kitchen_version_idx" ON "change_sets" USING btree ("kitchen_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "events_stream_seq_uq" ON "events" USING btree ("stream","seq");--> statement-breakpoint
CREATE INDEX "events_change_set_idx" ON "events" USING btree ("change_set_id");--> statement-breakpoint
CREATE INDEX "items_kitchen_idx" ON "items" USING btree ("kitchen_id","standard_name");--> statement-breakpoint
CREATE INDEX "meal_ideas_kitchen_idx" ON "meal_ideas" USING btree ("kitchen_id");--> statement-breakpoint
CREATE INDEX "meals_kitchen_idx" ON "meals" USING btree ("kitchen_id","status");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "profile_preferences_user_idx" ON "profile_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "profile_restrictions_user_idx" ON "profile_restrictions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recipes_meal_idx" ON "recipes" USING btree ("kitchen_id","meal_id");--> statement-breakpoint
CREATE INDEX "reviews_kitchen_idx" ON "reviews" USING btree ("kitchen_id","status");