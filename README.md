# Portal — Multi-Tenant Ops Cockpit

A multi-tenant internal portal for running a brand's social + community
operations: AI-drafted posts, campaign building, briefings, analytics, and a
per-project "brain". One codebase serves many projects — each on its own
subdomain, with its own theme, accounts, allowlist, and AI agent.

> **Who owns this.** The portal is an asset of **SOPA agency**. The canonical
> repo is **`sopa-agency/portal`** — it deploys to `*.sopa.team` from SOPA's own
> Vercel team (`sopa1`). The old `SkateHive/marketing-portal` is the sunset
> repo: its history was merged here in August 2026 and nothing new lands there.
>
> **SkateHive is a brand inside SOPA, not the owner of the product.** Same for
> the others. Tenants today, each on its own subdomain: **SOPA** (the agency
> portal that sits above the rest — combined treasury, editable org-chart,
> portfolio, deck-style About), **SkateHive**, **Gnars**, **Nogenta** (skate
> editorial, B&W), **Vlad**, **KeepKey**, and **swaps.pro**.
>
> The **Reelflip** name still appears throughout the code (umbrella logic, the
> `/home` public page, `*.reelflip.com` redirects). It is legacy — the umbrella
> is SOPA now — and removing it is its own piece of work, not done here.

## Stack

- **Next.js 16** (App Router) + **React 19** — ⚠️ this Next has breaking changes vs. older versions; read `node_modules/next/dist/docs/` before writing routing/caching/server-action code, and see `AGENTS.md`.
- **Prisma + PostgreSQL** — portal data (runs, drafts, votes, campaigns).
- **Supabase** — read-only userbase (SkateHive accounts) for the `/userbase` admin.
- **Tailwind v4** — class-based light/dark theming is **mandatory** (see `AGENTS.md`).
- **OpenClaw gateway** — the AI backbone; each project pins one OpenClaw agent.
- **Publishing** — Hive (`@hiveio/dhive`), Farcaster (Neynar signer), Instagram (Meta Graph), X.
- **Auth** — Hive keychain signature login, gated by a per-project allowlist.

## How multi-tenancy works

Tenancy is resolved from the request **subdomain**:

```
skatehive.sopa.team  → slug "skatehive" → SkateHive ProjectConfig
gnars.sopa.team      → slug "gnars"     → Gnars ProjectConfig
swaps.sopa.team      → slug "swaps"     → swaps.pro ProjectConfig
localhost / apex     → PORTAL_DEFAULT_PROJECT
```

1. `src/proxy.ts` (middleware) resolves the slug from the `Host` header and
   stamps every request with an `x-portal-project` header.
2. `src/projects/index.ts` holds the `PROJECT_REGISTRY` and exposes
   `getActiveProject()` — call it from any server component, server action, or
   route handler to get the current tenant's `ProjectConfig`.
3. Everything project-specific (theme, allowlist, Hive/Farcaster accounts,
   repos, social channels, briefing agents, hidden routes, analytics) reads off
   that config. No tenant can reach another tenant's data or agent workspace.

Each project is **pinned to one OpenClaw agent**, whose "brain" workspace
(`~/.openclaw/workspace-<agentId>`) is exposed read/edit through `/brain` —
scoped so a tenant can only ever see its own workspace.

## Modules (sidebar)

| Route | What it does | Notes |
|-------|--------------|-------|
| `/` (Home) | Per-project **Socials** dashboard + agent **morning briefings** | Channels & briefing tabs come from the project config |
| `/repo-to-social` | Worker turns GitHub commits → drafted tweets, with an editorial vote/approve/publish flow | Hidden for projects with no repos |
| `/marketing-suggestions` | Sister pipeline: community signals (top posts/creators/briefing) → drafted posts | Uses the project's marketing agent |
| `/campaign-creator` | Build & send campaigns (email templates, Hive publishing, weekly recaps) | `weeklyRecap` spec is per-project |
| `/userbase` | Supabase-backed account admin | SkateHive only by default |
| `/brain` | Browse/edit the active agent's workspace files | Tenant-scoped |
| `/post-creator` | Compose/schedule Instagram posts + Studio (image/video editor, Drive, templates) | `postCreator` projects only |
| `/analytics` | GA4 + Search Console dashboards with AI insights | Only when `analytics` is configured |
| `/kanban` | GitHub Project V2 board — status, assignees, draft cards | `githubProject` projects only |
| `/treasury` | Combined on-chain + Hive treasury view | `treasury` projects |
| `/team` | Team roster, contacts, and messaging | — |
| `/about`, `/org-chart`, `/portfolio` | SOPA-only: model deck, editable org flowchart (tiers + team avatars), portfolio cards | gated by `about`/`orgChart`/`portfolio` flags |
| Floating chat | In-app chat with the project's OpenClaw agent | `/api/agent/chat` — see below |

The **floating chat** has a `Deep` mode for heavy/code tasks (longer budget) and,
when a turn errors or times out, offers to **park the request as a Kanban draft
card** for a human to pick up later (projects with a board).

### Hybrid architecture (Vercel + Mac mini)

The site runs on **Vercel**, but the **OpenClaw gateway runs on a Mac mini** and
is **not reachable from Vercel** over the Tailscale funnel. So agent/briefing/
brain calls don't hit the gateway directly from Vercel — they go through **DB job
queues** (Neon) that both sides share:

- `AgentJob` / `BriefingJob` / `BrainOpJob` — the portal enqueues; **Mac workers**
  (`scripts/*-worker.js`, PM2) poll, call the local gateway (`127.0.0.1:18789`),
  and write results back. Workers **heartbeat** (`lockedAt`) so long jobs aren't
  reclaimed, **serialize per project** (briefings), and **retry** transient
  gateway drops.
- For long chat turns the inline server function hits Vercel's ~290s ceiling, so
  `ChatJob` links to its `AgentJob` and the client **polls** the worker's result
  past that ceiling (up to ~20 min in Deep mode).
- `/api/scheduler/cron` is a **fallback** publisher — it only acts when the Mac's
  heartbeat lease is stale; normal posting stays on the Mac (residential IP).

## Adding a new project (tenant)

The whole point of the template — a new brand is a config file, not a fork:

1. **Create `src/projects/<slug>.ts`** exporting a `ProjectConfig`
   (see `src/projects/types.ts` for the full shape, `keepkey.ts` / `swaps.ts` as
   the smallest references and `skatehive.ts` / `gnars.ts` as full ones). Set the theme accent, `allowlist`
   (Hive usernames), `hive`/`farcaster` accounts, `socials`, `briefingAgents`,
   the OpenClaw `agent`, and any `hiddenRoutes`.
2. **Register it** in `src/projects/index.ts` (`PROJECT_REGISTRY`).
3. **Add assets** under `public/projects/<slug>/` (logo, favicon).
4. **Add namespaced secrets** in your env file: `{SLUG}_GATEWAY_URL`,
   `{SLUG}_GATEWAY_TOKEN`, `{SLUG}_PORTAL_DEVICE_*` (see `.env.example`).
5. *(Optional)* Drop prompt overrides in the dir named by `prompts.dir`.
6. Point a subdomain at the deployment — the middleware does the rest.

## Getting started

```bash
# 1. Install
npm install

# 2. Configure — copy and fill in. See the file for every variable.
cp .env.example .env.local

# 3. Database
npm run db:generate
npm run db:push

# 4. Dev server (http://localhost:3000 → PORTAL_DEFAULT_PROJECT)
npm run dev
```

To exercise a specific tenant locally, hit it by subdomain, e.g.
`http://gnars.localhost:3000` (most browsers resolve `*.localhost` automatically).

### Workers

```bash
npm run worker:repo-to-social         # commits → drafted tweets
npm run worker:marketing-suggestions  # community signals → drafted posts
npm run worker:briefing               # BriefingJob queue → morning briefings
npm run worker:agent                  # AgentJob queue → chat/agent calls
npm run worker:brain-queue            # BrainOpJob queue → /brain file ops
```

On the Mac mini these run under **PM2** (`sopa-portal-*`, some still registered under the old `multi-tenant-portal-*` names) alongside the
brain file server and presence relay; they bridge Vercel → local OpenClaw gateway.

## Environment

`.env.example` is the source of truth and is fully commented. The shape:

- **Shared infra** — `DATABASE_URL`, `SESSION_SECRET`, `PORTAL_DEFAULT_PROJECT`.
- **Per-project secrets** — namespaced `{UPPERCASE_SLUG}_*` (gateway URL/token,
  device keys). SkateHive also falls back to legacy global `OPENCLAW_*` /
  `GATEWAY_TOKEN` names for zero-change backward compatibility.
- **Publishing** — Hive posting key, Neynar/Farcaster, Pinata, Instagram, X.
- **Userbase** — Supabase service-role (server-only).

## Conventions

- **Light + dark mode is mandatory** for every UI change — use the semantic
  tokens, never hardcode `zinc`/`black`/`white`. Full rules in `AGENTS.md`.
- **Read the Next.js docs in `node_modules`** before writing framework code;
  this version diverges from common training-data assumptions.

.
