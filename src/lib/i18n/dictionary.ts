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
