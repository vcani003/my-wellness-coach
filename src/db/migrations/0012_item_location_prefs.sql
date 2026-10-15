CREATE TABLE "item_location_prefs" (
	"kitchen_id" text NOT NULL,
	"standard_name" text NOT NULL,
	"location" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "item_location_prefs_kitchen_id_standard_name_pk" PRIMARY KEY("kitchen_id","standard_name")
);
--> statement-breakpoint
ALTER TABLE "item_location_prefs" ADD CONSTRAINT "item_location_prefs_kitchen_id_kitchens_id_fk" FOREIGN KEY ("kitchen_id") REFERENCES "public"."kitchens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- 0041 (additive only, 0028): a new table; no data is rewritten. Items saved before 0041 with no
-- place are sorted once, as an ordinary change set with Undo (src/domains/kitchen/sort-places.ts),
-- never by this migration.
SELECT 1;
