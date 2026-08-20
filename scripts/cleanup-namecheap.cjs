/**
 * Drop the Namecheap charges that belong to OTHER projects (not SkateHive):
 *   2024-05 bookofstamp.art · 2024-10 gnars.pro · 2025-07 maguinha.cloud
 * Keeps only skatehive.app (2025-12 renewal) + Relate SEO @skatehive.app (2026).
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const OTHER_PROJECT_MONTHS = ["2024-05", "2024-10", "2025-07"];

async function main() {
  const cost = await prisma.fixedCost.findFirst({ where: { projectSlug: "skatehive", label: "Namecheap" } });
  if (!cost) { console.log("Namecheap cost não encontrado."); return prisma.$disconnect(); }
  const del = await prisma.fixedCostActual.deleteMany({ where: { costId: cost.id, month: { in: OTHER_PROJECT_MONTHS } } });
  await prisma.fixedCost.update({
    where: { id: cost.id },
    data: { notes: "skatehive.app (renovação Namecheap) + Relate SEO Monthly @skatehive.app. Domínios de outros projetos excluídos." },
  });
  const left = await prisma.fixedCostActual.findMany({ where: { costId: cost.id }, orderBy: { month: "asc" } });
  console.log(`Removidos ${del.count} meses de outros projetos. Restam ${left.length}:`);
  console.log(left.map((a) => `${a.month} $${a.amount}`).join(" · "));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
