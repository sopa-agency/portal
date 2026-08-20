/**
 * One-off import of the SkateHive infra cost history (Vercel, Pinata, Namecheap)
 * into FixedCost + FixedCostActual. Each is a variable monthly cost; we log the
 * real billed amount per month. Blanks → $0; negative (credits) → $0 (cost ≥ 0).
 *
 * Run: npx dotenv -e .env.local -- node scripts/import-infra-costs.cjs
 * Idempotent: re-running upserts the same rows.
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const PROJECT = "skatehive";
const END = "2026-06";

const SERVICES = [
  {
    label: "Vercel",
    base: 20, // plan estimate for un-logged future months
    start: "2024-11",
    values: {
      "2024-11": 20.0, "2024-12": 20.65, "2025-01": 21.3, "2025-02": 23.3, "2025-03": -0.65,
      "2025-04": 21.65, "2025-05": 21.65, "2025-06": 21.65, "2025-07": 21.0, "2025-08": 36.91,
      "2025-09": 87.11, "2025-10": 123.5, "2025-11": 20.0, "2025-12": 32.0, "2026-01": 0.0,
      "2026-02": 20.0, "2026-03": 78.74, "2026-04": 26.21, "2026-05": 63.5, "2026-06": -63.5,
    },
  },
  {
    label: "Pinata IPFS",
    base: 20,
    start: "2023-10",
    values: {
      "2023-10": 20, "2023-11": 20, "2023-12": 20, "2024-01": 20, "2024-02": 20,
      "2024-04": 40, "2024-06": 59, "2024-07": 20, "2024-08": 34.3, "2024-09": 20,
      "2024-10": 33.2, "2024-11": 20, "2024-12": 20, "2025-01": 23.2, "2025-02": 31.5,
      "2025-03": 43.0, "2025-04": 54.4, "2025-05": 40.8, "2025-06": 36.5, "2025-07": 20,
      "2025-08": 20, "2025-09": 20.3, "2025-11": 33.3, "2025-12": 20, "2026-01": 20,
      "2026-02": 20, "2026-03": 20, "2026-04": 20, "2026-05": 20,
    },
  },
  {
    label: "Namecheap",
    base: 10,
    start: "2024-05",
    values: {
      "2024-05": 15.03, "2024-10": 3.16, "2025-07": 3.18, "2025-12": 28.06,
      "2026-01": 9.88, "2026-03": 9.88, "2026-04": 9.88, "2026-05": 9.88, "2026-06": 9.88,
    },
  },
];

function* monthRange(start, end) {
  let [y, m] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    yield `${y}-${String(m).padStart(2, "0")}`;
    if (++m > 12) { m = 1; y++; }
  }
}

async function main() {
  for (const s of SERVICES) {
    let cost = await prisma.fixedCost.findFirst({ where: { projectSlug: PROJECT, label: s.label } });
    const data = {
      amount: s.base, currency: "USD", cadence: "monthly", category: "infra", variable: true,
      notes: "Importado do histórico de faturas (créditos lançados como $0).",
    };
    cost = cost
      ? await prisma.fixedCost.update({ where: { id: cost.id }, data })
      : await prisma.fixedCost.create({ data: { projectSlug: PROJECT, label: s.label, createdBy: "import", ...data } });

    const recent = [];
    let count = 0;
    for (const month of monthRange(s.start, END)) {
      let v = s.values[month] ?? 0;
      if (v < 0) v = 0; // credits → 0 (amount must be ≥ 0)
      v = Math.round(v * 100) / 100;
      await prisma.fixedCostActual.upsert({
        where: { costId_month: { costId: cost.id, month } },
        create: { costId: cost.id, month, amount: v, currency: "USD", createdBy: "import" },
        update: { amount: v, currency: "USD" },
      });
      count++;
      recent.push(v);
    }
    const last6 = recent.slice(-6);
    const avg = last6.reduce((a, b) => a + b, 0) / last6.length;
    console.log(`✓ ${s.label}: ${count} meses (${s.start}→${END}) · média últimos 6 = $${avg.toFixed(2)}/mês`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1); });
