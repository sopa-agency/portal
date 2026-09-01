// As perguntas fechadas do /app-idea, num só lugar.
//
// O formulário mostra os rótulos e o servidor valida contra os mesmos `value`s.
// Se as duas listas morassem em arquivos diferentes, um dia uma opção nova
// apareceria na tela e seria recusada na gravação — o pior tipo de bug, porque
// só o visitante o vê.
//
// Os `value` são estáveis e em inglês porque viram dado no banco; o que a
// pessoa lê são os `label`, em português.

export type Choice = { value: string; label: string; hint?: string };

export type Question = {
  /** Campo correspondente no modelo AppIdea. */
  id: "kind" | "audience" | "existing" | "urgency" | "budget";
  title: string;
  /** Uma linha abaixo do título, quando a pergunta precisa de contexto. */
  note?: string;
  choices: Choice[];
};

export const QUESTIONS: Question[] = [
  {
    id: "kind",
    title: "Que tipo de coisa é?",
    note: "Chute se não souber — a gente ajusta depois.",
    choices: [
      { value: "web", label: "App web" },
      { value: "mobile", label: "App de celular" },
      { value: "site", label: "Site" },
      { value: "automation", label: "Automação" },
      { value: "bot", label: "Bot" },
      { value: "ai-agent", label: "Agente de IA" },
      { value: "unsure", label: "Não sei" },
    ],
  },
  {
    id: "audience",
    title: "Pra quem é?",
    choices: [
      { value: "me", label: "Só pra mim" },
      { value: "team", label: "Meu time" },
      { value: "clients", label: "Meus clientes" },
      { value: "public", label: "Público geral" },
    ],
  },
  {
    id: "existing",
    title: "Como isso funciona hoje?",
    note: "O que já existe conta muito: é de onde a primeira versão sai.",
    choices: [
      { value: "nothing", label: "Não existe nada" },
      { value: "spreadsheet", label: "Uma planilha" },
      { value: "other-app", label: "Outro app" },
      { value: "paper", label: "No papel / na cabeça" },
    ],
  },
  {
    id: "urgency",
    title: "Pra quando?",
    choices: [
      { value: "this-week", label: "Essa semana" },
      { value: "this-month", label: "Esse mês" },
      { value: "this-quarter", label: "Esse trimestre" },
      { value: "no-rush", label: "Sem pressa" },
    ],
  },
  {
    id: "budget",
    title: "Quanto dá pra investir?",
    note: "Responder “não sei” aqui é resposta de verdade, não fuga.",
    choices: [
      { value: "under-5k", label: "Até R$ 5 mil" },
      { value: "5k-15k", label: "R$ 5 a 15 mil" },
      { value: "15k-50k", label: "R$ 15 a 50 mil" },
      { value: "over-50k", label: "Acima de R$ 50 mil" },
      { value: "unknown", label: "Não sei" },
      { value: "want-to-understand", label: "Quero entender antes" },
    ],
  },
];

/** value → label, para a tela de triagem mostrar português e não slug. */
export const LABELS: Record<string, string> = Object.fromEntries(
  QUESTIONS.flatMap((q) => q.choices.map((c) => [`${q.id}:${c.value}`, c.label])),
);

export function labelFor(questionId: Question["id"], value: string): string {
  return LABELS[`${questionId}:${value}`] ?? value;
}

/** Limites por campo. O servidor corta; a tela avisa antes de cortar. */
export const LIMITS = {
  name: 120,
  contact: 200,
  pitch: 4000,
  successCriteria: 600,
  references: 1000,
} as const;

/** Prosa curta demais não é pedido, é assunto. */
export const MIN_PITCH = 40;

/**
 * Estados da triagem. Moram aqui e não no arquivo de actions porque um módulo
 * "use server" só pode exportar função async — uma constante lá é erro de build,
 * não de execução, e o build só reclama quando alguém já importou.
 */
export const STATUSES = ["new", "talking", "done", "archived"] as const;
export type IdeaStatus = (typeof STATUSES)[number];

const STATUS_LABEL: Record<IdeaStatus, string> = {
  new: "novo",
  talking: "conversando",
  done: "fechado",
  archived: "arquivado",
};

/** Aceita `string` porque é o que o banco devolve: uma linha antiga com um
 *  estado que não existe mais mostra o valor cru em vez de sumir da tela. */
export function statusLabel(status: string): string {
  return STATUS_LABEL[status as IdeaStatus] ?? status;
}
