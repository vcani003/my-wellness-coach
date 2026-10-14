-- Database-level guards (backend-data.md §3, §7). Hand-written; drizzle-kit can't express triggers.

-- 1. Events are append-only: never updated. (Deletes stay possible for the privacy
--    exceptions in §7 and for wiping isTest kitchens.)
CREATE OR REPLACE FUNCTION events_no_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'events are append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER events_no_update_trg BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION events_no_update();
--> statement-breakpoint

-- 2. Tester accounts (0021) may only be members of isTest kitchens.
CREATE OR REPLACE FUNCTION memberships_tester_only_test_kitchens() RETURNS trigger AS $$
BEGIN
  IF (SELECT is_test FROM users WHERE id = NEW.user_id)
     AND NOT (SELECT is_test FROM kitchens WHERE id = NEW.kitchen_id) THEN
    RAISE EXCEPTION 'tester accounts may only join test kitchens';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER memberships_tester_only_test_kitchens_trg BEFORE INSERT OR UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION memberships_tester_only_test_kitchens();
