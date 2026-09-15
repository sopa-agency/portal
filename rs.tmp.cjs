const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const rows = await p.sopaBoard.findMany({ where: { board: "orgchart" } });
  console.log("linhas orgchart:", rows.length);
  for (const r of rows) {
    const meta = r.meta && typeof r.meta === "object" && !Array.isArray(r.meta) ? r.meta : {};
    const streams = Array.isArray(meta.revenueStreams) ? meta.revenueStreams : [];
    console.log(`  id=${r.id} · chaves=${Object.keys(meta).join(",").slice(0,80)} · streams=${streams.length}`);
    for (const s of streams) console.log(`      ${s.label} | ${s.address} | ${s.chain}`);
  }
  await p.$disconnect();
})();
