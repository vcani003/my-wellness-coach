CREATE TABLE "staples" (
	"kitchen_id" text NOT NULL,
	"standard_name" text NOT NULL,
	"name" jsonb NOT NULL,
	"store" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "staples_kitchen_id_standard_name_pk" PRIMARY KEY("kitchen_id","standard_name")
);
--> statement-breakpoint
ALTER TABLE "staples" ADD CONSTRAINT "staples_kitchen_id_kitchens_id_fk" FOREIGN KEY ("kitchen_id") REFERENCES "public"."kitchens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- 0054 Smart staples (additive only, 0028): one new, empty table; no data is rewritten. Numbered
-- 0014 because 0013 is taken by the unmerged ai/idea-refine branch. Old "Staples: …" preference
-- lines are never moved here by a migration: they're offered back once, and move only on a tap (SS2).
SELECT 1;