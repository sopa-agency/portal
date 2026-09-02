/**
 * Cria as tabelas da votação de split por SQL direcionado.
 *
 * `prisma db push` derrapa neste banco (drift em InstagramPost) — mesmo caminho
 * de ChatConversation, WalletLogin e RevenueReadCache. Aditivo: só CREATE.
 *
 *   dotenv -e .env.local -- node scripts/create-split-vote.cjs
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SplitVoteRound" (
      "id"           TEXT PRIMARY KEY,
      "projectSlug"  TEXT NOT NULL,
      "label"        TEXT NOT NULL,
      "status"       TEXT NOT NULL DEFAULT 'open',
      "splitAddress" TEXT NOT NULL,
      "chain"        TEXT NOT NULL DEFAULT 'base',
      "openedBy"     TEXT NOT NULL,
      "openedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "closedAt"     TIMESTAMP(3)
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "SplitVoteRound_project_idx" ON "SplitVoteRound" ("projectSlug", "openedAt" DESC);
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SplitVoteBallot" (
      "id"        TEXT PRIMARY KEY,
      "roundId"   TEXT NOT NULL,
      "voter"     TEXT NOT NULL,
      "points"    JSONB NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "SplitVoteBallot_round_voter_key" ON "SplitVoteBallot" ("roundId", "voter");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "SplitVoteBallot_round_idx" ON "SplitVoteBallot" ("roundId");
  `);
  console.log("SplitVoteRound + SplitVoteBallot ok");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
