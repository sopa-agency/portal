const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  for (const slug of ["skate-dev", "skatehive-marketing"]) {
    console.log("\n========================================");
    console.log("AGENT:", slug);
    console.log("========================================");
    const job = await prisma.briefingJob.findFirst({ where: { agentSlug: slug }, orderBy: { createdAt: "desc" } });
    if (job) {
      console.log(`\n--- LAST INPUT (BriefingJob ${job.createdAt.toISOString()} · status=${job.status}) ---`);
      console.log(`prompt length: ${job.prompt.length} chars`);
      console.log(job.prompt);
    } else console.log("(no BriefingJob)");
    const out = await prisma.briefing.findFirst({ where: { agentSlug: slug }, orderBy: { generatedAt: "desc" } });
    if (out) {
      console.log(`\n--- LAST OUTPUT (Briefing date=${out.date} · by=${out.generatedBy} · ${out.generatedAt.toISOString()}) ---`);
      console.log(`body length: ${out.body.length} chars`);
      console.log(out.body);
    } else console.log("(no Briefing)");
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
