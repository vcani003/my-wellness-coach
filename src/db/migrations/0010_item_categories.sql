CREATE TABLE "item_category_prefs" (
	"kitchen_id" text NOT NULL,
	"standard_name" text NOT NULL,
	"category" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "item_category_prefs_kitchen_id_standard_name_pk" PRIMARY KEY("kitchen_id","standard_name")
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "category" jsonb;--> statement-breakpoint
ALTER TABLE "item_category_prefs" ADD CONSTRAINT "item_category_prefs_kitchen_id_kitchens_id_fk" FOREIGN KEY ("kitchen_id") REFERENCES "public"."kitchens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- CAT1 (additive only, 0028): no data is rewritten. Items saved before this read as the kitchen's
-- keyword guess (`effectiveCategory`, src/domains/kitchen/categories.ts), computed on every read,
-- which is also what replaying their old events gives. An old build still running during the
-- switch-over simply leaves the new column null, which reads the same way.
SELECT 1;
