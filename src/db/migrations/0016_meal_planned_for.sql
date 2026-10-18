ALTER TABLE "meals" ADD COLUMN "planned_for" date;--> statement-breakpoint
-- 0045 KOS1 dated week plan (additive only, 0028): one new, empty, nullable column; no data is
-- rewritten, so every existing planned meal stays undated. A calendar `date`, not a timestamp, so a
-- planned day can't shift across time zones or DST. Numbered 0016 because 0013 is taken by the
-- unmerged ai/idea-refine branch and 0014/0015 are used (0053 build order).
SELECT 1;
