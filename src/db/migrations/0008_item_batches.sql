CREATE TABLE "item_batches" (
	"id" text NOT NULL,
	"kitchen_id" text NOT NULL,
	"item_id" text NOT NULL,
	"position" integer NOT NULL,
	"added_at" timestamp with time zone NOT NULL,
	"occurred_at" jsonb,
	"quantity" jsonb,
	"location" jsonb,
	"frozen" jsonb,
	"opened" jsonb,
	"stock" jsonb,
	"defrosted_on" jsonb,
	"last_used_at" timestamp with time zone,
	"kept_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "item_batches_kitchen_id_id_pk" PRIMARY KEY("kitchen_id","id")
);
--> statement-breakpoint
ALTER TABLE "item_batches" ADD CONSTRAINT "item_batches_kitchen_id_kitchens_id_fk" FOREIGN KEY ("kitchen_id") REFERENCES "public"."kitchens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_batches_item_idx" ON "item_batches" USING btree ("kitchen_id","item_id");--> statement-breakpoint
-- Hand-written backfill (0025, additive only, 0028): every existing item becomes ONE batch with the
-- item's own ID and facts; an Out item's batch is closed (used up). Replaying old events gives the
-- same rows (`legacyBatch` in src/domains/kitchen/batches.ts). The items columns are untouched,
-- so code from before batches still reads them. Safe to run again: existing rows are skipped.
INSERT INTO "item_batches" (
  "id", "kitchen_id", "item_id", "position", "added_at", "occurred_at", "quantity", "location",
  "frozen", "opened", "stock", "last_used_at", "closed_at", "closed_reason",
  "created_at", "created_by", "updated_at", "updated_by"
)
SELECT
  "id", "kitchen_id", "id", 0, "added_at", "occurred_at", "quantity", "location",
  "frozen", "opened", "stock", "last_used_at",
  CASE WHEN "stock"->>'value' = 'out' THEN "updated_at" END,
  CASE WHEN "stock"->>'value' = 'out' THEN 'used-up' END,
  "created_at", "created_by", "updated_at", "updated_by"
FROM "items"
ON CONFLICT DO NOTHING;
