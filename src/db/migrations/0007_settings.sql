CREATE TABLE "deleted_users" (
	"id" text PRIMARY KEY NOT NULL,
	"deleted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile_restrictions" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "session_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Hand-written (drizzle-kit can't express these). Backfill: a restriction its owner added
-- themselves counts as verified (AI7). Rebuilding projections from events gives the same answer.
UPDATE "profile_restrictions" SET "verified_at" = "created_at" WHERE "created_by" = "user_id" AND "verified_at" IS NULL;
--> statement-breakpoint
-- A deleted person (D1) is never silently recreated: not by db:bootstrap, not by a seed.
CREATE OR REPLACE FUNCTION users_not_deleted() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM deleted_users WHERE id = NEW.id) THEN
    RAISE EXCEPTION 'user % deleted their data and cannot be recreated', NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER users_not_deleted_trg BEFORE INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION users_not_deleted();
