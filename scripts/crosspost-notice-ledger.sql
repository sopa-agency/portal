-- Ledger that makes cross-post notifications exactly-once without needing a
-- transaction on the app's database. See the CrossPostNotice model for why.
-- Additive: a new table, nothing existing is touched.
CREATE TABLE IF NOT EXISTS "CrossPostNotice" (
  "id"        TEXT PRIMARY KEY,
  "queueId"   TEXT NOT NULL,
  "kind"      TEXT NOT NULL,
  "payload"   JSONB NOT NULL,
  "sentAt"    TIMESTAMP(3),
  "attempts"  INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- The unique constraint IS the exactly-once mechanism: claiming is what grants
-- the right to send, so a retry can never produce a second notification.
CREATE UNIQUE INDEX IF NOT EXISTS "CrossPostNotice_queueId_kind_key"
  ON "CrossPostNotice" ("queueId", "kind");
CREATE INDEX IF NOT EXISTS "CrossPostNotice_sentAt_idx"
  ON "CrossPostNotice" ("sentAt");
