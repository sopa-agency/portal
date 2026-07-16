/**
 * Create the "OutreachContact" table via targeted SQL.
 *
 * `prisma db push` drifts on this DB (pre-existing InstagramPost drift), so new
 * tables are applied by hand — same approach as HomepageConfig. This is additive:
 * it only CREATEs a new table + its indexes, never touches existing tables.
 *
 * Run once per environment:
 *   dotenv -e .env.local -- node scripts/create-outreach-table.cjs   (dev)
 *   (prod: run the same against the production DATABASE_URL)
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "OutreachContact" (
      "id"           TEXT PRIMARY KEY,
      "campaignId"   TEXT NOT NULL REFERENCES "Campaign"("id") ON DELETE CASCADE,
      "email"        TEXT NOT NULL,
      "hiveUsername" TEXT,
      "status"       TEXT NOT NULL DEFAULT 'pending',
      "sentAt"       TIMESTAMP(3),
      "respondedAt"  TIMESTAMP(3),
      "error"        TEXT,
      "projectSlug"  TEXT NOT NULL DEFAULT 'skatehive',
      "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "OutreachContact_campaignId_email_key" ON "OutreachContact" ("campaignId", "email");`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "OutreachContact_campaignId_status_idx" ON "OutreachContact" ("campaignId", "status");`,
  );

  const [{ count }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "OutreachContact";`);
  console.log(`OutreachContact ready ✓ (rows: ${count})`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
