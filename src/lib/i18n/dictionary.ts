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
  /**
   * The treasury screen's spine: header, the health hero, the section headings,
   * the in/out dashboard, the holdings view and the on-chain revenue block —
   * i.e. everything a visitor reads on the way down the page. The operational
   * panels behind the SOPA tabs (payroll, staking, vaults, the costs editor)
   * are not here yet; they are tools, not the story the page tells.
   */
  treasury: {
    title: "Treasury",
    /** SOPA: one portal's Safe plus every treasury it operates. */
    titleMulti: "Treasury overview",
    description: "The same wallets and sources the native app shows — live balances across several networks.",
    descriptionMulti: (name: string) =>
      `${name}'s Safe plus every treasury of the portals it operates — the same wallets and sources as the native apps.`,
    /** Header badge. The claim the description makes, made visible. */
    live: "live",
    liveTitle: "Balances are read on every load, cached for at most 5 minutes.",
    hero: {
      treasury: "Treasury",
      wallets: (n: number) => `across ${n} wallet${n === 1 ? "" : "s"}`,
      noWallets: "no wallets configured",
      health: "Health",
      runway: "Runway",
      runwayTitle: "How long the cash lasts if spending continues at the current pace.",
      months: "months",
      /** Verdict per runway band: <3 months danger · <12 warning · else ok. */
      verdicts: {
        noCosts: { label: "No costs", phrase: "Nothing going out — the treasury only accumulates." },
        warning: { label: "Watch it", phrase: "Under a year of cash — worth following closely." },
        danger: { label: "Critical", phrase: "Under 3 months of cash at the current pace." },
        ok: { label: "Healthy", phrase: "The cash covers well over a year at the current pace." },
      },
      currentPace: "at the current spending pace",
      countingCosts: (value: string) => `counting ${value}/mo of costs`,
      countingCostsAll: (value: string) => `counting ${value}/mo of costs across every project`,
      noCostsFiled: "no fixed costs filed under this filter",
    },
    sections: {
      inOut: "Money in vs out",
      inOutHint: "What came in and what went out, month by month.",
      revenue: "Where the revenue comes from",
      revenueHint: "This project's on-chain sources — auctions and splits, read straight from the blockchain.",
      where: "Where the money is",
      whereHint: "Every wallet and asset that makes up the treasury.",
      whereHintAll: "Every wallet and asset that makes up the treasury, across every project.",
      costs: "Fixed costs",
      costsHint: "What goes out every month — this is what sets the runway above.",
      costsMonthly: (value: string) => `${value}/mo in active costs`,
      costsNone: "no costs filed",
    },
    filterHint: "the filter adjusts every number below",
    all: "All",
    tabs: {
      treasury: "Treasury",
      costs: "Costs",
      members: "Members",
      support: "Support",
      plan: "Financial plan",
    },
    refresh: {
      action: "Refresh",
      busy: "Refreshing…",
      title: "Refresh balances (skips the 5-min cache)",
      done: "updated just now",
    },
    briefing: { action: "How are we doing", title: "Read the treasury status in plain words" },
    dashboard: {
      in: "In",
      out: "Out",
      net: "Net for the period",
      noMovement: "no movement in the period",
      netPositive: (period: string) => `more came in than went out over the last ${period}`,
      netNegative: (period: string) => `more went out than came in over the last ${period}`,
      months: (n: number) => `${n} ${n === 1 ? "month" : "months"}`,
      barIn: (value: string) => `In ${value}`,
      barOut: (value: string) => `Out ${value}`,
      mixTitle: "Where the revenue comes from",
      mixHint: "Jobs = agency work. On-chain = the brands' share of auctions and swaps.",
      brands: "Brands (on-chain)",
      agency: "Agency (jobs)",
    },
    views: {
      combined: "Combined treasury",
      fallback: "Treasury",
      assets: "Assets",
      wallets: "Wallets",
      networks: "Networks",
      byProject: "By project",
      byAsset: "By asset",
      others: "Others",
      walletDetail: "Per-wallet detail",
      assetCount: (n: number) => `${n} asset${n === 1 ? "" : "s"}`,
      loadFailed: "Couldn't load balances:",
      noBalances: "No balances above dust.",
      aprEstimate: "Estimate — HP yield comes from inflation (vesting); curation varies.",
      aprSavings: "HBD savings interest rate (on-chain).",
      pricesNote: (hive: string, hbd: string) =>
        `HIVE ${hive} · HBD ${hbd} via CoinGecko. HP = owned vesting shares (incl. delegated out), same math as skatehive.app/dao. Sources cached 5 min.`,
      aprFootnote: "* The HP APR is an estimate (inflation → vesting); the HBD savings one is the on-chain rate.",
    },
    revenue: {
      title: "On-chain revenue",
      hintAll: "Revenue sources tracked per project — live reads of the same wallets and contracts as the org chart.",
      hintOne: "This project's tracked revenue sources — live on-chain reads (configured in the org chart).",
      realized: "Realized revenue",
      balance: "Current balance",
      balanceShort: "balance",
      auction: "🔨 Auction revenue",
      split: "💧 Distributed (split)",
      auctions: "auctions",
      distributions: "distributions",
      insideNow: "inside now",
      partial: "partial",
      partialTitle: "long history — showing part of it",
      received: "Received",
      paid: "Paid out",
    },
  },
  /**
   * Meetings calendar. The grid's own words only — day names, month names and
   * times come from Intl with the active locale, so they are not keys here.
   * The post-meeting minutes panel (MeetingAtaPanel) is a separate surface and
   * has not been converted yet.
   */
  meetings: {
    title: "Meetings",
    subtitle: "Weekly calendar · click a slot to schedule",
    all: "All",
    views: { day: "Day", week: "Week", month: "Month" },
    today: "Today",
    prev: "Previous",
    next: "Next",
    newMeeting: "New meeting",
    slotHint: "Schedule",
    moreEvents: (n: number) => `+${n} more`,
    moreDeadlines: (n: number) => `+${n} deadlines`,
    owners: (n: number) => `${n} owner${n === 1 ? "" : "s"}`,
    deadlineTitle: "Deadline",
    dismiss: "Dismiss",
    availability: {
      action: "Availability",
      title: "Team availability",
      show: "show",
      checking: "checking…",
      connected: "connected",
      notShared: "not shared",
      error: "error",
      none: "Nobody has an email yet. Add the team's emails on the Team tab and they show up here.",
      extras: "Extras",
      /** Split around the copy-to-clipboard chip holding the service account. */
      sharePrefix: "For someone to show as",
      shareSuffix: "they share “See free/busy” from their Google Calendar with:",
      createdIn: "Meetings are created on the calendar:",
      addExtra: "+ Extra calendar (outside the team / iCal)",
      namePlaceholder: "Name (person)",
      icsPlaceholder: "email@gmail.com or https://…/basic.ics",
      addAction: "Add calendar",
      busy: (name: string) => `${name} · busy`,
    },
    editor: {
      createTitle: "New meeting",
      editTitle: "Edit meeting",
      close: "Close",
      titlePlaceholder: "Meeting title",
      project: "Project",
      kind: "Type",
      kinds: { plan: "[PLAN] Planning", exec: "[EXEC] Execution" },
      start: "Starts",
      date: "Date",
      time: "Time",
      duration: "Duration",
      durations: { m15: "15 min", m30: "30 min", m60: "1 hour", m90: "1h30", m120: "2 hours" },
      customDuration: (n: number) => `${n} min`,
      weekly: "Repeat every week",
      color: (hex: string) => `Colour ${hex}`,
      attendees: "Invitees",
      ownerHint: " — click the ★ to mark the owner",
      noMembers: "This project has nobody with an email — add them on the Team tab, or type one below.",
      emailPlaceholder: "email@example.com",
      add: "Add",
      owner: "Owner (responsible)",
      makeOwner: "Mark as owner",
      agenda: "Agenda",
      agendaPlaceholder: "Agenda / what will be discussed",
      inviteEmail: "Invite email",
      inviteCustom: "(custom)",
      inviteDefault: "(default)",
      inviteEmailPlaceholder: "Empty = default email. Use Improve with AI to generate one.",
      openInGoogle: "Open in Google Calendar",
      save: "Save",
      delete: "Delete meeting",
      needTitle: "Give the meeting a title.",
      created: "Meeting created",
      invitesSent: (n: number) => `${n} invite${n === 1 ? "" : "s"} sent`,
      invitesFailed: (err: string) => `invites failed (${err})`,
      inviteError: (err: string) => `invites: ${err}`,
      googleError: (err: string) => `Google: ${err}`,
    },
  },
  /**
   * Engagement (the /curadoria route). The frame — header, tabs, the per-tab
   * explainer — plus the Instagram inbox. The Trail, Snaps and Blog panels are
   * still hardcoded; they are three separate inboxes and get their own pass.
   */
  engagement: {
    title: "Engagement",
    description: "Curation across our networks — every reply approved by a human before it goes out.",
    tabs: { trail: "Trail", snaps: "Snaps", blog: "Blog", instagram: "Instagram" },
    info: {
      trail: "Curation trail between our accounts: automatic like (Farcaster) / upvote (Hive) on partner posts, plus a generated reply for you to approve and post.",
      snaps: "Recent snaps from the SkateHive community. Comment as the portal account or boost one — userbase upvotes are released gradually, at the pace of real engagement.",
      blog: "Recent blog posts (magazine) from the project's Hive community. Comment as the portal account or boost the best ones with hiveboost.",
      instagram: "Comments on our Instagram posts. Reply straight from here — a comment leaves the queue once you answer and only returns if the person replies again.",
    },
    instagram: {
      caption: "comments on your posts · reply from here",
      generateAll: (n: number) => `Generate all (${n})`,
      refresh: "Refresh",
      loading: "Loading Instagram comments…",
      loadFailed: "Couldn't load the comments.",
      scopeHint: "Reissue the Instagram token with the scope",
      scopeHintTail: "and update",
      retry: "Try again",
      allDone: (n: number) => `All answered across the last ${n} posts — nothing waiting. 🎉`,
      loadMore: (n: number) => `Load more posts (scanning ${n})`,
      noCaption: "(no caption)",
      openInInstagram: "Open on Instagram",
      hide: "Hide comment",
      unhide: "Show comment again",
      hidden: "hidden",
      likes: (n: number) => `${n} likes`,
      replyPlaceholder: "Reply…",
      reply: "Reply",
      generate: "Generate a reply with AI",
      user: "user",
      you: "you",
      /** The row's state right after you answer, before it leaves the queue. */
      answered: "Answered",
      answeredLog: (n: number) => `Answered in this session (${n})`,
      now: "now",
      minutes: (n: number) => `${n}min`,
      hours: (n: number) => `${n}h`,
      days: (n: number) => `${n}d`,
    },
  },
  /**
   * Home. Chrome only: the briefing prose and the Kanban task cards are data
   * from the agent and from GitHub, and stay in whatever language they were
   * written in.
   */
  home: {
    /** Time of day decides which one. The page is a morning brief, so that's
     *  the server's guess until the client's clock says otherwise. */
    greeting: {
      morning: (name: string) => `Good morning, ${name}`,
      afternoon: (name: string) => `Good afternoon, ${name}`,
      evening: (name: string) => `Good evening, ${name}`,
      /** No session — nobody to greet. */
      anonymous: "Today",
    },
    tabs: { brief: "Morning brief", socials: "Socials" },
    /** Briefing freshness, in the header beside the button that fixes it. */
    briefings: {
      fresh: "briefings up to date",
      stale: (n: number) => `${n} briefing${n > 1 ? "s" : ""} out of date`,
      none: "no briefing yet",
    },
    tasks: {
      title: "My tasks",
      /** Header count. The cards themselves are GitHub's, untranslated. */
      count: (n: number) => `${n} on the Kanban`,
      overdue: (n: number) => `${n} overdue`,
      dueToday: (n: number) => `${n} due today`,
      allClear: "nothing overdue",
      expand: "Show tasks",
      collapse: "Hide tasks",
      open: "Open card on the Kanban",
    },
  },
  /**
   * Post Suggestions. Chrome only — the generated post text inside the cards is
   * the product, written by the agent in whatever language it was prompted in,
   * and is never translated here.
   */
  postSuggestions: {
    title: "Post Suggestions",
    /** One line. The tabs below say where the drafts come from — the old
     *  second half of this sentence was an inventory of them. */
    description: (project: string) =>
      `Ready-to-post drafts for ${project}. One run, multiple platforms.`,
    /**
     * Header health. Quiet when both generators are up; it only claims
     * attention when one is stale or down, which is the only time the word
     * "worker" is worth a reader's time.
     */
    status: {
      ok: "workers running",
      stale: "worker stale",
      down: "worker not running",
      /** Tooltip — the detail, for when the dot isn't enough. */
      detail: (community: string, repo: string) =>
        `community: ${community} · repo: ${repo}`,
    },
    tabs: {
      label: "Draft sources",
      community: "Community",
      repo: "Repo to Social",
      crosspost: "Cross-post",
      calendar: "Calendar",
    },
    /** Worker health, shared by both tabs. */
    worker: {
      active: "active",
      idle: "running (idle)",
      stale: "stale",
      offline: "not running",
      unknown: "unknown",
    },
    board: {
      generating: "Generating",
      drafted: "Drafts",
      approved: "Approved",
      published: "Published",
      /** Empty-column hints. The two tabs differ in the verb that fills them. */
      emptyCommunity: {
        generating: "Click “Suggest posts” to queue a run.",
        drafted: "Drafts will land here once generated.",
        approved: "Approve a draft to move it here.",
        published: "Posted suggestions show up here.",
      },
      emptyRepo: {
        generating: "Click “Generate now” to queue a run.",
        drafted: "Drafts will land here once generated.",
        approved: "Approve a draft to move it here.",
        published: "Posted tweets show up here.",
      },
    },
    /** Card furniture — never the post text itself. */
    card: {
      queued: "Queued — waiting for worker…",
      working: "Working…",
      empty: "No posts generated.",
      /** The repo tab drafts tweets specifically, so it says so. */
      emptyTweets: "No tweets generated.",
      ready: "ready",
      skipped: "skipped",
      publishedTo: "published to",
      postedOn: (platform: string) => `Posted on ${platform}`,
    },
    /** Relative age of a run. */
    time: {
      seconds: (n: number) => `${n}s ago`,
      minutes: (n: number) => `${n}m ago`,
      hours: (n: number) => `${n}h ago`,
      days: (n: number) => `${n}d ago`,
    },
    run: {
      inProgress: (n: number) =>
        `${n} generation${n > 1 ? "s" : ""} in progress — refreshing every 3s`,
      heading: "Suggest community posts",
      sources: (list: string, project: string) =>
        `Pulls ${list} and drafts posts about the ${project} community.`,
      sourceNames: {
        topPosts: "top posts",
        topCreators: "top creators",
        briefing: "marketing briefing",
      },
      noSources: "No sources enabled — open Settings to turn some on.",
      themeLabel: "Theme or focus (optional)",
      themePlaceholder: "e.g. mini ramp jam, welcome new skaters, recap the week",
      submit: "Suggest posts",
      submitting: "Queuing…",
      queuedRun: (id: string) => `Queued run ${id}.`,
      error: (message: string) => `Error: ${message}`,
      needsSource: "Enable at least one source in Settings first",
      /** Wraps the `npm run worker:…` command, which stays verbatim. */
      offlineBefore: "Worker is not running. Queued jobs will sit until you start it with",
    },
    health: {
      worker: "Worker",
      db: "DB",
      /** Closed union from the health action, safe to index. */
      dbState: { connected: "connected", unreachable: "unreachable" },
      queue: "Queue",
      pending: (n: number) => `${n} pending`,
      lastRun: "Last run",
      noRuns: "No runs yet",
      posts: (n: number) => `${n} posts`,
      offline: "Backend offline.",
    },
    settings: {
      title: "Settings",
      sourcesChip: (summary: string) => `sources: ${summary}`,
      sourcesNone: "none",
      sourcesShort: { topPosts: "posts", topCreators: "creators", briefing: "briefing" },
      sourcesLabel: "Sources to feed the agent",
      topPosts: {
        title: "Top Hive posts",
        desc: "Trending posts from the community Hive feed this past week.",
      },
      topCreators: {
        title: "Top creators",
        desc: "Leaderboard derived from the week's top posts (by votes + payout).",
      },
      briefing: {
        title: "Marketing briefing",
        desc: "Preamble of today's marketing briefing, if available.",
      },
      placeholderLabel: "Theme placeholder",
      placeholderInput: "e.g. tag a creator, recap the week, welcome newcomers",
      placeholderHint: "Shown as the placeholder in the “Theme or focus” field above.",
      promptLabel: "Generation prompt",
      promptHint:
        "Instructions shaping tone and format. The agent receives this plus the enabled sources and your theme.",
      repoPromptLabel: "Tweet generation prompt",
      save: "Save settings",
      saving: "Saving…",
    },
    repo: {
      heading: "Generate",
      submit: "Generate now",
      needsRepo: "Configure at least one repository URL first",
      readingFrom: "Reading commits from",
      noRepo: "no repo configured — set one in the config below",
      pulls: (label: string) => `Pulls recent commits from ${label} and generates tweet drafts.`,
      none: "no repository configured",
      count: (n: number) => `${n} repos`,
      tweets: (n: number) => `${n} tweets`,
      settingsNone: "no repositories set",
      urlLabel: "Source repository URL (GitHub)",
      urlHint:
        "One repository per line. Commits from each are merged by date before drafting tweets.",
      promptHint: "Instructions shaping tone and format of generated tweets.",
    },
    calendar: {
      hint: "this project's scheduled posts — Instagram, suggestions and repo runs",
      prevMonth: "Previous month",
      nextMonth: "Next month",
      create: "Create a post on this date",
      createOn: (day: string) => `Create a post on ${day}`,
      more: (n: number) => `+${n} more`,
      weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
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
  treasury: {
    title: "Tesouraria",
    titleMulti: "Visão das tesourarias",
    description: "As mesmas carteiras e fontes que o app nativo mostra — saldos ao vivo em várias redes.",
    descriptionMulti: (name: string) =>
      `O Safe da ${name} + todas as tesourarias dos portais que ela opera — as mesmas carteiras e fontes dos apps nativos.`,
    live: "ao vivo",
    liveTitle: "Os saldos são lidos a cada carregamento, com cache de no máximo 5 minutos.",
    hero: {
      treasury: "Tesouro",
      wallets: (n: number) => `em ${n} carteira${n === 1 ? "" : "s"}`,
      noWallets: "sem carteiras configuradas",
      health: "Saúde",
      runway: "Runway",
      runwayTitle: "Quanto tempo o caixa dura se o gasto continuar no ritmo atual.",
      months: "meses",
      verdicts: {
        noCosts: { label: "Sem custos", phrase: "Nada saindo por aqui — o tesouro só acumula." },
        warning: { label: "Atenção", phrase: "Menos de um ano de caixa — vale acompanhar de perto." },
        danger: { label: "Crítico", phrase: "Menos de 3 meses de caixa no ritmo atual." },
        ok: { label: "Saudável", phrase: "O caixa cobre bem mais de um ano no ritmo atual." },
      },
      currentPace: "no ritmo de gasto atual",
      countingCosts: (value: string) => `contando ${value}/mês de custos`,
      countingCostsAll: (value: string) => `contando ${value}/mês de custos de todos os projetos`,
      noCostsFiled: "nenhum custo fixo lançado neste filtro",
    },
    sections: {
      inOut: "Entrada vs saída",
      inOutHint: "O que entrou e o que saiu, mês a mês.",
      revenue: "De onde vem a receita",
      revenueHint: "As fontes on-chain deste projeto — leilões e splits, lidos direto da blockchain.",
      where: "Onde o dinheiro está",
      whereHint: "Cada carteira e ativo que compõe o tesouro.",
      whereHintAll: "Cada carteira e ativo que compõe o tesouro, somando todos os projetos.",
      costs: "Custos fixos",
      costsHint: "O que sai todo mês — é isso que define o runway acima.",
      costsMonthly: (value: string) => `${value}/mês em custos ativos`,
      costsNone: "nenhum custo cadastrado",
    },
    filterHint: "o filtro ajusta todos os números abaixo",
    all: "Tudo",
    tabs: {
      treasury: "Tesouro",
      costs: "Custos",
      members: "Membros",
      support: "Apoiar",
      plan: "Plano financeiro",
    },
    refresh: {
      action: "Atualizar",
      busy: "Atualizando…",
      title: "Atualizar saldos (ignora o cache de 5 min)",
      done: "atualizado agora",
    },
    briefing: { action: "Como estamos", title: "Ler o estado do tesouro em texto" },
    dashboard: {
      in: "Entrada",
      out: "Saída",
      net: "Líquido no período",
      noMovement: "sem movimento no período",
      netPositive: (period: string) => `entrou mais do que saiu nos últimos ${period}`,
      netNegative: (period: string) => `saiu mais do que entrou nos últimos ${period}`,
      months: (n: number) => `${n} ${n === 1 ? "mês" : "meses"}`,
      barIn: (value: string) => `Entrada ${value}`,
      barOut: (value: string) => `Saída ${value}`,
      mixTitle: "De onde vem a receita",
      mixHint: "Jobs = trabalhos da agência. On-chain = fatia dos leilões e swaps das marcas.",
      brands: "Marcas (on-chain)",
      agency: "Agência (jobs)",
    },
    views: {
      combined: "Tesouro combinado",
      fallback: "Tesouro",
      assets: "Ativos",
      wallets: "Carteiras",
      networks: "Redes",
      byProject: "Por projeto",
      byAsset: "Por ativo",
      others: "Outros",
      walletDetail: "Detalhe por carteira",
      assetCount: (n: number) => `${n} ativo${n === 1 ? "" : "s"}`,
      loadFailed: "Não foi possível ler os saldos:",
      noBalances: "Nenhum saldo acima de poeira.",
      aprEstimate: "Estimativa — rendimento do HP via inflação (vesting); curadoria varia.",
      aprSavings: "Taxa de juros do HBD em savings (on-chain).",
      pricesNote: (hive: string, hbd: string) =>
        `HIVE ${hive} · HBD ${hbd} via CoinGecko. HP = vesting shares próprias (incl. delegadas), mesma conta do skatehive.app/dao. Fontes com cache de 5 min.`,
      aprFootnote: "* O APR do HP é estimativa (inflação → vesting); o do HBD savings é a taxa on-chain.",
    },
    revenue: {
      title: "Receita on-chain",
      hintAll: "Fontes de receita rastreadas por projeto — leituras ao vivo das mesmas carteiras/contratos do org-chart.",
      hintOne: "Fontes de receita rastreadas deste projeto — leituras on-chain ao vivo (configuradas no org-chart).",
      realized: "Receita realizada",
      balance: "Saldo atual",
      balanceShort: "saldo",
      auction: "🔨 Receita de leilões",
      split: "💧 Distribuído (split)",
      auctions: "leilões",
      distributions: "distribuições",
      insideNow: "dentro agora",
      partial: "parcial",
      partialTitle: "histórico longo — mostrando parte",
      received: "Recebido",
      paid: "Pago/saiu",
    },
  },
  meetings: {
    title: "Reuniões",
    subtitle: "Calendário semanal · clique num horário para marcar",
    all: "Todos",
    views: { day: "Dia", week: "Semana", month: "Mês" },
    today: "Hoje",
    prev: "Anterior",
    next: "Próximo",
    newMeeting: "Nova reunião",
    slotHint: "Marcar",
    moreEvents: (n: number) => `+${n} mais`,
    moreDeadlines: (n: number) => `+${n} deadlines`,
    owners: (n: number) => `${n} dono${n === 1 ? "" : "s"}`,
    deadlineTitle: "Deadline",
    dismiss: "Fechar",
    availability: {
      action: "Disponibilidade",
      title: "Disponibilidade da equipe",
      show: "mostrar",
      checking: "verificando…",
      connected: "conectado",
      notShared: "não compartilhou",
      error: "erro",
      none: "Nenhum membro com email. Cadastre o email da galera na aba Team que eles aparecem aqui.",
      extras: "Extras",
      sharePrefix: "Pra um membro aparecer como",
      shareSuffix: "ele compartilha “Ver disponibilidade” do Google Calendar dele com:",
      createdIn: "As reuniões são criadas no calendário:",
      addExtra: "+ Calendário extra (fora da equipe / iCal)",
      namePlaceholder: "Nome (pessoa)",
      icsPlaceholder: "email@gmail.com ou https://…/basic.ics",
      addAction: "Adicionar calendário",
      busy: (name: string) => `${name} · ocupado`,
    },
    editor: {
      createTitle: "Nova reunião",
      editTitle: "Editar reunião",
      close: "Fechar",
      titlePlaceholder: "Título da reunião",
      project: "Projeto",
      kind: "Tipo",
      kinds: { plan: "[PLAN] Planejamento", exec: "[EXEC] Execução" },
      start: "Início",
      date: "Data",
      time: "Horário",
      duration: "Duração",
      durations: { m15: "15 min", m30: "30 min", m60: "1 hora", m90: "1h30", m120: "2 horas" },
      customDuration: (n: number) => `${n} min`,
      weekly: "Repetir toda semana",
      color: (hex: string) => `Cor ${hex}`,
      attendees: "Convidados",
      ownerHint: " — clique no ★ pra marcar o dono",
      noMembers: "Esse projeto não tem membros com email — cadastre na aba Team, ou digite abaixo.",
      emailPlaceholder: "email@exemplo.com",
      add: "Add",
      owner: "Dono (responsável)",
      makeOwner: "Marcar como dono",
      agenda: "Pauta",
      agendaPlaceholder: "Pauta / o que será discutido",
      inviteEmail: "Email do convite",
      inviteCustom: "(personalizado)",
      inviteDefault: "(padrão)",
      inviteEmailPlaceholder: "Vazio = email padrão. Use o Improve with AI pra gerar.",
      openInGoogle: "Ver no Google Calendar",
      save: "Salvar",
      delete: "Deletar reunião",
      needTitle: "Dê um título à reunião.",
      created: "Reunião criada",
      invitesSent: (n: number) => `${n} convite${n === 1 ? "" : "s"} enviado${n === 1 ? "" : "s"}`,
      invitesFailed: (err: string) => `convites falharam (${err})`,
      inviteError: (err: string) => `convites: ${err}`,
      googleError: (err: string) => `Google: ${err}`,
    },
  },
  engagement: {
    title: "Engagement",
    description: "Curadoria entre as nossas redes — toda resposta passa por aprovação humana antes de sair.",
    tabs: { trail: "Trail", snaps: "Snaps", blog: "Blog", instagram: "Instagram" },
    info: {
      trail: "Trail de curadoria entre nossas contas: like (Farcaster) / upvote (Hive) automático nos posts parceiros + resposta gerada para você aprovar e postar.",
      snaps: "Snaps recentes da comunidade SkateHive. Comente como a conta do portal ou dê um boost — upvotes da userbase liberados aos poucos, no ritmo do engajamento real.",
      blog: "Blog posts (magazine) recentes da comunidade Hive do projeto. Comente como a conta do portal ou impulsione os melhores com hiveboost.",
      instagram: "Comentários nos nossos posts do Instagram. Responda direto daqui — o comentário sai da fila quando você responde e só volta se a pessoa responder de novo.",
    },
    instagram: {
      caption: "comentários dos seus posts · responda direto daqui",
      generateAll: (n: number) => `Gerar todas (${n})`,
      refresh: "Atualizar",
      loading: "Carregando comentários do Instagram…",
      loadFailed: "Não consegui carregar os comentários.",
      scopeHint: "Reemita o token do Instagram com o escopo",
      scopeHintTail: "e atualize",
      retry: "Tentar de novo",
      allDone: (n: number) => `Tudo respondido nos últimos ${n} posts — nenhum comentário aguardando. 🎉`,
      loadMore: (n: number) => `Carregar mais posts (escaneando ${n})`,
      noCaption: "(sem legenda)",
      openInInstagram: "Abrir no Instagram",
      hide: "Ocultar comentário",
      unhide: "Reexibir comentário",
      hidden: "oculto",
      likes: (n: number) => `${n} likes`,
      replyPlaceholder: "Responder…",
      reply: "Responder",
      generate: "Gerar resposta com IA",
      user: "usuário",
      you: "você",
      answered: "Respondido",
      answeredLog: (n: number) => `Respondidos nesta sessão (${n})`,
      now: "agora",
      minutes: (n: number) => `${n}min`,
      hours: (n: number) => `${n}h`,
      days: (n: number) => `${n}d`,
    },
  },
  home: {
    greeting: {
      morning: (name: string) => `Bom dia, ${name}`,
      afternoon: (name: string) => `Boa tarde, ${name}`,
      evening: (name: string) => `Boa noite, ${name}`,
      anonymous: "Hoje",
    },
    tabs: { brief: "Briefing do dia", socials: "Redes" },
    briefings: {
      fresh: "briefings atualizados",
      stale: (n: number) => `${n} briefing${n > 1 ? "s" : ""} desatualizado${n > 1 ? "s" : ""}`,
      none: "nenhum briefing ainda",
    },
    tasks: {
      title: "Minhas tarefas",
      count: (n: number) => `${n} no Kanban`,
      overdue: (n: number) => `${n} atrasada${n > 1 ? "s" : ""}`,
      dueToday: (n: number) => `${n} vence${n > 1 ? "m" : ""} hoje`,
      allClear: "nada atrasado",
      expand: "Mostrar tarefas",
      collapse: "Ocultar tarefas",
      open: "Abrir card no Kanban",
    },
  },
  postSuggestions: {
    title: "Sugestões de Post",
    description: (project: string) =>
      `Rascunhos prontos para publicar da ${project}. Uma rodada, várias plataformas.`,
    status: {
      ok: "workers rodando",
      stale: "worker travado",
      down: "worker parado",
      detail: (community: string, repo: string) =>
        `comunidade: ${community} · repo: ${repo}`,
    },
    tabs: {
      label: "Fontes de rascunho",
      community: "Comunidade",
      repo: "Repo para Social",
      crosspost: "Cross-post",
      calendar: "Calendário",
    },
    worker: {
      active: "ativo",
      idle: "rodando (ocioso)",
      stale: "travado",
      offline: "parado",
      unknown: "desconhecido",
    },
    board: {
      generating: "Gerando",
      drafted: "Rascunhos",
      approved: "Aprovados",
      published: "Publicados",
      emptyCommunity: {
        generating: "Clique em “Sugerir posts” para enfileirar uma rodada.",
        drafted: "Os rascunhos aparecem aqui depois de gerados.",
        approved: "Aprove um rascunho para ele vir para cá.",
        published: "As sugestões publicadas aparecem aqui.",
      },
      emptyRepo: {
        generating: "Clique em “Gerar agora” para enfileirar uma rodada.",
        drafted: "Os rascunhos aparecem aqui depois de gerados.",
        approved: "Aprove um rascunho para ele vir para cá.",
        published: "Os tweets publicados aparecem aqui.",
      },
    },
    card: {
      queued: "Na fila — esperando o worker…",
      working: "Trabalhando…",
      empty: "Nenhum post gerado.",
      emptyTweets: "Nenhum tweet gerado.",
      ready: "pronto",
      skipped: "pulado",
      publishedTo: "publicado em",
      postedOn: (platform: string) => `Publicado no ${platform}`,
    },
    time: {
      seconds: (n: number) => `há ${n}s`,
      minutes: (n: number) => `há ${n}min`,
      hours: (n: number) => `há ${n}h`,
      days: (n: number) => `há ${n}d`,
    },
    run: {
      inProgress: (n: number) =>
        `${n} geraç${n > 1 ? "ões" : "ão"} em andamento — atualizando a cada 3s`,
      heading: "Sugerir posts da comunidade",
      sources: (list: string, project: string) =>
        `Puxa ${list} e escreve posts sobre a comunidade ${project}.`,
      sourceNames: {
        topPosts: "melhores posts",
        topCreators: "top criadores",
        briefing: "briefing de marketing",
      },
      noSources: "Nenhuma fonte ativa — abra os Ajustes para ligar alguma.",
      themeLabel: "Tema ou foco (opcional)",
      themePlaceholder: "ex.: jam na mini ramp, boas-vindas aos novatos, resumo da semana",
      submit: "Sugerir posts",
      submitting: "Enfileirando…",
      queuedRun: (id: string) => `Rodada ${id} enfileirada.`,
      error: (message: string) => `Erro: ${message}`,
      needsSource: "Ligue ao menos uma fonte nos Ajustes antes",
      offlineBefore:
        "O worker não está rodando. Os jobs ficam parados na fila até você iniciar com",
    },
    health: {
      worker: "Worker",
      db: "Banco",
      dbState: { connected: "conectado", unreachable: "inacessível" },
      queue: "Fila",
      pending: (n: number) => `${n} na fila`,
      lastRun: "Última rodada",
      noRuns: "Nenhuma rodada ainda",
      posts: (n: number) => `${n} posts`,
      offline: "Backend fora do ar.",
    },
    settings: {
      title: "Ajustes",
      sourcesChip: (summary: string) => `fontes: ${summary}`,
      sourcesNone: "nenhuma",
      sourcesShort: { topPosts: "posts", topCreators: "criadores", briefing: "briefing" },
      sourcesLabel: "Fontes que alimentam o agente",
      topPosts: {
        title: "Melhores posts do Hive",
        desc: "Posts em alta no feed Hive da comunidade nesta última semana.",
      },
      topCreators: {
        title: "Top criadores",
        desc: "Ranking tirado dos melhores posts da semana (por votos + payout).",
      },
      briefing: {
        title: "Briefing de marketing",
        desc: "Preâmbulo do briefing de marketing de hoje, se houver.",
      },
      placeholderLabel: "Placeholder do tema",
      placeholderInput: "ex.: marque um criador, resuma a semana, dê boas-vindas",
      placeholderHint: "Aparece como placeholder no campo “Tema ou foco” acima.",
      promptLabel: "Prompt de geração",
      promptHint:
        "Instruções que moldam tom e formato. O agente recebe isto junto das fontes ligadas e do seu tema.",
      repoPromptLabel: "Prompt de geração dos tweets",
      save: "Salvar ajustes",
      saving: "Salvando…",
    },
    repo: {
      heading: "Gerar",
      submit: "Gerar agora",
      needsRepo: "Configure ao menos uma URL de repositório antes",
      readingFrom: "Lendo commits de",
      noRepo: "nenhum repo configurado — defina um nos ajustes abaixo",
      pulls: (label: string) =>
        `Puxa os commits recentes de ${label} e gera rascunhos de tweet.`,
      none: "nenhum repositório configurado",
      count: (n: number) => `${n} repos`,
      tweets: (n: number) => `${n} tweets`,
      settingsNone: "nenhum repositório definido",
      urlLabel: "URL do repositório de origem (GitHub)",
      urlHint:
        "Um repositório por linha. Os commits de cada um são mesclados por data antes de virar tweet.",
      promptHint: "Instruções que moldam o tom e o formato dos tweets gerados.",
    },
    calendar: {
      hint: "posts agendados deste projeto — Instagram, sugestões e rodadas do repo",
      prevMonth: "Mês anterior",
      nextMonth: "Próximo mês",
      create: "Criar post nesta data",
      createOn: (day: string) => `Criar post em ${day}`,
      more: (n: number) => `+${n}`,
      weekdays: ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"],
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
