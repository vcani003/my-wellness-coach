ALTER TABLE "meals" ADD COLUMN "cooked_by" text;--> statement-breakpoint
ALTER TABLE "meals" ADD COLUMN "note_by" text;--> statement-breakpoint
ALTER TABLE "meals" ADD COLUMN "made_again_from_meal_id" text;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "copied_from_recipe_id" text;--> statement-breakpoint
-- Recipe box (0040), additive only (0028): four nullable columns. The only data written is this
-- backfill, from the events, of the same values replaying them gives: who marked each Done meal
-- done (its latest `meal.transitioned` → done), and who wrote each saved after-cooking note (its
-- latest `meal.noted`, or a done transition carrying a note). A row an older build writes during
-- the switch-over leaves them null, which reads as the meal's `updated_by` / its cook.
UPDATE "meals" AS m SET "cooked_by" = (
	SELECT e."actor_id" FROM "events" AS e
	WHERE e."stream" = 'kitchen:' || m."kitchen_id"
		AND e."type" = 'meal.transitioned'
		AND e."payload"->>'mealId' = m."id"
		AND e."payload"->>'to' = 'done'
	ORDER BY e."seq" DESC LIMIT 1
) WHERE m."status" = 'done' AND m."cooked_by" IS NULL;--> statement-breakpoint
UPDATE "meals" AS m SET "note_by" = (
	SELECT e."actor_id" FROM "events" AS e
	WHERE e."stream" = 'kitchen:' || m."kitchen_id"
		AND e."payload"->>'mealId' = m."id"
		AND (e."type" = 'meal.noted' OR (e."type" = 'meal.transitioned' AND e."payload" ? 'note'))
	ORDER BY e."seq" DESC LIMIT 1
) WHERE m."note" IS NOT NULL AND m."note_by" IS NULL;
