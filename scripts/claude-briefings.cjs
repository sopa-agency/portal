/**
 * Claude as the briefing agent (OpenClaw/Codex rate-limited). Composed from a
 * full agent-style pass: canonical workspace docs + LIVE data pulled via our
 * own access — GitHub board + commits (gh/API), Hive community (RPC). Writes the
 * SkateHive DEV + MKT briefings into the Briefing table.
 *   npx dotenv -e .env.local -- node scripts/claude-briefings.cjs
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const DATE = "2026-06-23";

const DEV = `# Morning Briefing — SkateHive Dev

## Hoje
- Review é o gargalo: **11 em review** vs 5 em progresso — código pronto travado, não falta de trabalho \`[board]\`.
- **Cluster de auth empilhado no review**: #94 Farcaster Sign In, #95 Duplicate Accounts, #56 Auth System — bate com o foco P1 "auth" do projeto \`[board]\`.
- 1 commit novo desde ontem: \`418fd53\` roteia fees de plataforma pro split contract (@sktbrd) \`[commits]\`.

## Prioridades
- Fechar o cluster de auth (#94 / #95 / #56): mais itens parados + foco declarado do projeto \`[board]\`.
- #91 — profile header / blockchain data não carrega no load inicial: bug visível pro usuário \`[board]\`.
- #97 — ChunkLoadError na home: risco de crash de carregamento, revisar \`[board]\`.
- #107 (web) + #13 (mobile) IG auto-posting: o cross-publish IG já existe no portal — alinhar pra não duplicar \`[board]\`.

## Riscos / bloqueios
- Sem build/deploy quebrado detectado.
- **Throughput**: 11 em review é o risco real — merge represado segura auth, fixes e features juntos.
- **Verdade de repo divergente**: os docs apontam o codebase como monorepo (\`~/Code/skatehive-monorepo\`), mas os commits ativos estão em \`SkateHive/skatehive3.0\`. Alinhar qual é o canônico — pode estar ligado à Vercel Migration em progresso.

## Mudanças desde a última checagem
- \`418fd53\` fees de plataforma → split contract \`[commits]\`.

## Próximas ações
- Priorizar review do cluster auth (#94/#95/#56) e do #97 hoje.
- Reproduzir #91 no load inicial e abrir o fix.
- Bater na reunião de sexta qual repo é a verdade (monorepo vs skatehive3.0).

## Fontes consultadas
- \`[commits]\` delta do skatehive3.0 via API do GitHub
- \`[board]\` GitHub Project (ao vivo)
- docs canônicos do workspace (skatehive.md, team.md, meetings.md)`;

const MKT = `# Morning Briefing — SkateHive Marketing

## Hoje
- **Hive voltou a publicar**: @nogenta soltou "Street Life 12" (Candelária/Praça XV) hoje, 114 votes — a série Rio street é o conteúdo mais consistente da comunidade \`[live]\`.
- IG puxando público novo: **4.1K reach (+22% WoW), 91% de não-seguidores** \`[live ~1d]\`.
- Gargalo segue: **3 saves em 7d** — entretém, mas não dá motivo pra salvar \`[live]\`.

## Prioridades
- **Amplificar a série Rio street do @nogenta** (Street Life 11/12 + Praça Mauá): performance consistente na Hive e material pronto pra carrossel no IG \`[live]\`.
- 1 **carrossel salvável/semana** — "Rio street week: 5 clips", crédito por slide (carrossel alcança 559, ataca os saves) \`[live]\`.
- Espaçar Reels 24-48h; caption pra **share** ("manda pro mano que ia tentar 🛹") \`[live]\`.
- Curar os **13 posts pendentes** da Hive pro feed e cross-postar os 2 melhores no IG/Farcaster \`[live]\`.

## Sinais
- Hive saudável: **1703 subs, 9 autores ativos, 13 pendentes** — comunidade produzindo \`[live]\`.
- **Weekly Stoken #86 com 320 votes** — âncora semanal forte, vale um cast no Farcaster \`[live]\`.
- IG momentum: 20.3K views, 712 interações (+18%), watch 4.6-7.4s — loop do clipe importa mais que caption \`[live]\`.

## Coordenação com dev
- Não anunciar #107/#13 (IG auto-posting) como pronto até sair do board \`[board]\`.
- Segurar hype de login/UX enquanto o cluster auth (#94/#95/#56) e o #91 seguem em review/aberto \`[board]\`.

## Riscos / suposições furadas
- **Resolvido**: o "+1330 followers/7d" de ontem era anomalia de indexação — hoje a Hive está em **1703 (flat vs 1702)**. Não usar aquele número \`[live]\`.
- Não vender Vercel Migration / TestFlight como shipped — em progresso \`[board]\`.
- Não reciclar "500+ skaters" de docs antigos sem métrica nova.

## Próximas ações
- Rascunhar o carrossel "Rio street week" com clips do @nogenta (crédito + local).
- 1 cast no Farcaster: Weekly Stoken #86 + 1 clip da série Rio.
- Selecionar 2 dos 13 pendentes da Hive pro cross-post visual.

## Fontes consultadas
- \`[live]\` Hive (RPC ao vivo) + IG (~1d) + Farcaster
- \`[board]\` GitHub Project (ao vivo)
- docs de marca + análise social prévia (IG)`;

async function up(agentSlug, body) {
  await prisma.briefing.upsert({
    where: { agentSlug_date: { agentSlug, date: DATE } },
    create: { agentSlug, date: DATE, language: "pt", body, generatedBy: "claude" },
    update: { body, generatedBy: "claude", generatedAt: new Date() },
  });
  console.log(`✓ ${agentSlug} (${DATE}) — ${body.length} chars`);
}

async function main() {
  await up("skate-dev", DEV);
  await up("skatehive-marketing", MKT);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
