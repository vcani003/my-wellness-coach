ALTER TABLE "chat_messages" ADD COLUMN "pending_confirm" jsonb;--> statement-breakpoint
-- 0045 KOS16 (additive only, 0028): one new, empty, nullable column; no data is rewritten. A reply
-- that asks "That would remove 7 things: … Remove them all?" keeps the held change here, so a yes
-- applies exactly it. Numbered 0015 because 0013 is taken by the unmerged ai/idea-refine branch.
SELECT 1;
