export type ProjectTheme = {
  /** Accent color for light mode (e.g. "#5b9c00") */
  accentLight: string;
  /** Accent color for dark mode (e.g. "#a3e635") */
  accentDark: string;
  /** Accent-bg rgba for light mode */
  accentBgLight: string;
  /** Accent-bg rgba for dark mode */
  accentBgDark: string;
  /** Accent-border rgba for light mode */
  accentBorderLight: string;
  /** Accent-border rgba for dark mode */
  accentBorderDark: string;
  /** Path under /public, e.g. "/projects/skatehive/logo.svg" */
  logo: string;
  /** Optional favicon path under /public */
  favicon?: string;
};

/** One social channel a project operates, plus its posting strategy. Rendered
 *  as a subtab on the home "Socials" dashboard. */
export type SocialChannel = {
  /** Display name, e.g. "Instagram", "X", "Hive", "Farcaster" */
  platform: string;
  /** @handle for the account, if any */
  handle?: string;
  /**
   * Override the account identifier used for metrics fetching.
   * When omitted, the metrics fetcher strips the leading '@' from `handle`.
   */
  metricsAccount?: string;
  /** Public profile URL */
  url?: string;
  /** Short context line, e.g. "~7.6K followers" or "snaps in hive-173115" */
  note?: string;
  /** What this channel is for / its positioning (one or two sentences) */
  summary: string;
  /** Posting frequency, e.g. "Weekly per format" */
  cadence?: string;
  /** Voice/tone guidance */
  voice?: string;
  /** Content formats or pillars used on this channel */
  formats?: { name: string; description: string }[];
  /** Things this channel should always do */
  dos?: string[];
  /** Things this channel should never do */
  donts?: string[];
};

export type TeamContact = {
  label: string;
  value: string;
  url?: string;
  /** opt-in explícito pra aparecer no site público. Ausente = privado. */
  public?: boolean;
};

export type ProjectConfig = {
  /** Subdomain key, e.g. "skatehive" */
  slug: string;
  /**
   * Host label used in the URL when it DIFFERS from the slug, e.g. Reelflip's
   * portal lives at `admin.reelflip.com` → subdomain "admin" but slug "reelflip".
   * The resolver accepts BOTH the slug and this subdomain (so old + new URLs
   * work). The switcher uses this as the host label. Defaults to `slug`.
   */
  subdomain?: string;
  /**
   * Parent company / "umbrella" this brand sits under, e.g. all current portals
   * are under "reelflip" (a future set under "blockwire"). Brands in the same
   * umbrella SHARE one Instagram-leads pool (each lead records which brands it
   * came from). Defaults to "reelflip" via {@link projectUmbrella}.
   */
  umbrella?: string;
  /** Display name, e.g. "SkateHive" */
  name: string;
  /** Used for <meta description> */
  description: string;
  /** Lowercase Hive usernames allowed to access this portal */
  allowlist: string[];
  /** Optional known public/team contacts keyed by lowercase Hive username. */
  teamContacts?: Record<string, TeamContact[]>;
  /** CSS-var overrides for accent family + asset paths */
  theme: ProjectTheme;
  hive: {
    /** Hive account that posts content (maps to HIVE_POSTING_ACCOUNT env) */
    account: string;
    /** Community tag, e.g. "hive-173115" */
    community: string;
    /** When true, the home Hive status reflects COMMUNITY stats (subscribers,
     *  authors, pending posts/rewards from bridge.get_community) instead of the
     *  posting account's @profile followers. */
    communityStats?: boolean;
    /** Hive web frontend base URL for this project, e.g. "https://skatehive.app".
     *  When absent, universal frontends (peakd.com) are used instead. */
    frontend?: string;
    /** Beneficiaries applied to published Hive mag posts (weights in basis
     *  points; 10000 = 100%). When absent, only the portal operator's default
     *  share applies. Entries matching the posting account are dropped. */
    magBeneficiaries?: { account: string; weight: number }[];
  };
  farcaster: {
    /** Farcaster channel ID, e.g. "skateboard" */
    channel: string;
    /** Optional: env key suffix for the signer UUID (reads ${prefix}_NEYNAR_SIGNER_UUID) */
    signerEnvKey?: string;
  };
  // ---------------------------------------------------------------------------
  // Non-secret integration IDs. These are public identifiers (not credentials),
  // so they live in code as the default; the matching `${PREFIX}_<KEY>` env var
  // still overrides when set. The SECRET half of each integration (bot token,
  // access token, secret key) stays in env only.
  // ---------------------------------------------------------------------------
  /** Discord channel the briefing/crosspost bot targets (secret: DISCORD_BOT_TOKEN). */
  discord?: { channelId?: string };
  /** Instagram Graph API business-account id (secret: INSTAGRAM_ACCESS_TOKEN). */
  instagram?: { businessAccountId?: string };
  /** Google Drive folder id for the brand's asset context (secret: GOOGLE_SERVICE_ACCOUNT_JSON). */
  googleDrive?: { folderId?: string };
  /** thirdweb public client id (secret: THIRDWEB_SECRET_KEY). */
  thirdweb?: { clientId?: string };
  /** Facebook page id + crosspost opt-in (secret: reuses INSTAGRAM_ACCESS_TOKEN / Meta token). */
  facebook?: { pageId?: string; crosspost?: boolean };
  /** Default GitHub repos for Repo-to-Social, formatted as "owner/name" */
  repos: string[];
  /**
   * Social channels this project operates, with the posting strategy for each.
   * Rendered as subtabs on the home "Socials" dashboard. Each project shows
   * only its own channels (Reelflip = Instagram only).
   */
  socials: SocialChannel[];
  /**
   * Optional weekly-recap spec. When set, the campaign "Weekly Recap" template
   * is generated by THIS project's agent from its own live sources/tools/memory
   * (not a fixed Hive-posts injection), covering `sections` in the agent's own
   * voice. When absent, the project falls back to the SkateHive Hive-posts flow.
   */
  weeklyRecap?: {
    /** The signals/sections the agent should compile, in its own words. */
    sections: string[];
    /** Hint about which of the agent's own tools/sources to pull from. */
    sourcesHint?: string;
  };
  /**
   * Route paths to hide from the sidebar AND block (404) for this project,
   * e.g. ["/userbase", "/repo-to-social"]. Omitted/empty = all routes enabled.
   */
  hiddenRoutes?: string[];
  /**
   * Workspace-switcher presentation. `rank` orders entries (lower = higher);
   * `parent` indents this project under another slug (e.g. Gnars under
   * Reelflip, which operates it); `dividerBefore` draws a horizontal rule
   * above the entry (a separate org); `hidden` keeps a paused project out of
   * the switcher while its URL keeps working.
   */
  switcher?: { rank?: number; parent?: string; dividerBefore?: boolean; hidden?: boolean };
  /**
   * When true, the Post Creator nav item and /post-creator route are enabled
   * for this project. Publishing uses the project's own Instagram credentials
   * (`${gatewayEnvPrefix}_INSTAGRAM_*` env vars).
   */
  postCreator?: boolean;
  /**
   * When true, the About nav item and /about route are enabled — a deck-style
   * presentation page describing the org/model. Currently SOPA-only (the deck
   * content is keyed by slug in the /about page). Absent = nav hidden + 404.
   */
  about?: boolean;
  /**
   * When true, the Lab nav item + /lab route are enabled — an experimental
   * unified post/campaign composer (compose once → live multi-network preview
   * → schedule). Doesn't touch the production Post Creator / Campaign Creator.
   */
  lab?: boolean;
  /**
   * When true, the Zine Studio nav item + /zine route are enabled — a page-based
   * editor for printable zines (Reelflip-family brands). Imports from Drive +
   * SkateHive, exports a print-ready PDF.
   */
  zineStudio?: boolean;
  /**
   * When true, the TikTok nav item + /tiktok route are enabled — a review queue
   * for TikTok videos (draft → approve → schedule → publish). Unlike Instagram,
   * the credentials are NOT env-only: the brand connects its account through
   * OAuth and the tokens live in TikTokAccount, because TikTok's access token
   * lasts 24h and its refresh token rotates. Absent = nav hidden + 404.
   */
  tiktok?: boolean;
  /**
   * When true, the Org Chart nav item + /org-chart route are enabled — an
   * editable flowchart (SOPA-only). Absent = nav hidden + 404.
   */
  orgChart?: boolean;
  /**
   * When true, the Portfolio nav item + /portfolio route are enabled — an
   * editable card portfolio (SOPA-only). Absent = nav hidden + 404.
   */
  portfolio?: boolean;
  /**
   * When true, the Briefs nav item + /briefs route are enabled — the triage
   * queue for briefs sent through the public SOPA site's contact form
   * (SOPA-only). Absent = nav hidden + 404.
   */
  briefs?: boolean;
  /**
   * When true, the Chat nav item + /chat route are enabled — the full-page
   * conversation with this project's agent (streaming, attachments, history
   * kept on the server, one thread per conversation).
   *
   * É outra coisa do chat flutuante, que continua existindo: aquele é para
   * perguntar sobre a tela em que a pessoa está, guarda histórico no
   * localStorage e vive por cima do conteúdo. Este é o lugar de sentar e
   * trabalhar — e a conversa dele sobrevive a trocar de máquina.
   */
  chat?: boolean;
  /**
   * When true, the Reuniões nav item + /reunioes route are enabled — a weekly
   * meetings calendar (SOPA-only). Absent = nav hidden + 404.
   */
  meetings?: boolean;
  /**
   * When true, the Magazine nav item + /magazine route are enabled — an editorial
   * curator that picks + orders Hive posts into the online magazine, served at
   * /api/magazine/current for the public site's flipbook. Absent = nav hidden + 404.
   */
  magazine?: boolean;

  /**
   * When true, the Homepage nav item + /homepage route are enabled — an admin
   * composer that curates the media-magazine homepage (hero slides, featured
   * posts, spot, bounties) into a versioned HomepageConfig, served at
   * /api/homepage/current for skatehive3.0's /home route. Absent = nav hidden + 404.
   */
  homepage?: boolean;

  /**
   * When true, the Cross-post tab on /marketing-suggestions is enabled — the
   * curation queue for posts community members ask to have re-published on the
   * brand's Instagram / their own Farcaster. The queue itself lives in the main
   * app's Supabase (`userbase_crosspost_queue`), so this only makes sense for
   * projects whose app writes to it. Absent = tab hidden.
   */
  crossPostQueue?: boolean;
  /**
   * Treasury wallets shown on /treasury — the SAME wallets/sources the
   * project's native app shows (skatehive.app/dao, gnars.com/treasury).
   * Omitted = nav item hidden and route 404s.
   */
  treasury?: {
    /** EVM wallets — ETH + USDC + configured ERC-4626 vaults read live per chain. */
    ethWallets: {
      label: string;
      address: string;
      /** Extra known ERC-20s to ALSO read for this wallet (config-driven, not an
       *  indexer — so no spam/scam tokens leak in). `usd: "one"` prices 1:1 (Super
       *  USDC); `usd: "none"` = balance known but no trustworthy price (rule 5:
       *  show the quantity, USD unavailable). SOPA-only today. */
      extraTokens?: {
        chain: string;
        address: string;
        symbol: string;
        decimals: number;
        usd: "one" | "none";
        note?: string;
      }[];
    }[];
    /** Hive accounts — balances from condenser_api, valued via CoinGecko. */
    hiveAccounts?: { label: string; account: string }[];
    /**
     * Slugs of OTHER projects whose treasuries are also shown on this portal's
     * /treasury (admin overview) — e.g. Reelflip, as the operator of all
     * portals, shows its own Safe plus Gnars and SkateHive, with per-project
     * views and a combined total.
     */
    includeProjects?: string[];
  };
  /**
   * Overrides for campaign-artifact generation (brief + cross-platform drafts).
   * When absent, the default "growth lead at a community-owned Hive platform"
   * framing is used (SkateHive/Gnars). Set this for brands where that's wrong
   * (e.g. Reelflip — an Instagram-first editorial brand).
   */
  campaignArtifacts?: {
    /** Replaces "the growth lead at {name} — a community-owned platform built on Hive". */
    persona?: string;
    /** Extra voice/tone guidance injected into the artifact prompts. */
    voiceHint?: string;
  };
  /**
   * Google Analytics 4 and Search Console configuration.
   * When absent, the Analytics nav item is hidden and /analytics returns 404.
   */
  analytics?: {
    /** GA4 property ID, e.g. "527345741" */
    ga4PropertyId?: string;
    /** GSC site URL, e.g. "sc-domain:skatehive.app" */
    gscSiteUrl?: string;
    /**
     * ISO 3166-1 alpha-2 country codes to EXCLUDE from GA4 reports (treated as
     * bot traffic), e.g. ["SG"]. Applied as a countryId dimensionFilter to
     * every GA4 report.
     */
    excludeCountries?: string[];
    /**
     * Hostnames to EXCLUDE from GA4 reports — tráfego de desenvolvimento, não
     * de gente. Mesma forma do excludeCountries, com uma diferença que a
     * realidade impôs: uma entrada que **começa com ponto** casa por SUFIXO.
     *
     * Sem isso o campo não serviria: preview de Vercel gera um hostname NOVO por
     * deploy (`skatehive3-0-git-fork-bielcx-…vercel.app`), e uma lista exata
     * viraria caça a nomes que nunca acaba. `".vercel.app"` pega todos.
     *
     * Localhost e IP privado NÃO precisam entrar aqui: já saem por padrão em
     * todo portal (DEV_HOSTNAME_EXCLUSIONS em src/lib/google-analytics.ts).
     * Aqui vai só o que é dev PARA ESTA MARCA — e por isso mora no config dela,
     * onde dá pra ver. Um portal cujo site de verdade FOSSE um *.vercel.app
     * seria zerado por um default assim; por isso não é default.
     */
    excludeHostnames?: string[];
    /**
     * Queries containing these terms (case-insensitive substring) are "branded".
     * Used in the GSC branded vs non-branded split. Defaults to [project.name.toLowerCase()].
     */
    brandedTerms?: string[];
  };
  /**
   * Agents whose morning briefings render on this project's home page (one tab
   * each). Each maps to an OpenClaw agent slug + its workspace dir.
   */
  briefingAgents: {
    slug: string;
    label: string;
    /** Short label for the tab strip; defaults to `label`. */
    tabLabel?: string;
    workspace: string;
    /**
     * Tailors the briefing input to the agent's objective (cheaper + sharper):
     * - "dev": gets the portal-fetched code-commit delta ([commits]); skips the
     *   marketing social analysis.
     * - "marketing": gets the social analysis; skips [commits].
     * Unset = general agent (social analysis, no commits).
     */
    role?: "dev" | "marketing";
  }[];
  agent: {
    /**
     * Uppercase prefix for namespaced env vars.
     * e.g. "SKATEHIVE" reads SKATEHIVE_GATEWAY_URL, SKATEHIVE_GATEWAY_TOKEN, etc.
     */
    gatewayEnvPrefix: string;
    /** OpenClaw agentId, e.g. "skatehive-marketing" */
    id: string;
    /** Display name shown in the chat header, e.g. "SkateHive Marketing" */
    displayName: string;
    /** Optional emoji prefix for the agent */
    emoji?: string;
    /** First assistant message shown in the chat before any user interaction */
    greeting?: string;
  };
  prompts?: {
    /** Directory (relative to project root) where prompt overrides live */
    dir: string;
  };
  /**
   * Email addresses of the project's core team. Used for the Morning Brief
   * "Email to team" action — sends the briefing by BCC to all addresses.
   * Omitting this (or leaving it empty) will disable the send action.
   */
  /**
   * GitHub Projects V2 configuration. When set, the Kanban nav item is shown
   * and /kanban renders the board for this project. Gated like `analytics` —
   * absent = nav hidden + /kanban returns 404.
   */
  githubProject?: {
    /** GitHub owner login that owns the project, e.g. "SkateHive" or "sktbrd" */
    org: string;
    /** GitHub Project number (Projects V2), e.g. 1 */
    number: number;
  };
  /** Aggregate ALL portals' Kanban boards into one read-only view (the SOPA hub). */
  kanbanAggregate?: boolean;
};
