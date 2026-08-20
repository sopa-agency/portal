const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const costs = await prisma.fixedCost.findMany({
    where: { projectSlug: "skatehive", label: { in: ["Vercel", "Pinata IPFS", "Namecheap"] } },
    include: { actuals: { orderBy: { month: "desc" } } },
  });
  for (const c of costs) {
    const sum = c.actuals.reduce((s, a) => s + a.amount, 0);
    const last6 = c.actuals.slice(0, 6);
    const avg = last6.reduce((s, a) => s + a.amount, 0) / (last6.length || 1);
    console.log(`${c.label}: ${c.actuals.length} meses · soma armazenada $${sum.toFixed(2)} · média 6m $${avg.toFixed(2)} · base $${c.amount}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
