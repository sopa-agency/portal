const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const rows = await prisma.fixedCost.findMany({
    where: { projectSlug: "skatehive" },
    include: { _count: { select: { actuals: true } } },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Total FixedCost (skatehive): ${rows.length}`);
  for (const r of rows) {
    console.log(
      `- ${r.label} | id=${r.id} | variable=${r.variable} | base=$${r.amount} ${r.currency} | actuals=${r._count.actuals} | by=${r.createdBy ?? "?"} | ${r.createdAt.toISOString().slice(0, 16)}`,
    );
  }
  // also report the DB host so we confirm prod
  console.log("\nDB host:", (process.env.DATABASE_URL || "").replace(/:[^:@/]+@/, ":****@").split("@")[1]?.split("/")[0] ?? "?");
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
