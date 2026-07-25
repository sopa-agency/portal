/**
 * Create the "SopaBrief" table via targeted SQL.
 *
 * `prisma db push` drifts on this DB (pre-existing InstagramPost drift), so new
 * tables are applied by hand — same approach as HomepageConfig / OutreachContact.
 * This is additive: it only CREATEs a new table + its index, never touches
 * existing tables.
 *
 * Run once per environment:
 *   dotenv -e .env.local -- node scripts/create-sopa-brief-table.cjs   (dev)
 *   (prod: run the same against the production DATABASE_URL)
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SopaBrief" (
      "id"        TEXT PRIMARY KEY,
      "name"      TEXT NOT NULL,
      "contact"   TEXT NOT NULL,
      "types"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      "budget"    TEXT,
      "deadline"  TEXT,
      "message"   TEXT NOT NULL,
      "handled"   BOOLEAN NOT NULL DEFAULT false,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "SopaBrief_createdAt_idx" ON "SopaBrief" ("createdAt");`,
  );

  const [{ count }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "SopaBrief";`);
  console.log(`SopaBrief ready ✓ (rows: ${count})`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
