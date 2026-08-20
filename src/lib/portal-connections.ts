import "server-only";
import type { ProjectConfig } from "@/projects/types";
import { hasBrandEnv } from "@/lib/brand-env";

export type ConnectionStatus = "connected" | "warning" | "manual" | "missing" | "na";

export type PortalConnection = {
  network: string;
  handle?: string;
  status: ConnectionStatus;
  detail: string;
  fixHint?: string;
};

export function getPortalConnections(project: ProjectConfig): PortalConnection[] {
  const prefix = project.agent.gatewayEnvPrefix;

  /** Has the value via namespaced key OR bare global key (trimmed, non-empty). */
  function has(key: string): boolean {
    return !!(process.env[`${prefix}_${key}`] ?? process.env[key])?.trim();
  }

  /** Has the value ONLY via the namespaced key (not global fallback). */
  function hasOwn(key: string): boolean {
    return !!process.env[`${prefix}_${key}`]?.trim();
  }

  const connections: PortalConnection[] = [];

  // ── Hive (posting) ────────────────────────────────────────────────────────
  {
    const postingAccount =
      process.env[`${prefix}_HIVE_POSTING_ACCOUNT`]?.trim() ?? project.hive.account;
    const handle = `@${postingAccount}`;

    if (hasOwn("HIVE_POSTING_KEY")) {
      connections.push({
        network: "Hive",
        handle,
        status: "connected",
        detail: `Posting as ${handle} using the project-specific key.`,
      });
    } else if (process.env["HIVE_POSTING_KEY"]?.trim() && prefix === "SKATEHIVE") {
      connections.push({
        network: "Hive",
        handle,
        status: "connected",
        detail: `Posting as ${handle} (global key is the SkateHive key — this is correct).`,
      });
    } else {
      connections.push({
        network: "Hive",
        handle,
        status: "missing",
        detail: "No posting key for THIS brand — cross-brand fallback is disabled, so publishing is off until its own key is set.",
        fixHint: `Set ${prefix}_HIVE_POSTING_KEY (and ${prefix}_HIVE_POSTING_ACCOUNT if different from the project default)`,
      });
    }
  }

  // ── Farcaster ─────────────────────────────────────────────────────────────
  {
    const hasFarcasterSocial = project.socials.some(
      (s) => s.platform.toLowerCase() === "farcaster",
    );

    if (!hasFarcasterSocial) {
      connections.push({
        network: "Farcaster",
        status: "na",
        detail: "Farcaster is not configured for this project.",
      });
    } else {
      const apiKeyPresent = has("NEYNAR_API_KEY");
      const farcasterHandle =
        project.socials.find((s) => s.platform.toLowerCase() === "farcaster")?.handle ??
        `@${project.hive.account}`;

      if (!apiKeyPresent) {
        connections.push({
          network: "Farcaster",
          handle: farcasterHandle,
          status: "missing",
          detail: "No Neynar API key found.",
          fixHint: `Set ${prefix}_NEYNAR_API_KEY or NEYNAR_API_KEY`,
        });
      } else {
        // Determine signer key name to check
        const signerEnvKey = project.farcaster.signerEnvKey;
        const hasOwnSigner = signerEnvKey
          ? !!process.env[signerEnvKey]?.trim()
          : hasOwn("NEYNAR_SIGNER_UUID");

        if (hasOwnSigner) {
          connections.push({
            network: "Farcaster",
            handle: farcasterHandle,
            status: "connected",
            detail: `Casting as ${farcasterHandle} using a project-specific Neynar signer.`,
          });
        } else if (process.env["NEYNAR_SIGNER_UUID"]?.trim() && prefix === "SKATEHIVE") {
          connections.push({
            network: "Farcaster",
            handle: farcasterHandle,
            status: "connected",
            detail: `Casting as ${farcasterHandle} (global signer is the SkateHive signer — this is correct).`,
          });
        } else {
          connections.push({
            network: "Farcaster",
            handle: farcasterHandle,
            status: "missing",
            detail: "Neynar API key is present but this brand has no signer — cross-brand fallback is disabled.",
            fixHint: `Set ${prefix}_NEYNAR_SIGNER_UUID`,
          });
        }
      }
    }
  }

  // ── Instagram ─────────────────────────────────────────────────────────────
  {
    const igSocial = project.socials.find(
      (s) => s.platform.toLowerCase() === "instagram",
    );

    if (!igSocial && !hasBrandEnv(project, "INSTAGRAM_ACCESS_TOKEN") && !hasBrandEnv(project, "INSTAGRAM_BUSINESS_ACCOUNT_ID")) {
      connections.push({
        network: "Instagram",
        status: "na",
        detail: "Instagram is not configured for this project.",
      });
    } else {
      const tokenPresent = hasBrandEnv(project, "INSTAGRAM_ACCESS_TOKEN");
      const accountPresent = hasBrandEnv(project, "INSTAGRAM_BUSINESS_ACCOUNT_ID") || !!project.instagram?.businessAccountId;
      const igHandle = igSocial?.handle;

      if (tokenPresent && accountPresent) {
        connections.push({
          network: "Instagram",
          handle: igHandle,
          status: "connected",
          detail: "Access token and business account ID are both set.",
        });
      } else {
        connections.push({
          network: "Instagram",
          handle: igHandle,
          status: "missing",
          detail: `Missing: ${[!tokenPresent && "access token", !accountPresent && "business account ID"].filter(Boolean).join(" and ")}.`,
          fixHint: `Set ${prefix}_INSTAGRAM_ACCESS_TOKEN + ${prefix}_INSTAGRAM_BUSINESS_ACCOUNT_ID`,
        });
      }
    }
  }

  // ── Facebook (Page) — reads ride the same Meta token as Instagram ────────
  {
    const fbSocial = project.socials.find((s) => s.platform.toLowerCase() === "facebook");
    if (hasBrandEnv(project, "INSTAGRAM_ACCESS_TOKEN")) {
      connections.push({
        network: "Facebook",
        handle: fbSocial?.handle,
        status: "connected",
        detail: "Page auto-discovered via the Meta token — metrics on the home dashboard.",
      });
    } else if (fbSocial) {
      connections.push({
        network: "Facebook",
        handle: fbSocial.handle,
        status: "missing",
        detail: "Facebook channel configured but no Meta token found.",
        fixHint: `Set ${prefix}_INSTAGRAM_ACCESS_TOKEN (one token covers IG + FB)`,
      });
    } else {
      connections.push({
        network: "Facebook",
        status: "na",
        detail: "No Facebook page configured for this project.",
      });
    }
  }

  // ── TikTok ────────────────────────────────────────────────────────────────
  // Env only carries the app credentials; the account itself is an OAuth row in
  // TikTokAccount (24h access token, rotating refresh token), so a live check
  // needs the DB — verifyTikTokConnection upgrades this row on the Settings page.
  {
    if (!project.tiktok) {
      connections.push({
        network: "TikTok",
        status: "na",
        detail: "TikTok is not enabled for this project.",
      });
    } else if (!hasOwn("TIKTOK_CLIENT_KEY") || !hasOwn("TIKTOK_CLIENT_SECRET")) {
      connections.push({
        network: "TikTok",
        status: "missing",
        detail: "No TikTok app credentials for this brand.",
        fixHint: `Set ${prefix}_TIKTOK_CLIENT_KEY + ${prefix}_TIKTOK_CLIENT_SECRET`,
      });
    } else {
      connections.push({
        network: "TikTok",
        status: "warning",
        detail: "App credentials set — checking the connected account…",
      });
    }
  }

  // ── X / Twitter ───────────────────────────────────────────────────────────
  {
    const xSocial = project.socials.find(
      (s) => s.platform.toLowerCase() === "x" || s.platform.toLowerCase() === "twitter",
    );
    if (xSocial) {
      connections.push({
        network: "X / Twitter",
        handle: xSocial.handle,
        status: "manual",
        detail: "Posts via the X composer (intent) — no API auto-post.",
      });
    } else {
      connections.push({
        network: "X / Twitter",
        status: "na",
        detail: "No X / Twitter account configured for this project.",
      });
    }
  }

  // ── Discord ───────────────────────────────────────────────────────────────
  {
    const discordToken = hasBrandEnv(project, "DISCORD_BOT_TOKEN");
    const discordChannel = hasBrandEnv(project, "DISCORD_CHANNEL_ID") || !!project.discord?.channelId;

    if (discordToken && discordChannel) {
      connections.push({
        network: "Discord",
        status: "manual",
        detail: "Bot token configured — verifying…",
      });
    } else {
      connections.push({
        network: "Discord",
        status: "missing",
        detail: "No Discord bot token or channel ID found.",
        fixHint: `Set ${prefix}_DISCORD_BOT_TOKEN + ${prefix}_DISCORD_CHANNEL_ID`,
      });
    }
  }

  // ── Binance Square ────────────────────────────────────────────────────────
  {
    if (hasOwn("BINANCE_SQUARE_KEY")) {
      connections.push({
        network: "Binance Square",
        status: "connected",
        detail: "Project-specific OpenAPI key — posts from Post Suggestions, Repo to Social, and campaigns.",
      });
    } else if (process.env.BINANCE_SQUARE_OPENAPI_KEY?.trim() && prefix === "SKATEHIVE") {
      connections.push({
        network: "Binance Square",
        status: "connected",
        detail: "Global OpenAPI key (the SkateHive account) — posts from suggestions, repo runs, and campaigns.",
      });
    } else {
      connections.push({
        network: "Binance Square",
        status: "missing",
        detail: "No key for THIS brand — cross-brand fallback is disabled, so the channel stays off until its own key is set.",
        fixHint: `Set ${prefix}_BINANCE_SQUARE_KEY`,
      });
    }
  }

  // ── Email (SMTP) ──────────────────────────────────────────────────────────
  {
    const smtpPresent = has("SMTP_HOST");
    const emailUserPresent = has("EMAIL_USER");
    const emailPassPresent = has("EMAIL_PASS");

    if (smtpPresent && emailUserPresent && emailPassPresent) {
      connections.push({
        network: "Email (SMTP)",
        status: "connected",
        detail: "SMTP is configured (host, user, and password are all set).",
      });
    } else {
      connections.push({
        network: "Email (SMTP)",
        status: "missing",
        detail: `Missing: ${[!smtpPresent && "SMTP_HOST", !emailUserPresent && "EMAIL_USER", !emailPassPresent && "EMAIL_PASS"].filter(Boolean).join(", ")}.`,
        fixHint: `Set SMTP_HOST / EMAIL_USER / EMAIL_PASS (or ${prefix}_ prefixed)`,
      });
    }
  }

  // ── Paragraph (newsletter) ────────────────────────────────────────────────
  {
    if (has("PARAGRAPH_API_KEY")) {
      connections.push({
        network: "Paragraph",
        status: "connected",
        detail: "Publication API key set — subscriber sync on the Userbase page (email sending pending Paragraph approval).",
      });
    } else {
      connections.push({
        network: "Paragraph",
        status: "missing",
        detail: "No Paragraph publication API key found.",
        fixHint: `Set ${prefix}_PARAGRAPH_API_KEY`,
      });
    }
  }

  // ── GitHub ────────────────────────────────────────────────────────────────
  {
    const tokenPresent = has("GITHUB_TOKEN");
    const kanban = project.githubProject;
    const repoCount = project.repos.length;
    if (tokenPresent && (kanban || repoCount > 0)) {
      const parts = [
        kanban && `Kanban board ${kanban.org} #${kanban.number}`,
        repoCount > 0 && `${repoCount} repo${repoCount > 1 ? "s" : ""} for Repo to Social`,
      ].filter(Boolean);
      connections.push({
        network: "GitHub",
        status: "connected",
        detail: `Token set — ${parts.join(", ")}.`,
      });
    } else if (tokenPresent) {
      connections.push({
        network: "GitHub",
        status: "warning",
        detail: "Token set, but no kanban project or repos configured for this project.",
        fixHint: "Add githubProject and/or repos to the project config",
      });
    } else {
      connections.push({
        network: "GitHub",
        status: "missing",
        detail: "No GitHub token found.",
        fixHint: `Set ${prefix}_GITHUB_TOKEN or GITHUB_TOKEN`,
      });
    }
  }

  // ── Google Drive (brain assets) ───────────────────────────────────────────
  {
    const folderPresent = has("GOOGLE_DRIVE_FOLDER_ID");
    const saPresent = has("GOOGLE_SERVICE_ACCOUNT_JSON");
    if (folderPresent && saPresent) {
      connections.push({
        network: "Google Drive",
        status: "connected",
        detail: "Service account + folder configured — Drive tab on the Brain page.",
      });
    } else if (hasOwn("GOOGLE_SERVICE_ACCOUNT_JSON") && !folderPresent) {
      // This brand wired its own service account but is missing the folder ID,
      // so Drive features can't resolve — surface it as a fixable gap, not "na".
      connections.push({
        network: "Google Drive",
        status: "missing",
        detail: "Service account is set for this brand, but the Drive folder ID is missing — Drive features won't resolve until it's set.",
        fixHint: `Set ${prefix}_GOOGLE_DRIVE_FOLDER_ID`,
      });
    } else {
      connections.push({
        network: "Google Drive",
        status: "na",
        detail: "No Drive folder wired for this project.",
      });
    }
  }

  // ── Userbase (Supabase) ───────────────────────────────────────────────────
  {
    const urlPresent = !!process.env.SUPABASE_USERBASE_URL?.trim();
    const keyPresent = !!process.env.SUPABASE_USERBASE_SERVICE_ROLE_KEY?.trim();
    if (urlPresent && keyPresent) {
      connections.push({
        network: "Userbase (Supabase)",
        status: "connected",
        detail: "Shared userbase database — powers the Userbase page and newsletter prefs.",
      });
    } else {
      connections.push({
        network: "Userbase (Supabase)",
        status: "missing",
        detail: "Supabase userbase not configured.",
        fixHint: "Set SUPABASE_USERBASE_URL + SUPABASE_USERBASE_SERVICE_ROLE_KEY",
      });
    }
  }

  // ── Pinata (IPFS uploads) ─────────────────────────────────────────────────
  {
    if (process.env.PINATA_JWT?.trim()) {
      connections.push({
        network: "Pinata (IPFS)",
        status: "connected",
        detail: "Media uploads in the Post Creator go straight from the browser to IPFS.",
      });
    } else {
      connections.push({
        network: "Pinata (IPFS)",
        status: "missing",
        detail: "No Pinata JWT — Post Creator media uploads won't work.",
        fixHint: "Set PINATA_JWT",
      });
    }
  }

  // ── Agent (OpenClaw gateway) ──────────────────────────────────────────────
  {
    const gatewayPresent = !!(
      process.env[`${prefix}_GATEWAY_TOKEN`] ??
      process.env.OPENCLAW_GATEWAY_TOKEN ??
      process.env.GATEWAY_TOKEN
    )?.trim();
    if (gatewayPresent) {
      connections.push({
        network: "Agent",
        handle: project.agent.displayName,
        status: "connected",
        detail: `OpenClaw agent "${project.agent.id}" — chat, briefings, campaign drafts, kanban AI.`,
      });
    } else {
      connections.push({
        network: "Agent",
        handle: project.agent.displayName,
        status: "missing",
        detail: "No OpenClaw gateway token found — AI features are offline.",
        fixHint: `Set GATEWAY_TOKEN (or ${prefix}_GATEWAY_TOKEN)`,
      });
    }
  }

  // ── Analytics (GA4 / GSC) ─────────────────────────────────────────────────
  // Base row from config + credential presence. The Settings page upgrades this
  // with a LIVE probe (verifyAnalyticsConnection) that actually calls GA4 + GSC,
  // so a configured-but-unauthorized property (e.g. property not shared with the
  // service account, or a stale host after a domain move) surfaces as a warning
  // instead of a false "connected".
  {
    const ga4 = project.analytics?.ga4PropertyId;
    const gsc = project.analytics?.gscSiteUrl;
    const parts = [ga4 && `GA4 property ${ga4}`, gsc && `GSC site ${gsc}`].filter(Boolean);

    if (!ga4 && !gsc) {
      connections.push({
        network: "Analytics",
        status: "na",
        detail: "No GA4 or Search Console configuration for this project.",
      });
    } else if (!has("GOOGLE_SERVICE_ACCOUNT_JSON")) {
      connections.push({
        network: "Analytics",
        status: "missing",
        detail: `Configured (${parts.join(", ")}), but no Google service account credential is set.`,
        fixHint: `Set ${prefix}_GOOGLE_SERVICE_ACCOUNT_JSON`,
      });
    } else {
      connections.push({
        network: "Analytics",
        status: "connected",
        detail: `Configured: ${parts.join(", ")} (not yet verified live).`,
      });
    }
  }

  return connections;
}

// Performs a live GA4 + GSC check: authorizes the service account and runs one
// small report/query against each configured surface. Returns per-surface ✓/✗
// so a property that isn't shared with the service account (or a stale host
// after a domain move) surfaces as a warning. Never throws; never returns the
// service-account key. Returns null when analytics isn't configured at all.
export async function verifyAnalyticsConnection(
  project: ProjectConfig,
): Promise<{ status: ConnectionStatus; detail: string } | null> {
  const ga4Id = project.analytics?.ga4PropertyId;
  const gscSite = project.analytics?.gscSiteUrl;
  if (!ga4Id && !gscSite) return null;

  const trunc = (s: string) => (s.length > 120 ? `${s.slice(0, 120)}…` : s);
  const { fetchGa4, fetchGsc } = await import("@/lib/google-analytics");
  const errResult = (e: unknown) => ({ ok: false as const, reason: "error" as const, error: String(e) });
  const [ga4, gsc] = await Promise.all([
    ga4Id ? fetchGa4(project, 7).catch(errResult) : Promise.resolve(null),
    gscSite ? fetchGsc(project, 7).catch(errResult) : Promise.resolve(null),
  ]);

  const bits: string[] = [];
  let anyError = false;
  let credMissing = false;
  const note = (res: { ok: boolean; reason?: string; error?: string } | null, label: string, target: string) => {
    if (!res) return;
    if (res.ok) {
      bits.push(`${label} ✓ (${target})`);
      return;
    }
    anyError = true;
    const err = res.reason === "error" ? res.error ?? "error" : "not configured";
    if (/service account env/i.test(err)) credMissing = true;
    bits.push(`${label} ✗ (${trunc(err)})`);
  };
  note(ga4, "GA4", `property ${ga4Id}`);
  note(gsc, "GSC", `${gscSite}`);

  const status: ConnectionStatus = credMissing ? "missing" : anyError ? "warning" : "connected";
  return { status, detail: bits.join(" · ") };
}

// Performs live Discord API checks: bot identity + channel access.
// Never throws; never logs or returns the bot token.
export async function verifyDiscordConnection(
  project: ProjectConfig,
): Promise<{ status: ConnectionStatus; detail: string; botName?: string }> {
  const { brandEnv } = await import("@/lib/brand-env");
  const token = brandEnv(project, "DISCORD_BOT_TOKEN");
  const channelId = brandEnv(project, "DISCORD_CHANNEL_ID") ?? project.discord?.channelId;

  if (!token || !channelId) {
    return { status: "missing", detail: "No bot token configured." };
  }

  const authHeader = { Authorization: `Bot ${token}` };

  // Step 1: verify the bot token via GET /users/@me.
  let botName: string;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    let meRes: Response;
    try {
      meRes = await fetch("https://discord.com/api/v10/users/@me", {
        headers: authHeader,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!meRes.ok) {
      return { status: "warning", detail: "Bot token invalid or unauthorized." };
    }
    const me = (await meRes.json()) as { username?: string; discriminator?: string };
    const discriminator =
      me.discriminator && me.discriminator !== "0" ? `#${me.discriminator}` : "";
    botName = `${me.username ?? "bot"}${discriminator}`;
  } catch {
    return { status: "warning", detail: "Couldn't reach Discord (timed out)." };
  }

  // Step 2: verify the bot can see the configured channel.
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    let chanRes: Response;
    try {
      chanRes = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
        headers: authHeader,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (chanRes.ok) {
      return {
        status: "connected",
        detail: `@${botName} can post to the channel`,
        botName,
      };
    }
    // 403 = missing access, 404 = channel not found or bot can't see it.
    return {
      status: "warning",
      detail: `@${botName} online, but can't see the configured channel`,
      botName,
    };
  } catch {
    return { status: "warning", detail: "Couldn't reach Discord (timed out)." };
  }
}

// Resolves the TikTok row against the DB: whether an account is actually
// connected, which handle, whether the audit has landed (unaudited = every post
// forced private), and how long the refresh token has left. Returns null when
// TikTok isn't enabled or no account was ever connected.
export async function verifyTikTokConnection(
  project: ProjectConfig,
): Promise<{ status: ConnectionStatus; detail: string; handle?: string } | null> {
  if (!project.tiktok) return null;
  const { getTikTokConnection } = await import("@/lib/tiktok");
  const conn = await getTikTokConnection(project).catch(() => null);
  if (!conn) return null;

  const handle = conn.username ? `@${conn.username.replace(/^@/, "")}` : undefined;

  if (!conn.connected) {
    return {
      status: "missing",
      detail: "The connection was revoked — reconnect from the TikTok page.",
      handle,
    };
  }

  const refreshDaysLeft = conn.refreshExpiresAt
    ? Math.floor((conn.refreshExpiresAt.getTime() - Date.now()) / 86_400_000)
    : null;

  // The refresh token is the thing that actually keeps posting alive; once it
  // lapses someone has to re-authorize by hand, so warn before it does.
  if (refreshDaysLeft !== null && refreshDaysLeft <= 0) {
    return { status: "missing", detail: "The refresh token expired — reconnect.", handle };
  }

  const expiry = refreshDaysLeft !== null ? ` · reconnect in ${refreshDaysLeft}d` : "";

  if (!conn.audited) {
    return {
      status: "warning",
      detail: `Connected${handle ? ` as ${handle}` : ""}, but the app isn't audited — every post publishes private${expiry}.`,
      handle,
    };
  }

  return {
    status: refreshDaysLeft !== null && refreshDaysLeft < 14 ? "warning" : "connected",
    detail: `Posting as ${handle ?? "the connected account"}${expiry}.`,
    handle,
  };
}

// Upgrades the Farcaster row when a signer was connected via Sign In With Neynar
// (stored in the DB), which getPortalConnections() can't see (it's sync/env-only).
// Returns null when there's no DB signer — caller keeps the env-derived row.
export async function verifyFarcasterConnection(
  project: ProjectConfig,
): Promise<{ status: ConnectionStatus; detail: string; handle?: string } | null> {
  const { resolveFarcasterSigner } = await import("@/lib/farcaster-signer");
  const resolved = await resolveFarcasterSigner(project);
  if (!resolved || resolved.source !== "db") return null;
  const handle = resolved.username ? `@${resolved.username.replace(/^@/, "")}` : undefined;
  return {
    status: "connected",
    detail: handle
      ? `Connected via Sign In With Neynar — casting as ${handle}.`
      : "Connected via Sign In With Neynar.",
    handle,
  };
}
