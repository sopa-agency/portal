/**
 * Cria a RevenueReadCache por SQL direcionado.
 *
 * `prisma db push` derrapa neste banco (drift em InstagramPost), então tabela
 * nova entra à mão — mesmo caminho de TreasuryBalanceCache e WalletLogin.
 * Aditivo: só CREATE IF NOT EXISTS.
 *
 *   dotenv -e .env.local -- node scripts/create-revenue-cache.cjs
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "RevenueReadCache" (
      "key"        TEXT PRIMARY KEY,
      "address"    TEXT NOT NULL,
      "chain"      TEXT,
      "method"     TEXT NOT NULL,
      "revenueUsd" DOUBLE PRECISION NOT NULL,
      "count"      INTEGER NOT NULL,
      "series"     JSONB NOT NULL DEFAULT '[]',
      "truncated"  BOOLEAN NOT NULL DEFAULT false,
      "error"      TEXT,
      "syncedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "RevenueReadCache_address_idx" ON "RevenueReadCache" ("address");
  `);
  console.log("RevenueReadCache ok");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
