CREATE TABLE "shopping_items" (
	"id" text PRIMARY KEY NOT NULL,
	"kitchen_id" text NOT NULL,
	"name" jsonb NOT NULL,
	"standard_name" text NOT NULL,
	"quantity" jsonb,
	"store" jsonb,
	"source" text NOT NULL,
	"position" integer NOT NULL,
	"status" text NOT NULL,
	"ticked_at" timestamp with time zone,
	"ticked_by" text,
	"moved_to_item_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_kitchen_id_kitchens_id_fk" FOREIGN KEY ("kitchen_id") REFERENCES "public"."kitchens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shopping_items_kitchen_idx" ON "shopping_items" USING btree ("kitchen_id","status");