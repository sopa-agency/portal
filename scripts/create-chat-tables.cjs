/**
 * Cria as tabelas do /chat e a coluna AgentJob.partial, por SQL direcionado.
 *
 * `prisma db push` derrapa neste banco (drift pré-existente em InstagramPost),
 * então tabela nova entra à mão — mesmo caminho de SopaBrief / OutreachContact.
 * Tudo aqui é ADITIVO: só CREATE e ADD COLUMN IF NOT EXISTS, nunca mexe no que
 * já existe.
 *
 * Rodar uma vez por ambiente:
 *   dotenv -e .env.local -- node scripts/create-chat-tables.cjs      (dev)
 *   (prod: o mesmo, apontando para o DATABASE_URL de produção)
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  // A coluna que faz o streaming existir do outro lado do queue.
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "AgentJob" ADD COLUMN IF NOT EXISTS "partial" TEXT;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ChatConversation" (
      "id"          TEXT PRIMARY KEY,
      "projectSlug" TEXT NOT NULL,
      "username"    TEXT NOT NULL,
      "title"       TEXT NOT NULL DEFAULT '',
      "sessionKey"  TEXT NOT NULL,
      "pinned"      BOOLEAN NOT NULL DEFAULT false,
      "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ChatConversation_project_user_idx"
      ON "ChatConversation" ("projectSlug", "username", "updatedAt" DESC);
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ChatMessage" (
      "id"             TEXT PRIMARY KEY,
      "conversationId" TEXT NOT NULL REFERENCES "ChatConversation"("id") ON DELETE CASCADE,
      "role"           TEXT NOT NULL,
      "content"        TEXT NOT NULL,
      "error"          TEXT,
      "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ChatMessage_conversation_idx"
      ON "ChatMessage" ("conversationId", "createdAt");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ChatAttachment" (
      "id"             TEXT PRIMARY KEY,
      "conversationId" TEXT NOT NULL REFERENCES "ChatConversation"("id") ON DELETE CASCADE,
      "messageId"      TEXT REFERENCES "ChatMessage"("id") ON DELETE CASCADE,
      "name"           TEXT NOT NULL,
      "mimeType"       TEXT NOT NULL,
      "size"           INTEGER NOT NULL,
      "text"           TEXT,
      "data"           BYTEA,
      "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ChatAttachment_conversation_idx"
      ON "ChatAttachment" ("conversationId");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ChatAttachment_message_idx"
      ON "ChatAttachment" ("messageId");
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ChatAttachment" ADD COLUMN IF NOT EXISTS "token" TEXT NOT NULL DEFAULT '';
  `);

  console.log("ok — tabelas do chat, AgentJob.partial e ChatAttachment.token no lugar.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
