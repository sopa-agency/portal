# SkateHive Daily Briefing Prompt

Run the SkateHive development morning briefing from canonical project context plus live execution sources.

## Where to look first
1. `BOOTSTRAP.md`
2. Main workspace project docs:
   - `/Users/vladnikolaev/.openclaw/workspace/docs/projects/skatehive.md`
   - `/Users/vladnikolaev/.openclaw/workspace/docs/projects/skatehive/team.md`
   - `/Users/vladnikolaev/.openclaw/workspace/docs/projects/skatehive/meetings.md`
3. Local bridge files when still active:
   - `project.md`
   - `team.md`
4. Structured local data:
   - `data/userbase-source-snapshot.json`
5. Live execution truth:
   - `~/Code/skatehive-monorepo`
   - current deploy/runtime/build state
   - current GitHub Project/meeting artifacts when checked in-run
6. Live external/product signals when accessible in-run:
   - GitHub PRs / issues / checks / projects
   - Vercel CLI + deployment events
   - database/userbase tables and recent changes
   - Google Analytics / Search Console
   - email inbox artifacts when real inbox access exists

## Goal
Produce a short dev-facing SkateHive morning briefing that reads cleanly in the newer OpenClaw portal UI used by `@zequinha_superv2_bot`.

## Output format
Use this exact high-level shape:

# Morning Briefing — SkateHive Dev
## Hoje
- 2 to 4 bullets with the highest-signal items only

## Prioridades
- 2 to 4 bullets

## Riscos / bloqueios
- bullets only; say `Sem bloqueios relevantes` if clean

## Mudanças desde a última checagem útil
- bullets only

## Próximas ações recomendadas
- 2 to 4 bullets

## Fontes consultadas agora
- one bullet per source actually checked in this run

## Fontes tentadas mas bloqueadas
- only include this section when something important was attempted but inaccessible
- each bullet should say both the source and the real blocker

## Required content coverage
Make sure the briefing explicitly covers, when checked in-run:
1. What matters today
2. Product/dev priorities
3. Deployment/runtime risks
4. Meeting-to-execution gaps
5. What changed since last meaningful check
6. Recommended next actions
7. Sources consulted now
8. Important blocked sources

## Portal/UI rules
- Optimize for skim-reading in the OpenClaw portal.
- Prefer short headings and short bullets over paragraphs.
- No Markdown tables.
- No long preamble, no outro, no filler.
- If a section has no signal, keep it to one short line.
- Do not claim a source was consulted unless it was actually checked in the current run.
- Distinguish clearly between live checks, canonical docs, and blocked/unavailable sources.

## Rules
- Canonical project truth lives in the main workspace docs.
- Live code/deploy state beats old summaries.
- Do not turn SEO/meeting residue into fake priorities.
- Keep it concise, technical, and action-oriented.
- If live truth was not checked for a category that matters today, say that explicitly in blockers/sources instead of bluffing.
