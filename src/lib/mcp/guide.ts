// O guia do servidor MCP: o que dá para pedir, em que ordem, e os atalhos.
//
// Mora num arquivo só, sem nada de servidor, porque três lugares falam a mesma
// coisa e não podem divergir: a ferramenta `get_guide` (o agente lê), os
// prompts do MCP (viram comandos "/" no cliente) e a aba Settings → API & MCP
// (a pessoa lê e copia).

export type Lang = "pt" | "en";
type Both = Record<Lang, string>;

/** Famílias de ferramentas, na ordem em que fazem sentido para quem chega. */
export const TOOL_GROUPS = [
  { id: "start", label: { pt: "Começar", en: "Start here" }, hint: { pt: "Quem sou, o que enxergo, o que dá para pedir.", en: "Who I am, what I can read, what to ask." } },
  { id: "project", label: { pt: "Estado do projeto", en: "Project state" }, hint: { pt: "Uma chamada para o retrato do projeto; o briefing do agente.", en: "One call for the project snapshot; the agent's briefing." } },
  { id: "work", label: { pt: "Trabalho", en: "Work" }, hint: { pt: "Kanban, cards, o que está no seu nome, reuniões e o que ficou decidido.", en: "Kanban, cards, what is on you, meetings and what was decided." } },
  { id: "money", label: { pt: "Dinheiro", en: "Money" }, hint: { pt: "Tesouro, custos fixos, quem recebe quanto.", en: "Treasury, fixed costs, who gets what." } },
  { id: "content", label: { pt: "Conteúdo", en: "Content" }, hint: { pt: "Campanhas, textos e crescimento das redes.", en: "Campaigns, copy and social growth." } },
  { id: "knowledge", label: { pt: "Memória dos agentes", en: "Agents' memory" }, hint: { pt: "Busca em tudo; playbooks, notas e memória dos OpenClaw.", en: "Search everything; the OpenClaw agents' playbooks, notes and memory." } },
  { id: "write", label: { pt: "Escrever", en: "Write" }, hint: { pt: "Opcional por token: anotar, criar e mover cards, fogo/prazo/dono, rascunho de campanha. Nada publica nem apaga.", en: "Opt-in per token: card notes, create and move cards, fire/deadline/owner, campaign drafts. Nothing posts or deletes." } },
  { id: "agents", label: { pt: "Perguntar ao agente", en: "Ask the agent" }, hint: { pt: "Gasta modelo: precisa do escopo agents, até 10 por dia.", en: "Spends model budget: needs the agents scope, up to 10 a day." } },
] as const satisfies readonly { id: string; label: Both; hint: Both }[];

export type ToolGroupId = (typeof TOOL_GROUPS)[number]["id"];

/** Pedidos prontos, na língua de quem pede. `<…>` é para trocar. */
export const EXAMPLES: { group: ToolGroupId; text: Both }[] = [
  { group: "start", text: { pt: "O que eu posso te pedir sobre a SOPA e os projetos dela?", en: "What can I ask you about SOPA and its projects?" } },
  { group: "start", text: { pt: "Quais projetos eu enxergo e qual é o meu papel em cada um?", en: "Which projects can I read and what is my role in each?" } },
  { group: "project", text: { pt: "Me dá o estado da Gnars hoje: o que está pegando fogo, o que travou e quanto tem no tesouro.", en: "Give me the state of Gnars today: what is on fire, what is stuck and how much is in the treasury." } },
  { group: "project", text: { pt: "Monta um resumo da semana com todos os projetos que eu enxergo.", en: "Put together a weekly update across every project I can read." } },
  { group: "work", text: { pt: "O que está no meu nome em todos os projetos? Ordena por urgência e me diz por onde começar.", en: "What is assigned to me across all projects? Order by urgency and tell me where to start." } },
  { group: "work", text: { pt: "Abre o card sobre <assunto> na SkateHive e me explica o que falta para fechar.", en: "Open the card about <topic> on SkateHive and explain what is missing to close it." } },
  { group: "work", text: { pt: "O que ficou decidido na última reunião da SOPA e o que ainda está aberto?", en: "What was decided in the last SOPA meeting and what is still open?" } },
  { group: "money", text: { pt: "Quanto a SOPA tem em caixa, quanto gasta por mês e quantos meses isso dá?", en: "How much does SOPA hold, how much does it spend a month and how many months is that?" } },
  { group: "money", text: { pt: "Lista os custos fixos da SkateHive do maior para o menor e aponta o que dá para cortar.", en: "List SkateHive's fixed costs from largest to smallest and point out what could be cut." } },
  { group: "content", text: { pt: "Escreve 3 tweets sobre <feature> na voz da Gnars, seguindo o playbook e sem repetir o que já está nas campanhas.", en: "Write 3 tweets about <feature> in the Gnars voice, following the playbook and without repeating what is already in the campaigns." } },
  { group: "content", text: { pt: "Como cresceram os seguidores da SkateHive nos últimos 30 dias, por rede?", en: "How did SkateHive's followers grow over the last 30 days, per network?" } },
  { group: "knowledge", text: { pt: "Procura \"Morpheus\" em tudo que o portal sabe e me diz onde aparece.", en: "Search for \"Morpheus\" across everything the portal knows and tell me where it shows up." } },
  { group: "knowledge", text: { pt: "Lê a memória do agente da SOPA e resume o que ele sabe sobre grants.", en: "Read the SOPA agent's memory and summarise what it knows about grants." } },
  { group: "write", text: { pt: "Anota no card <assunto> o que você descobriu e move ele para In progress.", en: "Leave a note on the <topic> card with what you found and move it to In progress." } },
  { group: "write", text: { pt: "Cria um card na SOPA para <tarefa>, fogo 3, no meu nome, com prazo para sexta.", en: "Create a card on SOPA for <task>, fire 3, owned by me, due Friday." } },
  { group: "write", text: { pt: "Escreve 3 tweets sobre <feature> e salva como rascunho na campanha de features da Gnars.", en: "Write 3 tweets about <feature> and save them as drafts in the Gnars features campaign." } },
  { group: "agents", text: { pt: "Pergunta para o agente da Gnars qual é o próximo passo da migração para a Clanker.", en: "Ask the Gnars agent what the next step of the Clanker migration is." } },
];

export type PromptArg = { name: string; description: string; required: boolean };
export type PromptDef = { name: string; title: string; description: Both; args: PromptArg[]; text: (a: Record<string, string>) => string };

const LANGUAGE_RULE = "Answer in the language I write in (Portuguese unless I write in another one). Say which date each piece of data is from, and never fill a gap with a guess: if a tool returns nothing, say so.";

/** Prompts do MCP. No Claude Code viram `/mcp__sopa__<nome>`; no Claude Desktop, o menu "+". */
export const PROMPTS: PromptDef[] = [
  {
    name: "comecar",
    title: "Começar",
    description: { pt: "Quem sou eu aqui e o que dá para pedir", en: "Who I am here and what I can ask" },
    args: [],
    text: () => `Use the SOPA portal server. Call whoami and get_guide. Then tell me briefly who I am connected as, which projects I can read (with my role), and six concrete things I can ask right now, picked from the guide to fit my projects. End by asking what I want to look at first. ${LANGUAGE_RULE}`,
  },
  {
    name: "resumo_projeto",
    title: "Resumo do projeto",
    description: { pt: "O estado de um projeto em uma tela", en: "One-screen state of a project" },
    args: [{ name: "project", description: "Project slug (sopa, gnars, skatehive…)", required: true }],
    text: (a) => `Call get_overview for the project "${a.project}". Summarise its state in under 200 words: what is hot on the board, what is overdue or stuck, the money (treasury, monthly cost, runway), campaigns in flight, and how old the briefing is. Flag anything stale. ${LANGUAGE_RULE}`,
  },
  {
    name: "minhas_tarefas",
    title: "Minhas tarefas",
    description: { pt: "O que está no meu nome, por urgência", en: "What is on me, by urgency" },
    args: [],
    text: () => `Call my_tasks. Group what comes back by project, order by fire priority and deadline, and tell me what to do first and why. Open with get_card only the cards you need to understand. ${LANGUAGE_RULE}`,
  },
  {
    name: "dinheiro",
    title: "Dinheiro",
    description: { pt: "Caixa, gasto mensal e quantos meses dá", en: "Cash, monthly spend and runway" },
    args: [{ name: "project", description: "Project slug; default sopa", required: false }],
    text: (a) => `For the project "${a.project || "sopa"}", call get_treasury and get_costs. Show the total held (and when it was read), the monthly cost in USD, the runway in months, the three largest costs, and anything in the balances marked unverified. Show the arithmetic. ${LANGUAGE_RULE}`,
  },
  {
    name: "ultima_reuniao",
    title: "Última reunião",
    description: { pt: "O que foi decidido e o que ficou aberto", en: "What was decided and what is still open" },
    args: [{ name: "project", description: "Project slug; default sopa", required: false }],
    text: (a) => `Call list_meetings for "${a.project || "sopa"}", pick the most recent one that has minutes, and read it with get_meeting. Give me the decisions, then the open action items grouped by owner with priority and deadline. ${LANGUAGE_RULE}`,
  },
  {
    name: "rascunho_post",
    title: "Rascunho de post",
    description: { pt: "Três versões na voz do projeto, seguindo o playbook", en: "Three drafts in the project's voice, following the playbook" },
    args: [
      { name: "project", description: "Project slug", required: true },
      { name: "tema", description: "What the post is about", required: true },
    ],
    text: (a) => `I want a post for "${a.project}" about: ${a.tema}. First read the project's playbook (list_brain_files, then read_brain_file on the pinned playbook) and check list_campaigns so you do not repeat what is already written. Then draft three variations in the project's voice. Never invent numbers, dates, prizes or mechanics: use only what the tools returned, and tell me what you could not confirm. ${LANGUAGE_RULE}`,
  },
  {
    name: "semana",
    title: "Resumo da semana",
    description: { pt: "Um update com todos os meus projetos", en: "One update across all my projects" },
    args: [],
    text: () => `Call whoami, then get_overview for each project I can read (at most five, the ones with a board first). Write one weekly update: per project, two or three lines on what moved, what is stuck and the money; then a short list of what needs a decision. ${LANGUAGE_RULE}`,
  },
];

/** A primeira mensagem que a aba sugere colar no agente depois de conectar. */
export const FIRST_MESSAGE: Both = {
  pt: "Usa o servidor sopa: roda whoami e get_guide e me diz quem eu sou aí, quais projetos eu enxergo e o que eu posso te pedir.",
  en: "Use the sopa server: run whoami and get_guide and tell me who I am there, which projects I can read and what I can ask you.",
};
