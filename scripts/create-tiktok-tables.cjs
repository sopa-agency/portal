/**
 * Create the "TikTokAccount" + "TikTokPost" tables via targeted SQL.
 *
 * `prisma db push` drifts on this DB (pre-existing InstagramPost drift), so new
 * tables are applied by hand — same approach as SopaBrief / HomepageConfig.
 * This is additive: it only CREATEs new tables + their indexes, never touches
 * existing tables.
 *
 * Run once per environment:
 *   dotenv -e .env.local -- node scripts/create-tiktok-tables.cjs   (dev)
 *   (prod: run the same against the production DATABASE_URL)
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "TikTokAccount" (
      "projectSlug"      TEXT PRIMARY KEY,
      "openId"           TEXT NOT NULL,
      "unionId"          TEXT,
      "username"         TEXT,
      "displayName"      TEXT,
      "avatarUrl"        TEXT,
      "scope"            TEXT NOT NULL,
      "accessToken"      TEXT NOT NULL,
      "accessExpiresAt"  TIMESTAMP(3) NOT NULL,
      "refreshToken"     TEXT NOT NULL,
      "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
      "audited"          BOOLEAN NOT NULL DEFAULT false,
      "status"           TEXT NOT NULL DEFAULT 'connected',
      "connectedBy"      TEXT,
      "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "TikTokPost" (
      "id"             TEXT PRIMARY KEY,
      "projectSlug"    TEXT NOT NULL,
      "title"          TEXT,
      "caption"        TEXT NOT NULL DEFAULT '',
      "videoUrl"       TEXT,
      "coverTimeMs"    INTEGER,
      "privacy"        TEXT NOT NULL DEFAULT 'SELF_ONLY',
      "disableComment" BOOLEAN NOT NULL DEFAULT false,
      "disableDuet"    BOOLEAN NOT NULL DEFAULT false,
      "disableStitch"  BOOLEAN NOT NULL DEFAULT false,
      "brandContent"   BOOLEAN NOT NULL DEFAULT false,
      "brandOrganic"   BOOLEAN NOT NULL DEFAULT false,
      "isAigc"         BOOLEAN NOT NULL DEFAULT false,
      "status"         TEXT NOT NULL DEFAULT 'draft',
      "reviewed"       BOOLEAN NOT NULL DEFAULT false,
      "reviewedBy"     TEXT,
      "scheduledFor"   TIMESTAMP(3),
      "attempts"       INTEGER NOT NULL DEFAULT 0,
      "publishId"      TEXT,
      "shareUrl"       TEXT,
      "error"          TEXT,
      "createdBy"      TEXT,
      "publishedAt"    TIMESTAMP(3),
      "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "TikTokPost_projectSlug_status_updatedAt_idx" ON "TikTokPost" ("projectSlug", "status", "updatedAt" DESC);`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "TikTokPost_status_scheduledFor_idx" ON "TikTokPost" ("status", "scheduledFor");`,
  );

  const [{ count }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "TikTokPost";`);
  console.log(`TikTokAccount + TikTokPost ready ✓ (queued posts: ${count})`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
