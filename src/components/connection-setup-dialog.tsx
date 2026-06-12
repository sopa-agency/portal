"use client";

import { useEffect } from "react";
import { ExternalLink, X } from "lucide-react";
import type { PortalConnection } from "@/lib/portal-connections";
import { SocialBrandIcon } from "@/components/social-brand-icon";

// ---------------------------------------------------------------------------
// Per-service setup walkthroughs, opened by clicking a connection row on the
// Team page. `{P}` in code lines is replaced by the project's env prefix.
// Every tutorial ends with the same "where keys live" footer.
// ---------------------------------------------------------------------------

type TutorialStep = {
  text: string;
  /** Optional external link rendered as a button under the step. */
  href?: string;
  hrefLabel?: string;
  /** Env lines / commands rendered as a code block under the step. */
  code?: string[];
};

type Tutorial = {
  /** Lowercase substring matched against connection.network. */
  match: string;
  icon: string | null;
  intro: string;
  steps: TutorialStep[];
};

const TUTORIALS: Tutorial[] = [
  {
    match: "hive",
    icon: "hive",
    intro:
      "Publishing snaps and mag posts needs the brand's own Hive account POSTING key. Cross-brand fallback is disabled — each portal posts only as its own account.",
    steps: [
      {
        text: "Open Hive Keychain → click the account → Manage keys (or PeakD → Wallet → Keys & permissions) and copy the PRIVATE posting key (starts with 5…). Never the active or owner key.",
        href: "https://peakd.com/me/permissions",
        hrefLabel: "Open PeakD keys",
      },
      {
        text: "Add both vars — account WITHOUT the @:",
        code: ["{P}_HIVE_POSTING_ACCOUNT=accountname", "{P}_HIVE_POSTING_KEY=5K…"],
      },
    ],
  },
  {
    match: "farcaster",
    icon: "farcaster",
    intro:
      "Casting needs a Neynar API key plus a managed SIGNER approved by the brand's Farcaster account. The signer is the identity — it never falls back across brands.",
    steps: [
      {
        text: "Create (or open) the app on the Neynar dev portal and copy its API key.",
        href: "https://dev.neynar.com",
        hrefLabel: "Open Neynar",
      },
      {
        text: "Create a managed signer for the brand's account — the repo has a helper that prints the approval QR/link and the signer UUID:",
        code: ["node scripts/farcaster-signer-setup.js"],
      },
      {
        text: "Approve the signer in Warpcast with the brand account, then set:",
        code: ["{P}_NEYNAR_API_KEY=…", "{P}_NEYNAR_SIGNER_UUID=…"],
      },
    ],
  },
  {
    match: "instagram",
    icon: "instagram",
    intro:
      "Publishing uses the Instagram Graph API: a Meta system-user token + the IG business account id. The IG account must be Professional and linked to a Facebook Page inside Business Manager.",
    steps: [
      {
        text: "In Meta Business Settings → Users → System users: create an Admin system user (or open the existing one, e.g. \"Reelflip Worker\").",
        href: "https://business.facebook.com/settings/system-users",
        hrefLabel: "Open Business Settings",
      },
      {
        text: "Add assets to the system user: the brand's Facebook Page + Instagram account (full control). If the Page lives in another Business, ask its admin to Assign partner with your Business ID first.",
      },
      {
        text: "Generate new token → pick the app → expiration NEVER → scopes: instagram_basic, instagram_content_publish, instagram_manage_insights, pages_show_list, pages_read_engagement, publish_video, business_management.",
      },
      {
        text: "Paste the token in the portal chat (or to @xvlad) — the business account ID is auto-discovered from it. Then set:",
        code: ["{P}_INSTAGRAM_ACCESS_TOKEN=EAA…", "{P}_INSTAGRAM_BUSINESS_ACCOUNT_ID=1784…"],
      },
    ],
  },
  {
    match: "facebook",
    icon: "facebook",
    intro:
      "Facebook Page reads (followers, reach, posts on the home dashboard) ride the SAME Meta token as Instagram — no extra credential.",
    steps: [
      {
        text: "Set up the Instagram connection first (see the Instagram row) — the page is then auto-discovered from the token via /me/accounts.",
      },
      {
        text: "Only if the token ever sees MORE than one page, pin the right one:",
        code: ["{P}_FACEBOOK_PAGE_ID=1234567890"],
      },
    ],
  },
  {
    match: "binance",
    icon: "binance",
    intro:
      "Posting to Binance Square uses the Square OpenAPI key of the brand's Binance creator account. Posts are plain text — the API rejects links and markdown.",
    steps: [
      {
        text: "Log into the brand's Binance account → Binance Square → Creator Center → settings, and request/copy the OpenAPI key.",
        href: "https://www.binance.com/en/square",
        hrefLabel: "Open Binance Square",
      },
      {
        text: "Set the project key (the global key belongs to SkateHive and is not shared across brands):",
        code: ["{P}_BINANCE_SQUARE_KEY=…"],
      },
    ],
  },
  {
    match: "discord",
    icon: "discord",
    intro:
      "Team messages and campaign announcements post via the brand's own Discord bot into one channel.",
    steps: [
      {
        text: "Discord Developer Portal → New Application → Bot → Reset token and copy it. Enable the SERVER MEMBERS intent if you want @mentions resolution.",
        href: "https://discord.com/developers/applications",
        hrefLabel: "Open Developer Portal",
      },
      {
        text: "Invite the bot to the server: OAuth2 → URL Generator → scope \"bot\" → permissions Send Messages + Read Message History, open the generated URL.",
      },
      {
        text: "In Discord, enable Developer Mode (Settings → Advanced), right-click the target channel → Copy Channel ID. Then set:",
        code: ["{P}_DISCORD_BOT_TOKEN=…", "{P}_DISCORD_CHANNEL_ID=123456789012345678"],
      },
    ],
  },
  {
    match: "smtp",
    icon: null,
    intro:
      "Campaign emails and the newsletter blast send through the brand's own mailbox via SMTP.",
    steps: [
      {
        text: "For Gmail: create an App password (requires 2FA) — Google Account → Security → App passwords.",
        href: "https://myaccount.google.com/apppasswords",
        hrefLabel: "Create Gmail app password",
      },
      {
        text: "Set the mailbox + server:",
        code: [
          "{P}_SMTP_HOST=smtp.gmail.com",
          "{P}_SMTP_PORT=465",
          "{P}_SMTP_SECURE=true",
          "{P}_EMAIL_USER=brand@gmail.com",
          "{P}_EMAIL_PASS=app-password",
        ],
      },
    ],
  },
  {
    match: "paragraph",
    icon: "paragraph",
    intro:
      "Newsletter subscribers sync to the brand's Paragraph publication (and email sending will route through it once Paragraph approves the API).",
    steps: [
      {
        text: "Open the publication on Paragraph → Settings → API and create/copy the publication API key.",
        href: "https://paragraph.com",
        hrefLabel: "Open Paragraph",
      },
      {
        text: "Set:",
        code: ["{P}_PARAGRAPH_API_KEY=para_…"],
      },
    ],
  },
  {
    match: "github",
    icon: "github",
    intro:
      "Powers the Kanban board (GitHub Projects V2) and Repo to Social (commit-driven drafts).",
    steps: [
      {
        text: "Create a token with access to the brand's org: classic PAT with repo + project scopes, or a fine-grained token with Issues/Projects read-write on the right repos.",
        href: "https://github.com/settings/tokens",
        hrefLabel: "Open GitHub tokens",
      },
      {
        text: "Set the token (the shared GITHUB_TOKEN also works if it can access the org):",
        code: ["{P}_GITHUB_TOKEN=ghp_…"],
      },
      {
        text: "Point the project config at the board and repos: githubProject { org, number } + repos[] in src/projects/<slug>.ts — ask @xvlad or the portal chat to wire it.",
      },
    ],
  },
  {
    match: "drive",
    icon: "drive",
    intro: "Shows a Google Drive folder as the Drive tab on the Brain page.",
    steps: [
      {
        text: "Google Cloud Console → IAM → Service accounts → create one and download the JSON key.",
        href: "https://console.cloud.google.com/iam-admin/serviceaccounts",
        hrefLabel: "Open Cloud Console",
      },
      {
        text: "Share the Drive folder with the service account's email (Viewer), copy the folder ID from its URL, then set:",
        code: [
          "{P}_GOOGLE_SERVICE_ACCOUNT_JSON=.secrets/<file>.json",
          "{P}_GOOGLE_DRIVE_FOLDER_ID=1AbC…",
        ],
      },
    ],
  },
  {
    match: "supabase",
    icon: "supabase",
    intro:
      "The shared userbase database (2K+ users) behind the Userbase page and newsletter preferences. One database serves all portals.",
    steps: [
      {
        text: "Supabase dashboard → the userbase project → Settings → API: copy the URL and the service_role key (server-side only — never expose it to the browser).",
        href: "https://supabase.com/dashboard",
        hrefLabel: "Open Supabase",
      },
      {
        text: "Set (global — not per-project):",
        code: ["SUPABASE_USERBASE_URL=https://….supabase.co", "SUPABASE_USERBASE_SERVICE_ROLE_KEY=eyJ…"],
      },
    ],
  },
  {
    match: "pinata",
    icon: "pinata",
    intro:
      "Post Creator media uploads go straight from the browser to IPFS via Pinata signed URLs.",
    steps: [
      {
        text: "Pinata dashboard → API Keys → New key (pinFileToIPFS permission) and copy the JWT.",
        href: "https://app.pinata.cloud/developers/api-keys",
        hrefLabel: "Open Pinata",
      },
      {
        text: "Set (global — shared by all portals):",
        code: ["PINATA_JWT=eyJ…"],
      },
    ],
  },
  {
    match: "agent",
    icon: null,
    intro:
      "Each portal pins one OpenClaw agent — it powers the chat, morning briefings, campaign drafts and kanban AI. All portals share one gateway on the Mac mini.",
    steps: [
      {
        text: "Register the agent in OpenClaw with the id from the project config (agent.id) and a workspace at ~/.openclaw/workspace-<id> containing AGENTS.md / SOUL.md / docs.",
      },
      {
        text: "The gateway envs are already global (OPENCLAW_GATEWAY_URL + GATEWAY_TOKEN) — a new agent needs NO new env. If this row shows missing, the gateway token itself is gone:",
        code: ["GATEWAY_TOKEN=…"],
      },
    ],
  },
  {
    match: "analytics",
    icon: "analytics",
    intro: "GA4 + Search Console feed the Analytics page.",
    steps: [
      {
        text: "GA4: Admin → create a property for the brand site, install the gtag, and grant Viewer access to the service account (…@skatehive-94e95.iam.gserviceaccount.com).",
        href: "https://analytics.google.com",
        hrefLabel: "Open Google Analytics",
      },
      {
        text: "Search Console: verify the domain (DNS TXT) and add the same service account as a user.",
        href: "https://search.google.com/search-console",
        hrefLabel: "Open Search Console",
      },
      {
        text: "Then wire the property ID + site into the project config's analytics block (src/projects/<slug>.ts) — ask @xvlad or the portal chat.",
      },
    ],
  },
  {
    match: "x",
    icon: "x",
    intro:
      "X posts open pre-filled in the X composer (intent links) — the API requires a paid tier, so there is nothing to configure. Click the X button on any draft and post manually.",
    steps: [],
  },
];

function findTutorial(network: string): Tutorial | null {
  const name = network.toLowerCase();
  // "userbase (supabase)" must match supabase before generic terms; "x / twitter"
  // must not swallow other names containing the letter x — match it exactly last.
  for (const t of TUTORIALS) {
    if (t.match === "x") continue;
    if (name.includes(t.match)) return t;
  }
  if (name === "x / twitter" || name === "x" || name.includes("twitter")) {
    return TUTORIALS.find((t) => t.match === "x") ?? null;
  }
  return null;
}

export function ConnectionSetupDialog({
  connection,
  envPrefix,
  onClose,
}: {
  connection: PortalConnection;
  envPrefix: string;
  onClose: () => void;
}) {
  const tutorial = findTutorial(connection.network);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${connection.network} setup`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-surface-elevated shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border p-5">
          <div className="flex items-center gap-2.5">
            {tutorial?.icon && <SocialBrandIcon platform={tutorial.icon} className="h-5 w-5" />}
            <h3 className="text-base font-semibold text-foreground">
              {connection.network} — setup
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg border border-border p-1.5 text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <p className="text-sm text-foreground-muted">{connection.detail}</p>

          {tutorial ? (
            <>
              <p className="text-sm leading-relaxed text-foreground">{tutorial.intro}</p>
              {tutorial.steps.length > 0 && (
                <ol className="space-y-4">
                  {tutorial.steps.map((step, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-bg text-xs font-bold text-accent">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className="text-sm leading-relaxed text-foreground-muted">{step.text}</p>
                        {step.href && (
                          <a
                            href={step.href}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
                          >
                            {step.hrefLabel ?? "Open"}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        {step.code && (
                          <pre className="overflow-x-auto rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
                            {step.code.map((l) => l.replaceAll("{P}", envPrefix)).join("\n")}
                          </pre>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              {tutorial.steps.length > 0 && (
                <p className="rounded-xl border border-border bg-surface px-3.5 py-2.5 text-xs leading-relaxed text-foreground-subtle">
                  Keys go in <code className="font-mono">.env.local</code> on the Mac mini AND the
                  Vercel production env, then rebuild/redeploy. Fastest path: paste the key in the
                  portal chat (bottom-right) or send it privately to @xvlad — the agent wires it.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-foreground-muted">
              No guided setup for this one yet — check the fix hint below or ask in the portal chat.
            </p>
          )}

          {connection.fixHint && (
            <p className="text-xs text-foreground-subtle">
              <span className="mr-1 text-foreground-faint">→</span>
              <code className="rounded bg-surface px-1 py-0.5 font-mono text-[11px]">
                {connection.fixHint}
              </code>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
