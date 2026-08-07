/**
 * Translations.
 *
 * English is the primary language and the fallback; Portuguese is the
 * secondary. The app is being translated one screen at a time, so this file
 * only holds what has already been wired up — everything else still renders
 * whatever is hardcoded in its component. Do not add keys speculatively;
 * add them as the screen they belong to gets converted.
 *
 * `pt` is typed as `typeof en`, so a key that exists in one language and not
 * the other is a compile error rather than a string that silently shows up in
 * the wrong language.
 *
 * Safe to import from both server and client components — no `next/headers`.
 */

export const LOCALES = ["en", "pt"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "portal-locale";

/** A year — the switch is a preference, not a session detail. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Shown on the language switch itself, so each label is in its OWN language —
 *  someone stuck in the language they can't read still recognises their own. */
export const LOCALE_LABEL: Record<Locale, string> = {
  en: "English",
  pt: "Português",
};

/** Two letters for the button face. */
export const LOCALE_SHORT: Record<Locale, string> = {
  en: "EN",
  pt: "PT",
};

const en = {
  /** Shared controls, not tied to one screen. */
  ui: {
    date: {
      open: "Choose a date",
      empty: "No date",
      today: "Today",
      clear: "Clear",
      prevMonth: "Previous month",
      nextMonth: "Next month",
    },
  },
  nav: {
    switchLanguage: "Switch language",
    // Sidebar chrome.
    openMenu: "Open menu",
    closeMenu: "Close menu",
    expand: "Expand",
    collapse: "Collapse",
    menu: "menu",
    search: "Search",
    searchPages: "Search pages",
    switchWorkspace: "Switch workspace",
    logOut: "Log out",
    connected: "connected",
    resizeMenu: "Resize menu",
    resizeHint: "Drag to resize · double-click to restore",
    /** Section headers. Keys are stable; only these strings change. */
    groups: {
      creation: "Creation",
      growth: "Growth",
      publishing: "Publishing",
      operations: "Operations",
    },
    /** Every destination in the sidebar and the ⌘K palette. Product names that
     *  are the same word in both languages still live here, so the two lists
     *  cannot drift apart. */
    items: {
      home: "Home",
      postCreator: "Post Creator",
      zine: "Zine Studio",
      lab: "Lab",
      tiktok: "TikTok",
      campaignCreator: "Campaign Creator",
      postSuggestions: "Post Suggestions",
      engagement: "Engagement",
      analytics: "Analytics",
      userbase: "Userbase",
      magazine: "Magazine",
      homepage: "Homepage",
      kanban: "Kanban",
      treasury: "Treasury",
      orgChart: "Org Chart",
      portfolio: "Portfolio",
      briefs: "Briefs",
      meetings: "Meetings",
      about: "About",
      team: "Team",
      settings: "Settings",
      brain: "Brain",
    },
  },
  /**
   * Board chrome only — toolbar, filters and the board-level loading/error/empty
   * states. Everything inside a card (the card itself, its dialog, and the
   * toasts its actions raise) is deliberately absent: those strings are wired to
   * GitHub mutations and stay as they are until they get their own pass.
   */
  kanban: {
    people: "People",
    filterByPerson: "Filter by person",
    filteringByPerson: "Filtering by person",
    /** Chip next to the filters. Interpolated with the visible card count. */
    cardCount: (n: number) => `${n} ${n === 1 ? "card" : "cards"}`,
    partial: "(partial board)",
    partialTitle: "The board went past the number of items we fetch — some cards aren't here.",
    saving: "Saving",
    showDone: "Show completed",
    hideDone: "Hide completed",
    openInGitHub: "Open in GitHub",
    openInGitHubTitled: (title: string) => `Open ${title} on GitHub`,
    repo: "Repo",
    /** "All" chips. Split per filter because Portuguese genders them. */
    allPeople: "All",
    allRepos: "All",
    allProjects: "All",
    filterPerson: (login: string) => `Filter @${login}`,
    /** Repo picker in the "new card" form and in convert-draft-to-issue. */
    repoPlaceholder: "Choose the repo…",
    repoLabel: "Target repository for the issue",
    loadingBoard: "Loading the Kanban",
    loadFailed: "Failed to load the Kanban",
    loadFailedShort: "Failed to load",
    /** Three slots around the <code> scope names, which stay untranslated. */
    scopeHintPrefix: "Check that",
    scopeHintMiddle: "has the scopes",
    scopeHintAnd: "and",
    prs: {
      toggle: "Show the repositories' open pull requests",
      empty: "No open PRs in the project's repos.",
      draft: "draft",
      /** Relative time on each PR. Minutes/hours/days are the same letter in
       *  both languages; only these two differ. */
      now: "now",
      weeks: (n: number) => `${n}w`,
    },
    /** SOPA hub only: the read-only board that merges every portal's Kanban. */
    aggregate: {
      project: "Project:",
      person: "Person:",
      projectPicker: "Board for the new card",
      empty: "No tasks on the boards (or GitHub tokens unavailable).",
    },
  },
  team: {
    eyebrow: "People",
    title: "Team",
    description: "Who has access to this portal, and how to reach each of them.",
    /** Header chip. Interpolated with the roster size. */
    memberCount: (n: number) => `${n} ${n === 1 ? "member" : "members"}`,
    hide: "Hide",
    show: "Show",
    hideTitle: "Hide the team — handy before a screenshot",
    showTitle: "Show the team",
    hiddenPlaceholder: "Team hidden · click to show",
    roster: "Team",
    mvp: {
      loading: "Loading the team highlight",
      podium: "Podium",
      tabs: {
        week: "This week",
        lastWeek: "Last week",
        month: "This month",
        lastMonth: "Last month",
      },
      titles: {
        week: "Employee of the Week",
        lastWeek: "Employee of Last Week",
        month: "Employee of the Month",
        lastMonth: "Employee of Last Month",
      },
    },
  },
};

const pt: typeof en = {
  ui: {
    date: {
      open: "Escolher uma data",
      empty: "Sem data",
      today: "Hoje",
      clear: "Limpar",
      prevMonth: "Mês anterior",
      nextMonth: "Próximo mês",
    },
  },
  nav: {
    switchLanguage: "Trocar idioma",
    openMenu: "Abrir menu",
    closeMenu: "Fechar menu",
    expand: "Expandir",
    collapse: "Recolher",
    menu: "menu",
    search: "Buscar",
    searchPages: "Buscar páginas",
    switchWorkspace: "Trocar de portal",
    logOut: "Sair",
    connected: "conectado",
    resizeMenu: "Redimensionar menu",
    resizeHint: "Arraste para redimensionar · duplo clique para restaurar",
    groups: {
      creation: "Criação",
      growth: "Crescimento",
      publishing: "Publicação",
      operations: "Operação",
    },
    items: {
      home: "Início",
      postCreator: "Post Creator",
      zine: "Zine Studio",
      lab: "Lab",
      tiktok: "TikTok",
      campaignCreator: "Campaign Creator",
      postSuggestions: "Sugestões de Post",
      engagement: "Engajamento",
      analytics: "Analytics",
      userbase: "Base de Usuários",
      magazine: "Revista",
      homepage: "Homepage",
      kanban: "Kanban",
      treasury: "Tesouraria",
      orgChart: "Organograma",
      portfolio: "Portfólio",
      briefs: "Briefings",
      meetings: "Reuniões",
      about: "Sobre",
      team: "Equipe",
      settings: "Configurações",
      brain: "Brain",
    },
  },
  kanban: {
    people: "Pessoas",
    filterByPerson: "Filtrar por pessoa",
    filteringByPerson: "Filtrando por pessoa",
    cardCount: (n: number) => `${n} ${n === 1 ? "cartão" : "cartões"}`,
    partial: "(board parcial)",
    partialTitle: "O board passou do limite de itens que buscamos — alguns cards não estão aqui.",
    saving: "Salvando",
    showDone: "Mostrar concluídas",
    hideDone: "Ocultar concluídas",
    openInGitHub: "Abrir no GitHub",
    openInGitHubTitled: (title: string) => `Abrir ${title} no GitHub`,
    repo: "Repo",
    allPeople: "Todas",
    allRepos: "Todos",
    allProjects: "Todos",
    filterPerson: (login: string) => `Filtrar @${login}`,
    repoPlaceholder: "Escolha o repo…",
    repoLabel: "Repositório de destino da issue",
    loadingBoard: "Carregando o Kanban",
    loadFailed: "Falha ao carregar o Kanban",
    loadFailedShort: "Falha ao carregar",
    scopeHintPrefix: "Confirme que",
    scopeHintMiddle: "tem os escopos",
    scopeHintAnd: "e",
    prs: {
      toggle: "Mostrar pull requests abertos dos repositórios",
      empty: "Nenhum PR aberto nos repositórios do projeto.",
      draft: "rascunho",
      now: "agora",
      weeks: (n: number) => `${n}sem`,
    },
    aggregate: {
      project: "Projeto:",
      person: "Pessoa:",
      projectPicker: "Board do novo card",
      empty: "Nenhuma tarefa nos boards (ou tokens do GitHub indisponíveis).",
    },
  },
  team: {
    eyebrow: "Pessoas",
    title: "Equipe",
    description: "Quem tem acesso a este portal e como falar com cada um.",
    memberCount: (n: number) => `${n} ${n === 1 ? "membro" : "membros"}`,
    hide: "Ocultar",
    show: "Mostrar",
    hideTitle: "Ocultar a equipe — útil antes de um print",
    showTitle: "Mostrar a equipe",
    hiddenPlaceholder: "Equipe oculta · clique para mostrar",
    roster: "Equipe",
    mvp: {
      loading: "Carregando o destaque da equipe",
      podium: "Pódio",
      tabs: {
        week: "Esta semana",
        lastWeek: "Semana passada",
        month: "Este mês",
        lastMonth: "Mês passado",
      },
      titles: {
        week: "Funcionário da Semana",
        lastWeek: "Funcionário da Semana Passada",
        month: "Funcionário do Mês",
        lastMonth: "Funcionário do Mês Passado",
      },
    },
  },
};

export type Dictionary = typeof en;

const DICTIONARIES: Record<Locale, Dictionary> = { en, pt };

export function dictionaryFor(locale: Locale): Dictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}
