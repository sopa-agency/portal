/**
 * Per-page usage guides shown by the floating info button (PageInfo).
 * Keyed by route — matched by exact path or path prefix (subroutes inherit
 * the parent guide, e.g. /campaign-creator/123). Images live in /public/guides.
 */

export type GuideSection = {
  heading: string;
  body: string;
  image?: string;
  imageAlt?: string;
};

export type PageGuide = {
  title: string;
  tagline: string;
  sections: GuideSection[];
};

export const PAGE_GUIDES: Record<string, PageGuide> = {
  "/": {
    title: "Home",
    tagline: "Your daily starting point: the agent's morning brief and the social channels dashboard.",
    sections: [
      {
        heading: "Morning brief",
        body: "Each tab is a daily briefing compiled by the project's AI agent — community highlights, metrics movements, and suggested focus for the day. Hit Regenerate to refresh a briefing on demand; it pulls live data and the latest saved social insights.",
        image: "/guides/home.png",
        imageAlt: "Morning brief tab with the agent briefing",
      },
      {
        heading: "Socials",
        body: "The Socials tab has one subtab per connected channel (Hive, Farcaster, Instagram, X…). Each shows the posting strategy — voice, cadence, formats, dos & don'ts — plus live metrics: follower count, 7-day delta, and recent post performance with thumbnails.",
        image: "/guides/home-socials.png",
        imageAlt: "Socials tab with channel strategy and live metrics",
      },
      {
        heading: "AI insights per channel",
        body: "Under the metrics, \"Generate AI insights\" asks the project's agent to read that channel's numbers against its strategy and return prioritized recommendations. Insights are saved per channel and injected into the next morning brief.",
      },
    ],
  },
  "/post-creator": {
    title: "Post Creator",
    tagline: "Compose, schedule, and publish Instagram posts — single image, carousel, or Reel.",
    sections: [
      {
        heading: "Composing",
        body: "Pick a format (single, carousel up to 10, or Reel), drop your media, and write the caption — or let the AI draft/improve it in the brand's voice. The preview mirrors how the post will look on Instagram. Drafts save automatically per portal.",
        image: "/guides/post-creator.png",
        imageAlt: "Post Creator composer and Instagram-style preview",
      },
      {
        heading: "Extras",
        body: "Set the aspect ratio (1:1, 4:5, 1.91:1, 9:16 for Reels), add up to 3 collaborators (they accept in-app), a first comment for hashtags, and tag people on single images by clicking the photo.",
      },
      {
        heading: "Publish now, schedule, or manual",
        body: "Publish sends through the Instagram API with the portal's connected account. Scheduling auto-publishes at the chosen time. Posts that need music, paid-partnership tags, or a location become manual reminders — you get a \"Ready, post manually\" checklist and mark them as posted.",
      },
    ],
  },
  "/repo-to-social": {
    title: "Repo to Social",
    tagline: "Turns GitHub activity into ready-to-publish social posts.",
    sections: [
      {
        heading: "How it works",
        body: "A background worker watches the configured repository and drafts posts about merged work — new features, fixes, releases — in the project's voice. Each run produces a batch you can review post by post.",
        image: "/guides/repo-to-social.png",
        imageAlt: "Repo to Social runs and generated post batch",
      },
      {
        heading: "Review and publish",
        body: "Edit any draft, then publish to Hive, Farcaster, X (opens a prefilled composer), or Binance Square — individually or \"Post to all\". Posts can also be scheduled instead of sent immediately.",
      },
    ],
  },
  "/marketing-suggestions": {
    title: "Post Suggestions",
    tagline: "AI-generated post ideas for the brand, from community content or a theme you set.",
    sections: [
      {
        heading: "Generating a batch",
        body: "Set an optional theme and generate. Depending on the portal's config, the AI draws from the community's top posts and creators, the latest briefing, and your theme to draft a batch of platform-ready posts.",
        image: "/guides/marketing-suggestions.png",
        imageAlt: "Post Suggestions batch with drafts",
      },
      {
        heading: "Review and publish",
        body: "Each suggestion can be edited, discarded, published now (Hive, Farcaster, X intent, Binance Square) or scheduled. The config panel controls cadence, sources, and the standing prompt that shapes the voice.",
      },
    ],
  },
  "/campaign-creator": {
    title: "Campaign Creator",
    tagline: "One folder per campaign: a brief plus matching artifacts for every channel.",
    sections: [
      {
        heading: "Creating a campaign",
        body: "Start from a template (announcement, weekly recap…) or from an existing Instagram post via \"Create Campaign\" in the calendar dialog. The agent writes the Brief first — review or edit it, then generate the artifacts.",
        image: "/guides/campaign-creator.png",
        imageAlt: "Campaign folder with brief and artifacts",
      },
      {
        heading: "Artifacts",
        body: "Each campaign gets channel-specific drafts in the brand voice: X thread, Farcaster cast, Discord announcement, email, and Hive snap. Use the per-artifact bar to Send (Hive/Farcaster/Discord publish directly; X opens a composer), mark as Posted, or Remix with a revision instruction.",
      },
      {
        heading: "Email",
        body: "The email artifact renders as a branded HTML email. Send it to a single recipient, or \"Blast to userbase\" to email every community member with a linked address — blasts include an unsubscribe link and honor opt-outs automatically.",
      },
    ],
  },
  "/userbase": {
    title: "Userbase",
    tagline: "The community roster — who's active, growing, or fading, with linked contact info.",
    sections: [
      {
        heading: "Reading the table",
        body: "Members of the community ranked by activity, with Hive reputation, recent posting, and linked email when known. Use it to find who to re-engage and who your most consistent contributors are.",
        image: "/guides/userbase.png",
        imageAlt: "Userbase table with member activity",
      },
    ],
  },
  "/brain": {
    title: "Brain",
    tagline: "The agent's memory and the brand's shared Drive, in one place.",
    sections: [
      {
        heading: "Workspace",
        body: "Files the agent actually uses: playbook, notes, and memory. The playbook is pinned at the top. You can read, edit, or delete files — edits take effect on the agent's next run, so this is the place to teach it durable facts and rules.",
        image: "/guides/brain.png",
        imageAlt: "Brain workspace file explorer with markdown preview",
      },
      {
        heading: "Drive",
        body: "Read-only view of the brand's shared Google Drive folder: browse subfolders, preview Docs, Sheets, images, PDFs and markdown without leaving the portal. Available on portals with a connected Drive folder.",
      },
    ],
  },
  "/analytics": {
    title: "Analytics",
    tagline: "Website traffic (GA4) and search performance (Search Console) side by side.",
    sections: [
      {
        heading: "Google Analytics",
        body: "Users, sessions, and pageviews over time, top pages, and where visitors come from. Known bot traffic is filtered out so the numbers reflect real people.",
        image: "/guides/analytics.png",
        imageAlt: "GA4 analytics dashboard",
      },
      {
        heading: "Search Console",
        body: "The queries that surface the site on Google — impressions, clicks, CTR, and position — useful for spotting content worth doubling down on.",
      },
    ],
  },
  "/kanban": {
    title: "Kanban",
    tagline: "The team's GitHub Project board, editable without leaving the portal.",
    sections: [
      {
        heading: "The board",
        body: "Columns mirror the GitHub Project's Status field. Drag cards between columns to change status, or within a column to reorder — changes save to GitHub instantly. Counts and colors show each column's load at a glance.",
        image: "/guides/kanban.png",
        imageAlt: "Kanban board with status columns",
      },
      {
        heading: "Cards",
        body: "Each card is an issue, PR, or draft with labels, state, and assignees. Hover a card for quick actions: open in GitHub, archive, or delete. Use the + on a column header to add a draft card directly into that status.",
      },
    ],
  },
  "/team": {
    title: "Team",
    tagline: "Who's on this portal, how to reach them, and what's connected.",
    sections: [
      {
        heading: "Members",
        body: "Everyone allowlisted on this portal. Click a member to open their contact card: all their known handles (Hive, Telegram, Farcaster, email…) with direct links.",
        image: "/guides/team.png",
        imageAlt: "Team members grid and linked networks",
      },
      {
        heading: "Messaging a member",
        body: "The contact card includes a composer. Pick a channel — private ones (email) come first and are pre-selected; public ones post on Hive, Farcaster, or the project's Discord mentioning the member. Write and hit Send.",
        image: "/guides/team-message.png",
        imageAlt: "Member contact card with the message composer",
      },
      {
        heading: "Linked networks",
        body: "Connection status for every network this portal can publish to. Green = ready; warnings flag fallbacks (e.g. posting would use the global account); \"Not set\" lists exactly which env vars are missing.",
      },
    ],
  },
};

/** Resolve the guide for a pathname (exact match, else longest prefix). */
export function guideForPath(pathname: string): PageGuide | null {
  if (PAGE_GUIDES[pathname]) return PAGE_GUIDES[pathname];
  const prefix = Object.keys(PAGE_GUIDES)
    .filter((route) => route !== "/" && pathname.startsWith(`${route}/`))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? PAGE_GUIDES[prefix] : null;
}
