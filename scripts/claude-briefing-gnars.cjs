/**
 * Claude as gnars-steve (single all-in-one agent). Full pass: canonical gnars
 * workspace docs + LIVE data (gnars-dao Project #4, gnars-website commits, Hive
 * @gnars via RPC). Governance left as an explicit on-chain TODO — no invented
 * proposal numbers. Run:
 *   npx dotenv -e .env.local -- node scripts/claude-briefing-gnars.cjs
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const DATE = "2026-06-23";

const BODY = `# Morning Briefing — Gnars

## Hoje
- Produto **WIP-pesado**: 31 backlog, 4 em progresso, 4 em review, **0 ready** — board é estacionamento, não esteira \`[board]\`.
- \`gnars-website\` teve commits reais: **fee recipient do swap** atualizado 2x (@sktbrd) + um **perf fix pra caber no plano Hobby da Vercel** (#120, @r4topunk) \`[commits]\`.
- Hive do @gnars **quieto**: último post é "Gnars Bounties D.I.Y" (15/jun, 64 votes) — ~8 dias sem publicar \`[live]\`.

## Prioridades DAO / comunidade
- **Bounties é o trilho** (sinal mais quente das últimas semanas em Hive+Farcaster+IG) — não deixar esfriar; manter cadência de conteúdo de bounty.
- Governança: **checagem on-chain pendente neste run** — confirmar estado das propostas (Noggles Rail / Builder) antes de qualquer claim; não afirmar resultado sem verificar.

## Produto
- **[Clanker] Gnars token migration** em progresso — alto impacto, acompanhar de perto \`[board]\`.
- Fix Farcaster Metadata/Ownership + Search Console Setup: higiene de discovery, bom pra growth \`[board]\`.
- Drenar o review (4: Archive feature do Zima, i18n, Proposal templates, newsletter AI) antes de abrir frente nova \`[board]\`.

## Conteúdo / canais
- Reaproveitar o post de Bounties (performou nos 3 canais) + a série DIY onchain (Nogglesrails / Nogglesboard) \`[live]\`.
- @gnars na Hive precisa de cadência — escolher 1 material da semana e quebrar o silêncio de 8 dias.

## Riscos / suposições furadas
- **0 "ready" com 31 no backlog**: risco de dispersão — falta coisa pronta pra shippar.
- Perf fix pro Hobby plan (#120) sugere **pressão de custo/infra na Vercel** — confirmar se algum limite está sendo batido \`[commits]\`.
- Não afirmar resultado de proposta sem checagem on-chain.

## Próximas ações
- Validar escopo + risco do token migration [Clanker] com o r4to.
- Publicar 1 post no @gnars (Hive) essa semana — quebra o silêncio de 8 dias.
- Checar on-chain o estado das propostas antes do próximo briefing.
- Confirmar se a Vercel está batendo limite (o perf fix #120 é o sinal).

## Fontes consultadas
- \`[commits]\` gnars-website via API do GitHub
- \`[board]\` gnars-dao Project #4 (ao vivo)
- \`[live]\` Hive @gnars (RPC) + sinais sociais recentes
- docs canônicos do workspace (gnars.md, team.md, project.md)`;

prisma.briefing
  .upsert({
    where: { agentSlug_date: { agentSlug: "gnars-steve", date: DATE } },
    create: { agentSlug: "gnars-steve", date: DATE, language: "pt", body: BODY, generatedBy: "claude" },
    update: { body: BODY, generatedBy: "claude", generatedAt: new Date() },
  })
  .then(() => console.log(`✓ gnars-steve (${DATE}) — ${BODY.length} chars`))
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); process.exit(1); });
