/**
 * Add the public-feed columns to "FarcasterTrailCast" via targeted SQL.
 *
 * `prisma db push` drifts on this DB, so schema changes are applied by hand —
 * same approach as HomepageConfig / OutreachContact / SopaBrief. Additive:
 * both columns are nullable or defaulted, existing rows keep working.
 *
 *   mediaJson — mídia normalizada pro timeline do site
 *   hidden    — moderação por post (default false = aparece)
 *
 * Run once per environment:
 *   dotenv -e .env.local -- node scripts/add-feed-columns.cjs
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  for (const [col, type] of [["mediaJson", "TEXT"], ["hidden", "BOOLEAN NOT NULL DEFAULT false"]]) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "FarcasterTrailCast" ADD COLUMN IF NOT EXISTS "${col}" ${type};`);
    console.log(`  FarcasterTrailCast.${col} ✓`);
  }
  const [n] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "FarcasterTrailCast" WHERE "hidden" = false;`);
  console.log(`\npronto ✓ · ${n.n} posts visíveis`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
