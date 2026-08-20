-- Lets the curation UI (on Vercel) see whether the host that actually publishes
-- (the Mac worker) is configured to write cross-post results back. Without this
-- signal a curator can approve a post, watch it go live, and never learn the
-- author was left unnotified.
--
-- Additive and nullable: safe on a live DB, reversible with
-- `ALTER TABLE "SchedulerLease" DROP COLUMN "crossPostReadyAt";`.
ALTER TABLE "SchedulerLease"
  ADD COLUMN IF NOT EXISTS "crossPostReadyAt" TIMESTAMP(3);
