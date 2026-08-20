/**
 * Remove os quote-casts já indexados do feed público.
 *
 * Quote é re-share do post de outra pessoa: não tem parent_hash (o filtro de
 * resposta não pega) e vem com um embed do tipo cast. Vários chegaram até com
 * texto vazio. O indexador agora barra na captura — isto limpa o passado.
 *
 * Só apaga linha SEM ação de trail vinculada, pra nunca mexer no histórico de
 * engajamento entre as marcas.
 *
 *   dotenv -e .env.local -- node scripts/purge-quote-casts.cjs [--dry]
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry");

async function main() {
  const rows = await prisma.farcasterTrailCast.findMany({
    where: { platform: "farcaster", embedsJson: { not: null } },
    select: { hash: true, authorSlug: true, text: true, embedsJson: true, actions: { select: { id: true } } },
  });

  const quotes = rows.filter((r) => {
    try {
      return JSON.parse(r.embedsJson).some((e) => e && (e.cast_id || e.cast));
    } catch {
      return false;
    }
  });

  const comAcao = quotes.filter((q) => q.actions.length > 0);
  const apagaveis = quotes.filter((q) => q.actions.length === 0);

  console.log(`quotes encontrados: ${quotes.length}`);
  for (const q of apagaveis) {
    console.log(`  @${q.authorSlug.padEnd(15)} ${q.hash.slice(0, 14)} ${q.text ? JSON.stringify(q.text.slice(0, 40)) : "(sem texto)"}`);
  }
  if (comAcao.length) console.log(`\n  preservados por terem ação de trail: ${comAcao.length}`);

  if (DRY) return console.log("\n(dry run — nada apagado)");
  const del = await prisma.farcasterTrailCast.deleteMany({ where: { hash: { in: apagaveis.map((q) => q.hash) } } });
  console.log(`\napagados: ${del.count} · restam no feed: ${await prisma.farcasterTrailCast.count()}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
