import "server-only";

// Bloco [contexto] injetado no prompt do /chat.
//
// POR QUE ISTO EXISTE
//
// O caminho de BRIEFING já anexa contexto ao prompt do agente — está escrito em
// prompts/secretario.md: "Abaixo deste prompt o portal anexa: o board do GitHub
// Project ([board]) e, quando configurado, sinais sociais ([live]). Use como
// verdade de campo — não re-busque."
//
// O /chat nunca ganhou isso. O prompt dele tinha nome do projeto, id do agente,
// username, histórico e anexos — e mais nada. O agente respondia do vazio sobre
// uma agência cujos dados estavam na tela ao lado. Isto replica o padrão que já
// existe, em vez de inventar um novo.
//
// DUAS CAMADAS
//
// A) O que o config já sabe (src/projects/*.ts): a agência, o projeto atual por
//    inteiro — inclusive voz, dos e donts de cada canal — e uma linha por irmão.
//    Zero I/O: é leitura de objeto em memória.
//
// B) Sinais vivos: board, atas e tesouro. Cada um é uma leitura que PODE
//    FALHAR, e é aí que mora a regra que manda neste arquivo.
//
// A REGRA QUE MANDA AQUI: TRÊS ESTADOS
//
// Toda leitura da camada B tem três estados — tem valor / não tem / NÃO
// CONSEGUI LER — e os três APARECEM ESCRITOS no bloco. Uma leitura que falhou
// nunca vira 0, nunca vira lista vazia e nunca some em silêncio.
//
// O motivo é específico deste bloco: o agente vai ler isto como verdade de
// campo e responder com confiança em cima. Se uma falha de rede virasse "0
// cards no board", ele afirmaria que não há trabalho em aberto — com a mesma
// segurança com que afirmaria qualquer outra coisa, e sem ninguém conseguir
// auditar de onde veio. Ausência silenciosa é a única forma de erro que se
// disfarça de resposta boa.
//
// Ver src/lib/reading.ts para o tipo.

import type { ProjectConfig, SocialChannel } from "@/projects/types";
import { getAllProjects } from "@/projects/index";
import { prisma } from "@/lib/prisma";
import { ok, insufficient, unread, type Reading } from "@/lib/reading";
import { fetchGitHubProject } from "@/lib/github-project";
import { getAssignedTasksAcrossPortalsContext, getProjectKanbanContext } from "@/lib/kanban-context";
import { getProjectMeetingsContext } from "@/lib/meetings-context";

/**
 * Teto por fonte. Isto roda a CADA mensagem do chat: uma fonte lenta não pode
 * segurar a resposta. Estourar o tempo é uma leitura não-lida como outra
 * qualquer — aparece escrita, não some.
 *
 * As atas ganham mais tempo porque a leitura delas consulta o board para saber
 * quais ações já viraram card feito. Com 3s ela estourava sempre, e um sinal
 * que nunca chega é o mesmo que não existir.
 */
const TIMEOUT_MS = { board: 4_000, allTasks: 15_000, atas: 6_000, tesouro: 3_000, receita: 3_000, equipe: 3_000, engajamento: 3_000, briefing: 2_000, social: 3_000 } as const;

/**
 * A partir de quantos dias o home summary entra marcado como velho.
 *
 * Não é enfeite: o último briefing do secretário é de 13/07 e abre com
 * "decidir sobre servidor dedicado, sem decisão sua fica travado". Injetado sem
 * data, o agente fala disso como se fosse hoje — e a pessoa age sobre uma
 * fotografia de sete semanas atrás achando que é o presente.
 */
const BRIEFING_VELHO_DIAS = 3;

/**
 * DOIS CACHES, e o segundo é o que resolve de verdade.
 *
 * MEMÓRIA (60s): dentro do mesmo processo, mensagens seguidas não remontam.
 *
 * BANCO: a memória de um lambda não atravessa requisições. Em produção quase
 * toda mensagem cai num processo novo, e medindo deu 2373ms no frio contra
 * 265ms no quente — ou seja, o caso comum era o caro. A tabela atravessa, e o
 * caminho frio vira uma leitura de linha.
 *
 * E VELHO SERVE NA HORA. Passado o frescor, devolvemos o bloco que temos e
 * remontamos POR TRÁS: quem perguntou não espera. O preço é o bloco poder estar
 * alguns minutos atrás — e por isso ele carrega a hora em que foi montado, no
 * próprio texto, onde o agente lê. Cache que se esconde vira mentira; cache que
 * se declara é só uma leitura de alguns minutos atrás.
 */
const MEM_TTL_MS = 60_000;
const FRESH_MS = 5 * 60_000;
const blockCache = new Map<string, { at: number; ctx: ChatContext }>();
/** Remontagens em voo, para não disparar dez ao mesmo tempo. */
const refreshing = new Set<string>();

/** Quantos canais sociais do projeto atual entram por inteiro. */
const MAX_SOCIALS = 6;
/** Teto de itens em cada lista de dos/donts/formats, por canal. */
const MAX_LIST = 6;

// ---------------------------------------------------------------------------
// Camada A — config
// ---------------------------------------------------------------------------

function trim(v: string | undefined, max: number): string {
  if (!v) return "";
  const t = v.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function serializeSocial(c: SocialChannel): string {
  const head = [c.platform, c.handle, c.note].filter(Boolean).join(" · ");
  const lines = [`  - ${head}`];
  if (c.summary) lines.push(`    para que serve: ${trim(c.summary, 220)}`);
  if (c.cadence) lines.push(`    cadência: ${trim(c.cadence, 80)}`);
  if (c.voice) lines.push(`    voz: ${trim(c.voice, 220)}`);
  if (c.formats?.length) {
    lines.push(`    formatos: ${c.formats.slice(0, MAX_LIST).map((f) => f.name).join(", ")}`);
  }
  if (c.dos?.length) lines.push(`    sempre: ${c.dos.slice(0, MAX_LIST).map((d) => trim(d, 90)).join(" | ")}`);
  if (c.donts?.length) lines.push(`    nunca: ${c.donts.slice(0, MAX_LIST).map((d) => trim(d, 90)).join(" | ")}`);
  return lines.join("\n");
}

function serializeProject(p: ProjectConfig): string {
  const out: string[] = [];
  out.push(`# ${p.name} (slug ${p.slug}) — este é o portal em que você está`);
  if (p.description) out.push(p.description);

  const ids: string[] = [];
  if (p.hive?.account) ids.push(`Hive @${p.hive.account}${p.hive.community ? ` (comunidade ${p.hive.community})` : ""}`);
  if (p.farcaster?.channel) ids.push(`Farcaster /${p.farcaster.channel}`);
  if (p.repos?.length) ids.push(`repos: ${p.repos.join(", ")}`);
  if (ids.length) out.push(ids.join(" · "));

  const socials = (p.socials ?? []).slice(0, MAX_SOCIALS);
  if (socials.length) {
    out.push("Canais e como se fala em cada um:");
    out.push(socials.map(serializeSocial).join("\n"));
    const rest = (p.socials?.length ?? 0) - socials.length;
    if (rest > 0) out.push(`  (+${rest} canais não listados aqui)`);
  }

  const people = Object.keys(p.teamContacts ?? {});
  if (people.length) out.push(`Equipe com contato cadastrado: ${people.join(", ")}`);
  return out.join("\n");
}

function serializeSiblings(current: ProjectConfig): string {
  const others = getAllProjects().filter((p) => p.slug !== current.slug);
  if (!others.length) return "";
  const lines = others.map((p) => `  - ${p.name}: ${trim(p.description, 160) || "(sem descrição)"}`);
  return [
    "# Os outros portais da SOPA",
    "A SOPA é uma agência com vários projetos. Estes são os irmãos deste portal:",
    lines.join("\n"),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Camada B — sinais vivos, cada um com três estados
// ---------------------------------------------------------------------------

/**
 * Corre a leitura com teto de tempo e separa os DOIS jeitos de não ter valor.
 *
 * `attempt()` do reading.ts transforma qualquer exceção em `unread`, e aqui
 * isso juntaria coisas diferentes: "não há ata registrada" (ausência de
 * verdade, que o agente pode afirmar) e "o banco não respondeu" (desconhecido,
 * que ele não pode). Por isso uma falha marcada com `empty: true` vira
 * `insufficient`, e o resto — inclusive estourar o tempo — vira `unread`.
 */
async function withTimeout<T>(ms: number, fn: () => Promise<T>): Promise<Reading<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`a leitura passou de ${ms}ms`)),
          ms,
        );
      }),
    ]);
    return ok(value, Date.now());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if ((e as { empty?: boolean })?.empty) return insufficient<T>(msg);
    return unread<T>(msg);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Board do GitHub Project.
 *
 * `getProjectKanbanContext` devolve "" tanto quando o board está vazio quanto
 * quando o fetch falhou — as duas coisas iguais, que é justamente o que não
 * pode. Por isso buscamos o resultado tipado uma vez e o repassamos ao
 * formatador, sem uma segunda ida ao GitHub dentro do mesmo teto curto.
 */
async function readBoard(project: ProjectConfig): Promise<Reading<string>> {
  if (!project.githubProject) {
    return insufficient<string>("este portal não tem board configurado");
  }
  return withTimeout(TIMEOUT_MS.board, async () => {
    const board = await fetchGitHubProject(project);
    if (!board.ok) throw new Error(board.error || "o board não respondeu");
    const text = await getProjectKanbanContext(project, board);
    if (!text.trim()) throw new Error("o board respondeu, mas o contexto veio vazio");
    return text;
  });
}

/** Open work belonging to this person across every registered portal board. */
async function readAssignedTasks(project: ProjectConfig): Promise<Reading<string>> {
  if (!project.taskIdentity) {
    return insufficient<string>("este portal não tem uma identidade pessoal configurada para agregar tarefas");
  }
  return withTimeout(TIMEOUT_MS.allTasks, async () => {
    const result = await getAssignedTasksAcrossPortalsContext(project);
    if (!result.text && result.errors.length) throw new Error(result.errors.join(" | "));
    if (result.total === 0 && result.errors.length === 0) {
      throw Object.assign(new Error("nenhuma tarefa aberta atribuída a esta pessoa"), { empty: true });
    }
    return result.text;
  });
}

/**
 * O contexto de reuniões foi escrito para o BRIEFING, e traz a última ata
 * inteira em markdown — TL;DR, decisões, divergências, resumo por tema. No
 * briefing isso faz sentido; aqui triplicava o bloco e enterrava o que
 * interessa. Ficamos com a linha da última reunião e a lista de ações em
 * aberto, que é o que alguém perguntaria ao agente.
 */
function trimMeetings(text: string): string {
  const lines = text.split("\n");
  const first = lines[0]?.startsWith("Última reunião") ? lines[0] : "";
  const i = lines.findIndex((l) => l.startsWith("Ações em aberto"));
  const acoes = i >= 0 ? lines.slice(i).join("\n") : "";
  const out = [first, acoes].filter(Boolean).join("\n");
  // Se o formato mudar e nada casar, é melhor um pedaço do original do que
  // silêncio — mas com teto, para não voltar a inchar o prompt.
  return (out || text).slice(0, 2_500);
}

/** Ações em aberto das atas. Banco, barato. */
async function readMeetings(project: ProjectConfig): Promise<Reading<string>> {
  return withTimeout(TIMEOUT_MS.atas, async () => {
    // A contagem separa "não há ata" de "não consegui ler": se o banco falhar,
    // isto lança e vira não-lida; se voltar 0, é ausência de verdade.
    //
    // O escopo era `projectSlug: "sopa"` fixo, herdado de quando só a SOPA
    // tinha reuniões. Num portal de marca isso contava ata alheia: a contagem
    // dizia "há atas" e o texto abaixo, que FILTRA por projeto, vinha vazio —
    // duas leituras discordando sobre o mesmo banco. Agora as duas perguntam a
    // mesma coisa. A SOPA continua vendo tudo porque ela é a agregadora.
    const escopo = project.slug === "sopa" ? {} : { projectSlug: project.slug };
    const n = await prisma.meetingOccurrence.count({ where: escopo });
    if (n === 0) throw Object.assign(new Error("nenhuma ata registrada"), { empty: true });
    const text = await getProjectMeetingsContext(project);
    if (!text.trim()) {
      throw Object.assign(new Error("nenhuma ação em aberto nas atas recentes"), { empty: true });
    }
    return trimMeetings(text);
  });
}

/**
 * O que este portal andou fazendo no trail — o "engagement".
 *
 * Lê pelos LABELS que pertencem ao portal (TrailAccount.ownerSlug), nunca pelo
 * slug direto. A conta de uma pessoa raramente se chama como o portal dela: o
 * portal `vlad` age como `xvlad`, e comparar slug com label devolvia lista
 * vazia com 120 ações no banco.
 */
async function readEngagement(project: ProjectConfig): Promise<Reading<string>> {
  return withTimeout(TIMEOUT_MS.engajamento, async () => {
    const contas = await prisma.trailAccount.findMany({
      where: { ownerSlug: project.slug, enabled: true },
      select: { label: true, kind: true, hiveAccount: true },
    });
    if (contas.length === 0) {
      throw Object.assign(new Error("este portal não tem conta no trail de curadoria"), { empty: true });
    }
    const labels = contas.map((c) => c.label);

    const acoes = await prisma.farcasterTrailAction.findMany({
      where: { actorSlug: { in: labels } },
      include: { cast: true },
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    if (acoes.length === 0) {
      throw Object.assign(new Error("nenhuma ação registrada no trail"), { empty: true });
    }

    // O AGREGADO ANTES DOS EXEMPLOS. "Quantas respostas estão pendentes" é a
    // pergunta que alguém faz; a lista crua de casts é o que ele usa para
    // responder "quais". Enterrar a contagem no meio de quarenta linhas fazia o
    // agente ter que contar de cabeça — e ele conta errado.
    const porTipo = new Map<string, number>();
    for (const a of acoes) {
      const k = `${a.kind}/${a.status}`;
      porTipo.set(k, (porTipo.get(k) ?? 0) + 1);
    }
    const resumo = [...porTipo.entries()].sort().map(([k, n]) => `${k}: ${n}`).join(" · ");
    const castsDistintos = new Set(acoes.map((a) => a.castHash)).size;

    // UM CAST, UMA LINHA. O trail grava mais de uma ação para o mesmo post
    // (retentativa, o mesmo cast reaparecendo no poll), e sem deduplicar o
    // contexto saía com seis cópias do mesmo texto — enchendo o prompt e, pior,
    // mentindo sobre o volume: seis linhas parecem seis assuntos.
    //
    // Dedup em DOIS níveis, porque são dois problemas diferentes:
    //
    //   por castHash — o trail grava mais de uma ação para o mesmo post
    //                  (retentativa, o post reaparecendo no poll);
    //   por TEXTO    — a mesma publicação sai em casts diferentes, com hashes
    //                  diferentes. A SkateHive cross-posta, e o mesmo anúncio
    //                  apareceu em quatro casts. Deduplicar só por hash deixava
    //                  quatro linhas idênticas no prompt: enche o contexto e
    //                  mente sobre o volume, porque quatro linhas parecem
    //                  quatro assuntos.
    //
    // Quantas cópias havia vai anotado na linha (×N) em vez de sumir: "este
    // post saiu quatro vezes" é informação, e escondê-la seria trocar um
    // exagero por uma omissão.
    const chave = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);
    const dedup = <T extends { castHash: string; cast: { text: string } | null }>(xs: T[], n: number) => {
      const porHash = new Set<string>();
      const porTexto = new Map<string, { item: T; copias: number }>();
      for (const x of xs) {
        if (porHash.has(x.castHash)) continue;
        porHash.add(x.castHash);
        const k = chave(x.cast?.text ?? x.castHash);
        const ja = porTexto.get(k);
        if (ja) ja.copias++;
        else porTexto.set(k, { item: x, copias: 1 });
      }
      return [...porTexto.values()].slice(0, n);
    };
    const pendentes = dedup(acoes.filter((a) => a.kind === "reply" && a.status === "pending"), 6);
    const feitas = dedup(acoes.filter((a) => a.kind === "reply" && a.status === "done"), 4);

    const linha = ({ item: a, copias }: { item: (typeof acoes)[number]; copias: number }) => {
      const autor = a.cast?.authorHandle || a.cast?.authorSlug || "?";
      const txt = trim(a.cast?.text ?? "", 140).replace(/\s+/g, " ");
      const quando = a.cast?.postedAt ? new Date(a.cast.postedAt).toISOString().slice(0, 10) : "?";
      const rep = copias > 1 ? ` [mesmo texto em ${copias} casts]` : "";
      return `- @${autor} (${quando})${rep}: ${txt}${a.draft ? `\n  rascunho pronto: ${trim(a.draft, 160)}` : ""}`;
    };

    const partes = [
      `Contas deste portal no trail: ${contas.map((c) => `${c.label} (${c.kind}${c.hiveAccount ? `, hive @${c.hiveAccount}` : ""})`).join(", ")}.`,
      `Últimas ${acoes.length} ações sobre ${castsDistintos} post(s) distintos — ${resumo}.`,
    ];
    if (pendentes.length) partes.push("", `Respostas PENDENTES (${pendentes.length} das mais recentes):`, ...pendentes.map(linha));
    if (feitas.length) partes.push("", "Já respondidas recentemente:", ...feitas.map(linha));
    return partes.join("\n");
  });
}

/**
 * Redes sociais — o que a Meta e as outras plataformas dizem, do snapshot.
 *
 * Vem do SocialMetricSnapshot, gravado por cron. Não chama a Graph API aqui:
 * uma leitura ao vivo por mensagem de chat seria lenta, cara e sujeita a
 * rate limit — e o número que interessa (seguidores hoje vs. semana passada)
 * já está gravado.
 *
 * A VARIAÇÃO É O DADO, não o total. "3.412 seguidores" não diz nada sozinho;
 * "3.412, +18 na semana" responde a pergunta que a pessoa realmente faz. E
 * quando não há leitura anterior para comparar, a variação sai como
 * desconhecida em vez de zero — porque zero significaria "não cresceu", que é
 * uma afirmação que não temos como fazer.
 */
async function readSocial(project: ProjectConfig): Promise<Reading<string>> {
  return withTimeout(TIMEOUT_MS.social, async () => {
    const linhas = await prisma.socialMetricSnapshot.findMany({
      where: { projectSlug: project.slug },
      orderBy: { capturedAt: "desc" },
      take: 200,
    });
    if (linhas.length === 0) {
      throw Object.assign(new Error("nenhuma métrica de rede social capturada para este portal"), { empty: true });
    }

    // Última leitura por plataforma, e a mais próxima de 7 dias atrás para a
    // comparação. Uma varredura só; a lista já vem ordenada do mais novo.
    const agora = Date.now();
    const seteDias = 7 * 86_400_000;
    type Ponto = { followers: number; at: Date };
    const atual = new Map<string, Ponto>();
    const antes = new Map<string, Ponto>();
    for (const l of linhas) {
      const p = { followers: l.followers, at: l.capturedAt };
      if (!atual.has(l.platform)) {
        atual.set(l.platform, p);
        continue;
      }
      // O primeiro ponto com pelo menos 7 dias de idade é a base de comparação.
      if (!antes.has(l.platform) && agora - l.capturedAt.getTime() >= seteDias) {
        antes.set(l.platform, p);
      }
    }

    const fmt = (n: number) => n.toLocaleString("pt-BR");
    const partes: string[] = [];
    for (const [plataforma, hoje] of [...atual.entries()].sort()) {
      const base = antes.get(plataforma);
      const idade = Math.floor((agora - hoje.at.getTime()) / 86_400_000);
      const quando = idade === 0 ? "hoje" : `há ${idade} dia(s)`;
      const delta = base
        ? (() => {
            const d = hoje.followers - base.followers;
            const sinal = d > 0 ? "+" : "";
            return `${sinal}${fmt(d)} em ${Math.round((hoje.at.getTime() - base.at.getTime()) / 86_400_000)} dia(s)`;
          })()
        : "variação desconhecida (sem leitura anterior para comparar — não é o mesmo que não ter variado)";
      partes.push(`- ${plataforma}: ${fmt(hoje.followers)} seguidores (medido ${quando}) · ${delta}`);
    }
    return ["Seguidores por plataforma, do snapshot do portal:", ...partes].join("\n");
  });
}

/**
 * O último home summary — o briefing que o agente deste portal já escreveu.
 *
 * A DATA VIAJA COLADA no texto, e um briefing velho entra dito como velho. Sem
 * isso o agente lê "decidir sobre o servidor dedicado" de julho e responde como
 * se fosse a pauta de hoje: uma fotografia antiga apresentada como o presente é
 * pior que nenhuma fotografia.
 */
async function readBriefing(project: ProjectConfig): Promise<Reading<string>> {
  const agentes = project.briefingAgents ?? [];
  if (agentes.length === 0) return insufficient<string>("este portal não tem agente de briefing configurado");
  return withTimeout(TIMEOUT_MS.briefing, async () => {
    const row = await prisma.briefing.findFirst({
      where: { agentSlug: { in: agentes.map((a) => a.slug) } },
      orderBy: [{ date: "desc" }, { generatedAt: "desc" }],
    });
    if (!row) throw Object.assign(new Error("nenhum briefing gerado ainda"), { empty: true });

    const dias = Math.floor((Date.now() - new Date(row.date).getTime()) / 86_400_000);
    const velho = dias > BRIEFING_VELHO_DIAS;
    const cabecalho = velho
      ? `ATENÇÃO: este briefing é de ${row.date} — ${dias} dias atrás. Trate como registro do passado, não como a situação de hoje, e diga a data se citar algo daqui.`
      : `Briefing de ${row.date} (${dias === 0 ? "hoje" : `${dias} dia(s) atrás`}).`;
    return [cabecalho, "", trim(row.body, 3_000)].join("\n");
  });
}

/**
 * Tesouro, da tabela de snapshots — e não da rede.
 *
 * Ler o tesouro ao vivo aqui seria uma chamada a Zerion e RPC POR MENSAGEM do
 * chat: lento e caro, contra a razão de existir do botão de sincronizar. O
 * snapshot já é gravado por cron, e ele guarda a falha COMO FALHA
 * (`totalUsd` NULL + `reason`), que é o que torna esta leitura honesta de graça.
 */
async function readTreasury(project: ProjectConfig): Promise<Reading<string>> {
  return withTimeout(TIMEOUT_MS.tesouro, async () => {
    // ESCOLHER O LEITOR É PARTE DA LEITURA.
    //
    // Cada carteira é fotografada por DOIS leitores toda hora: `wallet` (RPC,
    // o mesmo da página de tesouro) e `address` (Zerion). Eu pegava a linha
    // mais recente por endereço — e com duas linhas por hora, o número que o
    // agente afirmava dependia da ordem que o banco devolvesse.
    //
    // Fixei no `wallet`, e não por acaso: medindo os dois lado a lado por 88
    // horas, o Zerion lê o multisig da SkateHive em US$ 2.201 contra US$ 84 do
    // RPC. A diferença é airdrop — 27 tokens, quase todos lixo sem liquidez,
    // que o Zerion precifica e o RPC ignora. O leitor da página é o conservador,
    // e é o mesmo número que a pessoa vê na tela.
    const rows = await prisma.treasuryWalletSnapshot.findMany({
      where: { projectSlug: project.slug, reader: "wallet" },
      orderBy: { takenAt: "desc" },
      take: 40,
      select: {
        label: true,
        address: true,
        totalUsd: true,
        reason: true,
        failedChains: true,
        takenAt: true,
        kind: true,
      },
    });
    if (rows.length === 0) {
      throw Object.assign(new Error("nenhum snapshot de tesouro para este portal"), { empty: true });
    }
    // Uma linha por carteira: a mais recente de cada.
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!latest.has(r.address)) latest.set(r.address, r);

    const lidas = [...latest.values()].filter((r) => r.totalUsd !== null);
    const falhas = [...latest.values()].filter((r) => r.totalUsd === null);
    const total = lidas.reduce((a, r) => a + (r.totalUsd ?? 0), 0);
    const asOf = [...latest.values()][0]?.takenAt?.toISOString().slice(0, 16).replace("T", " ");

    // COBERTURA — a parte que faltava, e que tornava este número perigoso.
    //
    // O snapshot cobre as carteiras EVM que o cron varre. O portal pode ter mais
    // coisa configurada (contas Hive, carteiras que o cron ainda não pegou) que
    // não entra aqui. Sem dizer isso, o agente apresentaria um total parcial
    // como se fosse o tesouro inteiro — com a mesma confiança de sempre e sem
    // ninguém notar. O número passa a vir acompanhado do que ele deixa de fora.
    const cfgEvm = project.treasury?.ethWallets?.length ?? 0;
    const cfgHive = project.treasury?.hiveAccounts?.length ?? 0;
    const cobre = `cobre ${latest.size} de ${cfgEvm} carteira(s) EVM configurada(s)`;
    const foraHive = cfgHive > 0 ? `; ${cfgHive} conta(s) Hive do tesouro NÃO entram nesta leitura` : "";
    const nCart = (n: number) => `${n} carteira${n === 1 ? "" : "s"}`;

    const out = [
      falhas.length === 0
        ? `Total ~US$ ${Math.round(total).toLocaleString("pt-BR")} em ${nCart(lidas.length)} (snapshot de ${asOf}; ${cobre}${foraHive}).`
        : `Total PARCIAL ~US$ ${Math.round(total).toLocaleString("pt-BR")} em ${nCart(lidas.length)} de ${latest.size} (snapshot de ${asOf}; ${cobre}${foraHive}).`,
    ];
    if (latest.size < cfgEvm || cfgHive > 0) {
      out.push(
        "  Este total NÃO é o tesouro inteiro do portal. Se a pergunta for sobre o total, diga o que ele cobre.",
      );
    }
    for (const f of falhas) {
      out.push(
        `  NÃO CONSEGUI LER a carteira "${f.label}" (${f.kind}): ${f.reason || "sem motivo registrado"}${
          f.failedChains.length ? ` — redes: ${f.failedChains.join(", ")}` : ""
        }`,
      );
    }
    if (falhas.length > 0) {
      out.push("  Este total está INCOMPLETO. Não o apresente como o tesouro inteiro.");
    }
    out.push(
      "  Vem do leitor por RPC, o mesmo da página de Tesouro — conta o que está declarado na config e ignora token de airdrop sem liquidez.",
    );
    return out.join("\n");
  });
}

/**
 * Receita, da ÚLTIMA sincronização gravada — não da rede.
 *
 * As fontes vivem nos cards do org-chart (`SopaBoard`, board "orgchart", em
 * `meta.revenueStreams`) e o cron grava o saldo em RevenueSnapshot. Aqui a
 * gente só lê o que já foi sincronizado.
 *
 * Detalhe que torna esta leitura confiável: quando o saldo falha, o cron NÃO
 * grava linha (`if (!bal) continue`). Então um 0 nesta tabela é um zero de
 * verdade, e não uma falha disfarçada. O que pode enganar é o contrário —
 * fonte SEM linha parecer que não existe — e é por isso que o bloco compara o
 * que tem leitura contra o que está cadastrado, e diz a diferença.
 */
async function readRevenue(): Promise<Reading<string>> {
  return withTimeout(TIMEOUT_MS.receita, async () => {
    const cards = await prisma.sopaBoard.findMany({
      where: { board: "orgchart" },
      select: { id: true, title: true, meta: true },
    });

    type Alvo = { cardId: string; card: string; address: string; label: string };
    const rastreadas: Alvo[] = [];
    let manuais = 0;
    for (const c of cards) {
      const meta =
        c.meta && typeof c.meta === "object" && !Array.isArray(c.meta)
          ? (c.meta as Record<string, unknown>)
          : {};
      const streams = Array.isArray(meta.revenueStreams)
        ? (meta.revenueStreams as Record<string, unknown>[])
        : [];
      for (const st of streams) {
        const address = typeof st.address === "string" ? st.address.trim().toLowerCase() : "";
        const label = typeof st.label === "string" ? st.label : "(sem rótulo)";
        if (!/^0x[a-f0-9]{40}$/.test(address)) {
          manuais++;
          continue;
        }
        rastreadas.push({ cardId: c.id, card: c.title ?? "(sem título)", address, label });
      }
    }
    if (rastreadas.length === 0 && manuais === 0) {
      throw Object.assign(new Error("nenhuma fonte de receita cadastrada no org-chart"), {
        empty: true,
      });
    }

    const snaps = await prisma.revenueSnapshot.findMany({
      orderBy: { takenAt: "desc" },
      take: 400,
      select: { cardId: true, address: true, label: true, totalUsd: true, takenAt: true },
    });
    if (snaps.length === 0) {
      throw Object.assign(new Error("nenhuma sincronização de receita gravada ainda"), {
        empty: true,
      });
    }

    // A mais recente de cada (card, endereço).
    const ultima = new Map<string, (typeof snaps)[number]>();
    for (const sn of snaps) {
      const k = `${sn.cardId}:${sn.address}`;
      if (!ultima.has(k)) ultima.set(k, sn);
    }

    // Duas fontes do mesmo card podem ter o MESMO rótulo em endereços
    // diferentes — e aí a linha aparece duplicada e parece defeito. Quando
    // isso acontece, o fim do endereço desempata.
    const repetido = new Map<string, number>();
    for (const a of rastreadas) {
      const k = `${a.cardId}:${a.label}`;
      repetido.set(k, (repetido.get(k) ?? 0) + 1);
    }

    const porCard = new Map<string, string[]>();
    let comLeitura = 0;
    for (const alvo of rastreadas) {
      const sn = ultima.get(`${alvo.cardId}:${alvo.address}`);
      if (!sn) continue;
      comLeitura++;
      const rotulo = sn.label || alvo.label;
      const desempate =
        (repetido.get(`${alvo.cardId}:${alvo.label}`) ?? 0) > 1 ? ` (…${alvo.address.slice(-4)})` : "";
      const linha = `${rotulo}${desempate}: US$ ${Math.round(sn.totalUsd).toLocaleString("pt-BR")}`;
      porCard.set(alvo.card, [...(porCard.get(alvo.card) ?? []), linha]);
    }

    const quando = snaps[0].takenAt.toISOString().slice(0, 16).replace("T", " ");
    const out = [...porCard.entries()].map(([card, ls]) => `- ${card} — ${ls.join(" · ")}`);
    out.push(
      `Sincronização de ${quando}. Cobre ${comLeitura} de ${rastreadas.length} fontes on-chain cadastradas` +
        (manuais > 0 ? `; ${manuais} fonte(s) são manuais e não têm leitura automática` : "") +
        ".",
    );
    if (comLeitura < rastreadas.length) {
      out.push(
        "  As fontes sem leitura NÃO valem zero — não há número para elas nesta sincronização.",
      );
    }
    return out.join("\n");
  });
}

/**
 * Quem é a equipe deste portal.
 *
 * Junta as duas metades que o catálogo da equipe já usa: quem tem ACESSO
 * (TeamMember, a mesma tabela que decide o login) e quem a pessoa É
 * (MemberSkills — papéis, território, cidade, bio). Sem isto o agente sabia o
 * username de quem está falando e mais nada sobre o time em volta.
 */
async function readTeam(project: ProjectConfig): Promise<Reading<string>> {
  return withTimeout(TIMEOUT_MS.equipe, async () => {
    const membros = await prisma.teamMember.findMany({
      where: { projectSlug: { in: ["*", project.slug] } },
      select: { username: true, role: true, projectSlug: true },
    });
    if (membros.length === 0) {
      throw Object.assign(new Error("nenhum membro cadastrado para este portal"), { empty: true });
    }
    const perfis = await prisma.memberSkills.findMany({
      where: { username: { in: membros.map((m) => m.username) } },
      select: { username: true, roles: true, territory: true, location: true, bio: true },
    });
    const porUser = new Map(perfis.map((p) => [p.username, p]));

    // Global manda: quem tem linha "*" é admin em todo portal.
    const vistos = new Map<string, string>();
    for (const m of membros) {
      const atual = vistos.get(m.username);
      if (m.projectSlug === "*") vistos.set(m.username, "admin global");
      else if (!atual) vistos.set(m.username, m.role);
    }

    const linhas = [...vistos.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([user, papel]) => {
        const p = porUser.get(user);
        const extras = [
          p?.roles?.length ? p.roles.join(", ") : "",
          p?.territory ?? "",
          p?.location ?? "",
        ].filter(Boolean);
        const bio = p?.bio ? ` — ${trim(p.bio, 120)}` : "";
        return `- @${user} (${papel})${extras.length ? ` — ${extras.join(" · ")}` : ""}${bio}`;
      });
    return linhas.join("\n");
  });
}

/** Como cada leitura vira texto — os três estados, todos visíveis. */
function renderReading(titulo: string, r: Reading<string>): string {
  if (r.state === "ok") return `## ${titulo}\n${r.value}`;
  if (r.state === "insufficient") return `## ${titulo}\n(sem dados: ${r.note})`;
  return `## ${titulo}\nNÃO CONSEGUI LER: ${r.reason}. Não trate isto como vazio nem como zero — é desconhecido.`;
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

export type ChatContext = { block: string; chars: number };

/** Monta o bloco do zero, sem olhar cache nenhum. */
async function assembleChatContext(project: ProjectConfig): Promise<ChatContext> {
  const falha = (e: unknown) => ({ state: "unread", reason: String(e) }) as Reading<string>;
  const [board, allTasks, meetings, treasury, revenue, team, engajamento, briefing, social] = await Promise.all([
    readBoard(project).catch(falha),
    readAssignedTasks(project).catch(falha),
    readMeetings(project).catch(falha),
    readTreasury(project).catch(falha),
    readRevenue().catch(falha),
    readTeam(project).catch(falha),
    readEngagement(project).catch(falha),
    readBriefing(project).catch(falha),
    readSocial(project).catch(falha),
  ]);

  // A camada A não faz I/O, mas lê config escrito à mão: um campo com formato
  // inesperado não pode derrubar a mensagem inteira do chat. Se ela falhar, o
  // bloco sai sem ela e DIZ que saiu — mesma regra dos sinais vivos.
  let perfil: string;
  let irmaos: string;
  try {
    perfil = serializeProject(project);
    irmaos = serializeSiblings(project);
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    perfil = `# ${project.name} (slug ${project.slug})\nNÃO CONSEGUI LER o perfil deste portal: ${motivo}.`;
    irmaos = "";
  }

  const partes = [
    `[contexto — montado em ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC]`,
    "Tudo abaixo veio do próprio portal. Use como VERDADE DE CAMPO — não re-busque, não recalcule.",
    "O que NÃO estiver aqui você não sabe: diga que não sabe em vez de chutar. Nunca invente número, card, prazo ou responsável.",
    "Onde estiver escrito NÃO CONSEGUI LER, a leitura falhou — isso não é zero nem lista vazia, é desconhecido, e deve ser dito como tal se a pergunta depender daquilo.",
    "",
    perfil,
    "",
    irmaos,
    "",
    "# Sinais vivos",
    renderReading("Board", board),
    renderReading("Minhas tarefas em todos os portais", allTasks),
    renderReading("Ações em aberto das atas", meetings),
    renderReading("Tesouro", treasury),
    renderReading("Receita (última sincronização)", revenue),
    renderReading("Equipe deste portal", team),
    renderReading("Redes sociais (seguidores)", social),
    renderReading("Engagement (trail de curadoria)", engajamento),
    renderReading("Último home summary (briefing)", briefing),
    "[/contexto]",
  ].filter((p) => p !== "");

  const block = partes.join("\n");
  const ctx = { block, chars: block.length };
  blockCache.set(project.slug, { at: Date.now(), ctx });
  // Grava para o próximo processo — é isto que tira os 2,4s do caminho frio.
  await prisma.chatContextCache
    .upsert({
      where: { projectSlug: project.slug },
      create: { projectSlug: project.slug, block, chars: ctx.chars },
      update: { block, chars: ctx.chars, builtAt: new Date() },
    })
    .catch(() => {});
  return ctx;
}

/**
 * O bloco [contexto] para este portal. Nunca lança: uma falha aqui não pode
 * derrubar a mensagem, e no pior caso o chat volta a ser o que era antes.
 */
export async function buildChatContext(project: ProjectConfig): Promise<ChatContext> {
  const mem = blockCache.get(project.slug);
  if (mem && Date.now() - mem.at < MEM_TTL_MS) return mem.ctx;

  const row = await prisma.chatContextCache
    .findUnique({ where: { projectSlug: project.slug } })
    .catch(() => null);

  if (row) {
    const ctx = { block: row.block, chars: row.chars };
    const idade = Date.now() - row.builtAt.getTime();
    blockCache.set(project.slug, { at: Date.now(), ctx });
    if (idade > FRESH_MS && !refreshing.has(project.slug)) {
      // Velho: entrega este e remonta por trás. Se o processo morrer antes de
      // terminar, ninguém perde nada — a próxima requisição tenta de novo.
      refreshing.add(project.slug);
      void assembleChatContext(project)
        .catch(() => {})
        .finally(() => refreshing.delete(project.slug));
    }
    return ctx;
  }

  // Nunca montado: aí sim vale esperar.
  try {
    return await assembleChatContext(project);
  } catch {
    return { block: "", chars: 0 };
  }
}
