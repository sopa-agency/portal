/**
 * Restore the real (signed) Vercel values for the refund/credit months that the
 * initial import clamped to $0, attach explanatory notes, and mark every logged
 * month as paid (past invoices are settled).
 *
 * Run: npx dotenv -e .env.local -- node scripts/patch-vercel-refunds.cjs
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const FIXES = {
  Vercel: {
    "2025-03": { amount: -0.65, note: "Crédito/ajuste (líquido negativo no mês)" },
    "2026-01": { amount: 0.0, note: "Fatura neutralizada por crédito (líquido $0)" },
    "2026-06": { amount: -63.5, note: "Cobrança $101.52 estornada + refund $63.50 (crédito líquido)" },
  },
};

async function main() {
  // 1) Mark ALL logged actuals on SkateHive infra as paid (past = settled).
  const costs = await prisma.fixedCost.findMany({
    where: { projectSlug: "skatehive", label: { in: ["Vercel", "Pinata IPFS", "Namecheap"] } },
  });
  const ids = costs.map((c) => c.id);
  const paid = await prisma.fixedCostActual.updateMany({ where: { costId: { in: ids } }, data: { paid: true } });
  console.log(`✓ marcados como pagos: ${paid.count} meses`);

  // 2) Apply the signed refund/credit values + notes.
  for (const [label, months] of Object.entries(FIXES)) {
    const cost = costs.find((c) => c.label === label);
    if (!cost) { console.warn(`(pulei ${label}: não encontrado)`); continue; }
    for (const [month, { amount, note }] of Object.entries(months)) {
      await prisma.fixedCostActual.upsert({
        where: { costId_month: { costId: cost.id, month } },
        create: { costId: cost.id, month, amount, currency: "USD", note, paid: true, createdBy: "import" },
        update: { amount, note, paid: true },
      });
      console.log(`  ${label} ${month} → $${amount} (${note})`);
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
