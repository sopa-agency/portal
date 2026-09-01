/**
 * Cria a tabela "AppIdea" (pedidos de app enviados pelo /app-idea), por SQL
 * direcionado.
 *
 * `prisma db push` derrapa neste banco (drift pré-existente em InstagramPost),
 * então tabela nova entra à mão — mesmo caminho de SopaBrief / ChatConversation.
 * Tudo aqui é ADITIVO: só CREATE TABLE/INDEX IF NOT EXISTS. Nunca DROP, nunca
 * ALTER destrutivo — este script roda contra o banco de PRODUÇÃO.
 *
 * Rodar uma vez por ambiente:
 *   dotenv -e .env.local -- node scripts/create-app-idea.cjs
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AppIdea" (
      "id"              TEXT PRIMARY KEY,
      "name"            TEXT NOT NULL,
      "contact"         TEXT NOT NULL,
      "kind"            TEXT NOT NULL,
      "audience"        TEXT NOT NULL,
      "existing"        TEXT NOT NULL,
      "urgency"         TEXT NOT NULL,
      "budget"          TEXT NOT NULL,
      "pitch"           TEXT NOT NULL,
      "successCriteria" TEXT NOT NULL,
      "references"      TEXT NOT NULL DEFAULT '',
      "status"          TEXT NOT NULL DEFAULT 'new',
      "ipHash"          TEXT,
      "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // A fila de triagem lê por status + data; o anti-abuso conta por origem numa
  // janela de tempo. Dois acessos diferentes, dois índices.
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "AppIdea_status_createdAt_idx" ON "AppIdea" ("status", "createdAt");`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "AppIdea_ipHash_createdAt_idx" ON "AppIdea" ("ipHash", "createdAt");`,
  );

  const [{ count }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "AppIdea";`);
  console.log(`AppIdea pronta ✓ (linhas: ${count})`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
