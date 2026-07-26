/**
 * Add the public-profile columns via targeted SQL.
 *
 * `prisma db push` drifts on this DB (pre-existing InstagramPost drift), so
 * schema changes are applied by hand — same approach as HomepageConfig /
 * OutreachContact / SopaBrief. This is additive: every column has a default or
 * is nullable, so existing rows keep working untouched.
 *
 *   MemberSkills      + roles, territory, location, languages, since
 *   TeamMemberContact + public   (default FALSE — nothing leaks by omission)
 *
 * Run once per environment:
 *   dotenv -e .env.local -- node scripts/add-member-profile-columns.cjs
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const COLUMNS = [
  ['MemberSkills', 'roles', 'TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]'],
  ['MemberSkills', 'territory', 'TEXT'],
  ['MemberSkills', 'location', 'TEXT'],
  ['MemberSkills', 'languages', 'TEXT'],
  ['MemberSkills', 'since', 'INTEGER'],
  ['TeamMemberContact', 'public', 'BOOLEAN NOT NULL DEFAULT false'],
];

async function main() {
  for (const [table, column, type] of COLUMNS) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" ${type};`,
    );
    console.log(`  ${table}.${column} ✓`);
  }

  const [skills] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "MemberSkills";`,
  );
  const [pub] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "TeamMemberContact" WHERE "public" = true;`,
  );
  console.log(`\npronto ✓ · ${skills.n} perfis · ${pub.n} contatos marcados como públicos`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
