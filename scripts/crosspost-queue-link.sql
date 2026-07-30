-- Link a portal Instagram post back to the cross-post queue row it came from
-- (userbase_crosspost_queue, in the SkateHive app's Supabase).
--
-- Applied as targeted SQL because `prisma db push` trips on pre-existing drift
-- on this very table. Additive and nullable: safe on a live DB, and reversible
-- with `ALTER TABLE "InstagramPost" DROP COLUMN "crossPostQueueId";`.
ALTER TABLE "InstagramPost"
  ADD COLUMN IF NOT EXISTS "crossPostQueueId" TEXT;
