#!/usr/bin/env node
// One-shot: import every ~/.openclaw/workspace-{slug}/memory/episodic/{date}.md
// for the briefing agents into the Briefing model. Idempotent — re-runs upsert
// by (agentSlug, date). Use AFTER `prisma db push` has created the Briefing
// table and `.env.local` points at the target DB.
//
// Run: node scripts/backfill-briefings.js

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

for (const f of [".env.local", ".env.development", ".env"]) {
  try { require("dotenv").config({ path: path.join(__dirname, "..", f), override: false }); } catch {}
}

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ log: ["error"] });

const AGENTS = [
  { slug: "skate-dev", workspace: "workspace-skate-dev" },
  { slug: "skatehive-marketing", workspace: "workspace-skatehive-marketing" },
];

const DATE_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;

async function main() {
  let imported = 0;
  let skipped = 0;
  for (const agent of AGENTS) {
    const dir = path.join(os.homedir(), ".openclaw", agent.workspace, "memory", "episodic");
    let entries;
    try {
      entries = await fs.promises.readdir(dir);
    } catch (err) {
      console.warn(`skip ${agent.slug}: cannot read ${dir} — ${err.message}`);
      continue;
    }
    for (const name of entries) {
      const m = DATE_FILE_RE.exec(name);
      if (!m) continue;
      const date = m[1];
      const filePath = path.join(dir, name);
      let body;
      try {
        body = await fs.promises.readFile(filePath, "utf8");
      } catch (err) {
        console.warn(`skip ${agent.slug}/${date}: ${err.message}`);
        continue;
      }
      const stat = await fs.promises.stat(filePath);
      await prisma.briefing.upsert({
        where: { agentSlug_date: { agentSlug: agent.slug, date } },
        create: {
          agentSlug: agent.slug,
          date,
          language: "pt",
          body: body.trim(),
          generatedBy: "cron-backfill",
          generatedAt: stat.mtime,
        },
        update: {
          body: body.trim(),
          generatedBy: "cron-backfill",
          generatedAt: stat.mtime,
        },
      });
      imported++;
      process.stdout.write(`✓ ${agent.slug}/${date}\n`);
    }
  }
  console.log(`\nDone — imported ${imported} briefing(s), skipped ${skipped}.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
