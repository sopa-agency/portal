/**
 * Cria a SplitConfigCache por SQL direcionado (db push derrapa neste banco).
 *   dotenv -e .env.local -- node scripts/create-split-config-cache.cjs
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
prisma
  .$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SplitConfigCache" (
      "key"        TEXT PRIMARY KEY,
      "address"    TEXT NOT NULL,
      "chain"      TEXT,
      "recipients" JSONB NOT NULL,
      "syncedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)
  .then(() => console.log("SplitConfigCache ok"))
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
