/**
 * Adiciona "kind" e "community" em FarcasterTrailCast via SQL direcionado.
 * (db:push drifta neste DB — mesmo caminho de HomepageConfig / SopaBrief.)
 *
 *   dotenv -e .env.local -- node scripts/add-feed-kind-columns.cjs
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  for (const col of ["kind", "community"]) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "FarcasterTrailCast" ADD COLUMN IF NOT EXISTS "${col}" TEXT;`);
    console.log(`  FarcasterTrailCast.${col} ✓`);
  }
  // Farcaster é sempre cast — dá pra classificar sem reconsultar a rede.
  const n = await prisma.$executeRawUnsafe(
    `UPDATE "FarcasterTrailCast" SET "kind" = 'cast' WHERE "platform" = 'farcaster' AND "kind" IS NULL;`,
  );
  console.log(`\ncasts classificados: ${n} · os do Hive dependem do indexador reconsultar o pai`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
