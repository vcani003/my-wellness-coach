ALTER TABLE "meal_ideas" ADD COLUMN "notes" text;--> statement-breakpoint
-- Refining a meal idea in chat (additive only, 0028): one nullable column, no data rewritten.
SELECT 1;
