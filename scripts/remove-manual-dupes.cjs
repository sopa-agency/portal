/**
 * Keep only the agent-imported cost rows on SkateHive (the ones carrying real
 * monthly actuals) and drop the empty manual duplicates added during preview.
 * Safe: every imported cost has actuals; manual leftovers have 0.
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const rows = await prisma.fixedCost.findMany({
    where: { projectSlug: "skatehive" },
    include: { _count: { select: { actuals: true } } },
  });
  const empties = rows.filter((r) => r._count.actuals === 0);
  if (empties.length === 0) { console.log("Nada para remover."); return prisma.$disconnect(); }
  for (const r of empties) console.log(`removendo: ${r.label} (id=${r.id}, by=${r.createdBy ?? "?"})`);
  await prisma.fixedCost.deleteMany({ where: { id: { in: empties.map((r) => r.id) } } });

  const left = await prisma.fixedCost.findMany({
    where: { projectSlug: "skatehive" },
    include: { _count: { select: { actuals: true } } },
    orderBy: { label: "asc" },
  });
  console.log(`\nRestam ${left.length}:`);
  for (const r of left) console.log(`- ${r.label} | variable=${r.variable} | actuals=${r._count.actuals}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
