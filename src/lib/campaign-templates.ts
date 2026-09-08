// Pre-built campaign templates. Each template seeds a new campaign's Brief
// with a Hive-blog-shaped skeleton: structured headings, placeholders, and
// enough context that the AI's "Generate everything from brief" produces
// useful artifacts in one pass.
//
// `[[double-brackets]]` mark placeholders for the user to fill in before
// generating artifacts. The campaign worker treats them as literal text — the
// AI is free to either keep, replace, or interpret them.
//
// Token substitution: {{project}}, {{community}}, {{frontend}}, {{account}},
// {{farcaster}} are replaced from a ProjectConfig before the template is shown.

import type { ProjectConfig } from "@/projects/types";

export type CampaignTemplate = {
  id: string;
  name: string; // becomes the campaign name on create
  label: string; // short display label for the picker
  tagline: string; // one-line description shown under the label
  briefSeed: string; // markdown body written into the Brief document
};

// ---------------------------------------------------------------------------
// Token substitution helper
// ---------------------------------------------------------------------------

/**
 * Replace {{project}}, {{community}}, {{frontend}}, {{account}}, {{farcaster}}
 * tokens in a template's name / tagline / briefSeed using the given project's
 * config. Returns a new CampaignTemplate; leaves all other fields unchanged.
 */
export function substitute(tpl: CampaignTemplate, project: ProjectConfig): CampaignTemplate {
  const replacements: Record<string, string> = {
    "{{project}}": project.name,
    "{{community}}": project.hive.community,
    "{{frontend}}": project.hive.frontend ?? "peakd.com",
    "{{account}}": `@${project.hive.account}`,
    "{{farcaster}}": project.farcaster.channel,
  };

  function replaceAll(text: string): string {
    let out = text;
    for (const [token, value] of Object.entries(replacements)) {
      // Replace every occurrence — use split/join to avoid RegExp escaping.
      out = out.split(token).join(value);
    }
    return out;
  }

  return {
    ...tpl,
    name: replaceAll(tpl.name),
    tagline: replaceAll(tpl.tagline),
    briefSeed: replaceAll(tpl.briefSeed),
  };
}

// ---------------------------------------------------------------------------
// Generic (brand-neutral) default templates
// ---------------------------------------------------------------------------
// These are shown for any tenant that does NOT have a slug entry in
// TEMPLATES_BY_SLUG. Tokens are substituted at render time via substitute().

export const DEFAULT_CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  {
    id: "weekly-stoken",
    name: "Weekly Recap — [[week of YYYY-MM-DD]]",
    label: "Weekly Recap",
    tagline: "Weekly content recap — the standout posts & creators this week.",
    briefSeed: `# Weekly Recap — [[week of YYYY-MM-DD]]

A weekly recap of the standout posts and creators in {{project}} this past week. Sent every Monday to the community newsletter list, posted as a long-form blog to {{community}}, and shared in summary form across channels.

## Goal
Surface 5-8 standout posts so newer members discover the best of what shipped this week, and the featured creators get a second wave of engagement. Target: 200+ visits to featured posts within 48 h of send.

## Audience
Active {{project}} readers and casual followers who skim Hive and Farcaster but don't open every post. They want curation — "the things worth your time this week."

## The offer
A curated list of the week's best posts on {{project}}, each with a 1-2 sentence write-up explaining why it's worth reading and a direct link. Plus one "Creator of the Week" spotlight with a short intro.

## Featured posts this week
- [[post 1 — author, permlink, 1 line on why it stands out]]
- [[post 2 — ...]]
- [[post 3 — ...]]
- [[post 4 — ...]]
- [[post 5 — ...]]

## Creator of the Week
[[Hive username]] — [[1-2 sentence intro: who they are, what kind of content they post]].

## Window
Published [[date]]. Cross-post to all channels same day.

## Channels
1. Hive long-form blog post (this brief, expanded) on {{community}} — primary.
2. Hive snap linking to the blog with a 1-line teaser, posted via {{account}}.
3. Farcaster cast in /{{farcaster}} mirroring the snap.
4. Twitter thread highlighting 3-4 of the top posts.
5. Discord announcement with the full list.
6. Email newsletter — visual recap with thumbnails.
   Links to featured posts use {{frontend}} as the base URL.

## Success metric
Click-throughs to featured posts (primary). North-star: returning weekly readers ("regulars who open every recap").

## Risks
- Featuring the same creators too often → rotate weekly, track recent features.
- Light weeks → don't pad with weak picks; cut to 3 if that's the honest read.
- Late publishing → assign owner by Friday EOD so a weekend buffer exists.

## Next steps
- [ ] Pick 5-8 posts and write 1-2 sentence blurbs each.
- [ ] Choose Creator of the Week + draft a short intro.
- [ ] Once brief is filled, click "Generate everything from brief" to draft snap, cast, tweets, Discord, and email.
`,
  },
  {
    id: "updates-roundup",
    name: "Updates Round-Up — [[YYYY-MM-DD]]",
    label: "Updates Round-Up",
    tagline: "Project/product update recap — what shipped recently.",
    briefSeed: `# Updates Round-Up — [[YYYY-MM-DD]]

A shipping recap for {{project}}. Goes out every 2-3 weeks when there's enough material. The goal is to keep the community in the loop on what's actually changing in the project.

## Goal
Show progress on {{project}}: features shipped, improvements made, what's next. Target: 100+ community members interacting with at least one new feature within a week of send.

## Audience
Active community members — the people who engage regularly and notice when things change. They want context for why things are different. Tone is team-to-community, direct and honest.

## The offer
A clear, scannable list of what changed since the last round-up, with screenshots or examples where useful and a "what's next" preview.

## Shipped this round
- [[feature 1 — 1-2 sentence description + who it helps]]
- [[feature 2 — ...]]
- [[bug fix or polish — ...]]
- [[infra / performance — ...]]

## Coming next
- [[next item in flight — rough timing]]
- [[next item in flight — ...]]

## Window
Publish [[date]]. Blog post goes up in the morning; snap + cast follow within the hour; Twitter thread + Discord drop same day.

## Channels
1. Hive long-form blog post on {{community}} — primary, with detail and context.
2. Hive snap linking to the blog with the headline ship, posted via {{account}}.
3. Farcaster cast in /{{farcaster}} mirroring the snap.
4. Twitter thread breaking out the 3 most visible changes.
5. Discord #announcements with the full list + relevant links.
6. (Optional) Email if the round-up has a flagship update worth direct outreach.
   Links use {{frontend}} as the base URL where applicable.

## Success metric
Visits to the post / project following the announcement (primary). North-star: % of active members who try at least one new thing within 7 days.

## Risks
- Quiet period → don't ship a round-up for the sake of it; combine with the next one.
- Overpromising "coming next" items that slip → only list items in active development.
- Jargon → write for the community, not for insiders.

## Next steps
- [ ] Pull the shipped changes / merged items since the last round-up.
- [ ] Pick the 3 most user-visible to highlight; the rest go in a list at the bottom.
- [ ] Once brief is filled, click "Generate everything from brief" to draft snap, cast, tweets, Discord, and email.
`,
  },
  {
    id: "we-miss-you",
    name: "Re-engagement — [[YYYY-MM-DD]]",
    label: "Re-engagement",
    tagline: "Win-back campaign for members who've gone quiet.",
    briefSeed: `# Re-engagement — [[YYYY-MM-DD]]

A re-engagement push for {{project}} members who were active at some point but have been quiet for 30+ days. We want them to know we noticed they've been away and give them an easy reason to come back.

## Goal
Bring lapsed members back to contribute at least once. Target: 15% of the win-back audience publishes a new post within 14 days of contact.

## Audience
Community members whose last post on {{community}} was 30-90 days ago. Filter out spam accounts and one-time posters who never really engaged. We're reaching out to people who used {{project}} seriously and then drifted.

## The offer
A short, honest "we noticed, here's what's changed, here's a low-friction way back" message. Light incentive: feature in next weekly recap if they post in the window, plus a small welcome-back acknowledgement from [[approver]] on their return post.

## Window
[[start date]] to [[end date]] — keep the window short (2 weeks) so the urgency is real. Send Hive snap + Farcaster cast on day 1, email + Discord message on day 3, gentle follow-up on day 10 for non-responders.

## Channels
1. Email — primary channel, personalized with first_name + last post date.
2. Hive snap on {{community}} — public-facing version, framed as "if you're reading this and haven't posted in a while…", posted via {{account}}.
3. Farcaster cast in /{{farcaster}} — same as snap.
4. Discord message template that moderators can send 1:1.
5. Twitter thread — broad reach, not personalized; mostly to remind everyone the door is open.
   Links use {{frontend}} as the base URL.

## What's changed since you were last here
- [[new feature or update they'll care about]]
- [[new community initiative — ...]]
- [[new content or event — ...]]

## Success metric
Lapsed members who post at least once in the window (primary). North-star: 30-day post-return retention — did they post a second time?

## Risks
- Coming across as needy or guilt-trippy → keep tone warm and brief; no "we miss you sooo much."
- Reaching out to accounts that left for a reason → respect any prior unsubscribes; suppress unverified addresses.
- Over-incentivizing → any acknowledgement is a thank-you, not a bribe; don't promise rewards we can't deliver.

## Next steps
- [ ] Pull the win-back list from Hive activity logs (last_post_at between 30 and 90 days ago, filter spam).
- [ ] Confirm any incentive budget with [[approver]] before sending.
- [ ] Once brief is filled, click "Generate everything from brief" to draft snap, cast, tweets, Discord, and email.
`,
  },
];

// ---------------------------------------------------------------------------
// Per-slug overrides — SkateHive keeps its original skate-flavored templates
// ---------------------------------------------------------------------------

export const TEMPLATES_BY_SLUG: Record<string, CampaignTemplate[]> = {
  skatehive: [
    {
      id: "weekly-stoken",
      name: "Weekly Stoken — [[week of YYYY-MM-DD]]",
      label: "Weekly Stoken",
      tagline: "SkateHive content newsletter — recap the week's standout clips, posts, and skaters.",
      briefSeed: `# Weekly Stoken — [[week of YYYY-MM-DD]]

A weekly recap of the standout clips, posts, and skaters on SkateHive this past week. Sent every Monday to the Skatehive newsletter list, posted as a long-form blog to hive-173115, and snapped/cast in summary form.

## Goal
Surface 5-8 standout clips/posts so newer skaters discover the best of what shipped this week, and the featured creators get a second wave of engagement and tips. Target: 200+ visits to featured posts within 48h of send.

## Audience
Active SkateHive readers and casual viewers who skim Hive and Farcaster but don't open every post. They want curation — "the 6 things worth your time this week."

## The offer
A curated list of the week's best clips/posts on SkateHive, each with a 1-2 sentence write-up explaining why it's worth a watch and a direct link. Plus one "Skater of the Week" spotlight with a short Q&A or bio.

## Featured clips this week
- [[clip 1 — author, permlink, 1 line on why it stands out]]
- [[clip 2 — ...]]
- [[clip 3 — ...]]
- [[clip 4 — ...]]
- [[clip 5 — ...]]

## Skater of the Week
[[Hive username]] — [[1-2 sentence intro: who they are, what kind of skating they post]].

## Window
Published [[date]]. Snap + Farcaster cast same day; email send same day at 5pm ET; Twitter thread + Discord announcement following morning.

## Channels
1. Hive long-form blog post (this brief, expanded) on hive-173115 — primary.
2. Hive snap linking to the blog with a 1-line teaser.
3. Farcaster cast in /skateboard mirroring the snap.
4. Twitter thread highlighting 3-4 of the clips.
5. Discord announcement with the full list.
6. Email newsletter — visual recap with thumbnails.

## Success metric
Click-throughs to featured posts (primary). North-star: returning weekly readers ("regulars who open every Stoken").

## Risks
- Featuring the same skaters too often → rotate weekly, track recent features.
- Light weeks → don't pad with weak picks; cut to 3 if that's the honest read.
- Late publishing → assign owner Friday EOD so weekend buffer exists.

## Next steps
- [ ] Pick 5-8 clips and write 1-2 sentence blurbs each.
- [ ] Choose Skater of the Week + draft 2-question Q&A.
- [ ] Once brief is filled, click "Generate everything from brief" to draft snap, cast, tweets, Discord, and email.
`,
    },
    {
      id: "updates-roundup",
      name: "Updates Round-Up — [[YYYY-MM-DD]]",
      label: "Updates Round-Up",
      tagline: "Product / dev shipping recap — what landed in the SkateHive app this sprint.",
      briefSeed: `# Updates Round-Up — [[YYYY-MM-DD]]

A shipping recap for the SkateHive app (web + iOS). Goes out every 2-3 weeks when there's enough material. The goal is to keep skaters in the loop on what's actually changing in the product they use.

## Goal
Show progress on the SkateHive app: features shipped, bugs squashed, what's next. Target: 100+ skaters interacting with at least one new feature within a week of send.

## Audience
Active app users — the people who post clips, upvote, and tip. They notice when things change and want context for why. Tone is dev-to-skater, not corporate.

## The offer
A clear, scannable list of what changed in the app since the last round-up, with screenshots/clips where useful and a "what's next" preview.

## Shipped this round
- [[feature 1 — 1-2 sentence description + who it helps]]
- [[feature 2 — ...]]
- [[bug fix or polish — ...]]
- [[infra / performance — ...]]

## Coming next
- [[next feature in flight — rough timing]]
- [[next feature in flight — ...]]

## Window
Publish [[date]]. Hive blog goes up morning of; snap + cast follow within an hour; Twitter thread + Discord drop same day.

## Channels
1. Hive long-form blog post on hive-173115 — primary, with detail + screenshots.
2. Hive snap linking to the blog with the headline ship.
3. Farcaster cast in /skateboard mirroring the snap.
4. Twitter thread breaking out the 3 most visible changes.
5. Discord #announcements with the full list + links to specific PRs/commits when relevant.
6. (Optional) Email if the round-up has a flagship feature worth one-to-one outreach.

## Success metric
Visits to changelog / app following the post (primary). North-star: % of weekly actives who try at least one new feature within 7 days.

## Risks
- Quiet sprint → don't ship a round-up for the sake of it; combine with the next one.
- Overpromising "coming next" items that slip → only list items that are in active development with a real PR/branch.
- Jargon → write for skaters, not for other devs.

## Next steps
- [ ] Pull the merged PRs / shipped features since the last round-up.
- [ ] Pick the 3 most user-visible to highlight; the rest go in a list at the bottom.
- [ ] Once brief is filled, click "Generate everything from brief" to draft snap, cast, tweets, Discord, and email.
`,
    },
    {
      id: "we-miss-you",
      name: "We Miss You — [[YYYY-MM-DD]]",
      label: "We Miss You",
      tagline: "Win-back campaign for skaters who haven't posted in a while.",
      briefSeed: `# We Miss You — [[YYYY-MM-DD]]

A win-back push for skaters who posted on SkateHive at some point and have been quiet for 90+ days. We want them to know we noticed, show them what changed, and give them one low-friction way back.

## Goal
Bring lapsed skaters back to post at least one clip. Target: 15% of the win-back audience publishes a new post within 14 days of contact.

## Audience
The "Sumiram" segment in the outreach panel: subscribers with a Hive account who posted at least once and have had no post or comment for 90+ days (measured live from Hive when you click "Preparar público"). People who never posted and handles with no Hive account are DIFFERENT segments with different messages — don't send them this one.

## The offer
A short, honest note: we noticed, here's what changed, here's the door. Light incentive: feature in the next Weekly Stoken if they post in the window, plus a small welcome-back tip from @skatehive on their return post.

## Window
[[start date]] to [[end date]] — keep it short (2 weeks) so the urgency is real. Hive snap + Farcaster cast on day 1, email batches from day 3 (max 20 per 24h — the cap is enforced by the portal), gentle public follow-up on day 10.

## Channels
1. Email — primary channel. FIXED bilingual template (Portuguese first, English below — we don't know each reader's language), built by the portal, not by the AI. Per-recipient tokens filled at send time: {{first_name}}, {{last_post_date}} / {{last_post_date_pt}}, {{last_post_link}} (their own last post, linked). Edit copy in the block editor if you must; the "What's changed" list below is what feeds it.
2. Hive snap on hive-173115 — public-facing version, framed as "if you're reading this and haven't posted in a while…"
3. Farcaster cast in /skateboard — same as snap.
4. Discord DM template that mods can send 1:1.
5. Twitter thread — broad reach, not personalized; mostly to remind everyone the door is open.

## What's changed since you were last here
Fill by hand — these bullets go into the email VERBATIM. Write each one as "texto em português / the same in English". Keep them concrete (a feature, a tool, a community thing), 2-3 max.
- [[novidade 1 em português]] / [[the same in English]]
- [[novidade 2 em português]] / [[the same in English]]

## Success metric
Lapsed skaters who post at least once in the window (primary — the panel tracks it as "Responderam"). North-star: 30-day post-return retention — did they post a second time?

## Risks
- Coming across needy or guilt-trippy → keep tone warm, brief, no "we miss you sooo much."
- Spam placement → Gmail SMTP + a dormant list is the worst case. Never raise the daily cap (20 per 24h); start with batches of 10 and watch bounces before using the full 20.
- Over-incentivizing → the tip is a thank-you not a bribe. Don't promise rewards we can't deliver.

## Next steps
- [ ] Fill the "What's changed" bullets above (bilingual), then click "Generate everything from brief" — it refreshes the email's list and drafts snap, cast, tweets, Discord.
- [ ] Send yourself a test from the outreach panel and read both halves on a phone.
- [ ] Confirm tip budget with @xvlad before the first batch.
- [ ] "Preparar público" with the "Sumiram" segment, then send small batches daily.
`,
    },
  ],
};

// ---------------------------------------------------------------------------
// Project-aware public API
// ---------------------------------------------------------------------------

/**
 * Return the list of campaign templates for the given project.
 * SkateHive gets its original skate-flavored set verbatim (no tokens to
 * substitute). Every other tenant gets the generic defaults with project
 * tokens substituted in.
 */
export function getCampaignTemplates(project: ProjectConfig): CampaignTemplate[] {
  const raw = TEMPLATES_BY_SLUG[project.slug] ?? DEFAULT_CAMPAIGN_TEMPLATES;
  return raw.map((t) => substitute(t, project));
}

/**
 * Look up a single template by id for the given project.
 */
export function getCampaignTemplate(id: string, project: ProjectConfig): CampaignTemplate | null {
  return getCampaignTemplates(project).find((t) => t.id === id) ?? null;
}

/**
 * Detect which template (if any) a saved campaign was created from, by
 * matching the campaign name against the template's display label. Used
 * by the AI generation actions to switch on template-specific prompt rules.
 */
export function detectTemplate(campaignName: string, project: ProjectConfig): CampaignTemplate | null {
  const lower = campaignName.trim().toLowerCase();
  for (const template of getCampaignTemplates(project)) {
    if (lower.startsWith(template.label.toLowerCase())) return template;
  }
  return null;
}
