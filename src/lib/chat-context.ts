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
import { getProjectKanbanContext } from "@/lib/kanban-context";
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
const TIMEOUT_MS = { board: 4_000, atas: 6_000, tesouro: 3_000 } as const;

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
 * pode. Por isso perguntamos ANTES ao `fetchGitHubProject`, que diz `ok`. O
 * board é cacheado, então a segunda chamada não custa outra ida à rede.
 */
async function readBoard(project: ProjectConfig): Promise<Reading<string>> {
  if (!project.githubProject) {
    return insufficient<string>("este portal não tem board configurado");
  }
  return withTimeout(TIMEOUT_MS.board, async () => {
    const board = await fetchGitHubProject(project);
    if (!board.ok) throw new Error(board.error || "o board não respondeu");
    const text = await getProjectKanbanContext(project);
    if (!text.trim()) throw new Error("o board respondeu, mas o contexto veio vazio");
    return text;
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
    const n = await prisma.meetingOccurrence.count({ where: { projectSlug: "sopa" } });
    if (n === 0) throw Object.assign(new Error("nenhuma ata registrada"), { empty: true });
    const text = await getProjectMeetingsContext(project);
    if (!text.trim()) {
      throw Object.assign(new Error("nenhuma ação em aberto nas atas recentes"), { empty: true });
    }
    return trimMeetings(text);
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
    const rows = await prisma.treasuryWalletSnapshot.findMany({
      where: { projectSlug: project.slug },
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
    return out.join("\n");
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
  const [board, meetings, treasury] = await Promise.all([
    readBoard(project).catch((e) => ({ state: "unread", reason: String(e) }) as Reading<string>),
    readMeetings(project).catch((e) => ({ state: "unread", reason: String(e) }) as Reading<string>),
    readTreasury(project).catch((e) => ({ state: "unread", reason: String(e) }) as Reading<string>),
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
    renderReading("Ações em aberto das atas", meetings),
    renderReading("Tesouro", treasury),
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
