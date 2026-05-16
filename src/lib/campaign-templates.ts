// Pre-built campaign templates. Each template seeds a new campaign's Brief
// with a Hive-blog-shaped skeleton: structured headings, placeholders, and
// enough context that the AI's "Generate everything from brief" produces
// useful artifacts in one pass.
//
// `[[double-brackets]]` mark placeholders for the user to fill in before
// generating artifacts. The campaign worker treats them as literal text — the
// AI is free to either keep, replace, or interpret them.

export type CampaignTemplate = {
  id: string;
  name: string; // becomes the campaign name on create
  label: string; // short display label for the picker
  tagline: string; // one-line description shown under the label
  briefSeed: string; // markdown body written into the Brief document
};

export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
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

A re-engagement push for skaters who posted on SkateHive at some point but have been quiet for 30+ days. We want them to know we noticed they're gone and give them an easy reason to come back.

## Goal
Bring lapsed skaters back to post at least one clip. Target: 15% of the win-back audience publishes a new post within 14 days of contact.

## Audience
Skaters whose last Hive post on hive-173115 was 30-90 days ago. Filter out spam accounts and one-time posters who never engaged. We're talking to people who used SkateHive seriously then drifted.

## The offer
A short, honest "we noticed, here's what's changed, here's a low-friction way back" message. Light incentive: feature in next Weekly Stoken if they post in the window, plus a small $HIVE/HBD welcome-back tip from @skatehive on their return post.

## Window
[[start date]] to [[end date]] — keep the window short (2 weeks) so the urgency is real. Send Hive snap + Farcaster cast on day 1, email + Discord DM on day 3, gentle follow-up on day 10 for non-responders.

## Channels
1. Email — primary channel, personalized with first_name + last post date. The conversation, not a broadcast.
2. Hive snap on hive-173115 — public-facing version, framed as "if you're reading this and haven't posted in a while…"
3. Farcaster cast in /skateboard — same as snap.
4. Discord DM template that mods can send 1:1.
5. Twitter thread — broad reach, not personalized; mostly to remind everyone the door is open.

## What's changed since you were last here
- [[new feature 1 they'll care about]]
- [[new feature 2 — ...]]
- [[new community thing — ...]]

## Success metric
Lapsed skaters who post at least once in the window (primary). North-star: 30-day post-return retention — did they post a second time?

## Risks
- Coming across needy or guilt-trippy → keep tone warm, brief, no "we miss you sooo much."
- Spamming inactive accounts that left for a reason → respect any prior unsubscribe; suppress unverified addresses.
- Over-incentivizing → the tip is a thank-you not a bribe. Don't promise rewards we can't deliver.

## Next steps
- [ ] Pull the win-back list from Hive activity logs (last_post_at between 30 and 90 days ago, filter spam).
- [ ] Confirm tip budget with @xvlad before sending.
- [ ] Once brief is filled, click "Generate everything from brief" to draft snap, cast, tweets, Discord, and email.
`,
  },
];

export function getCampaignTemplate(id: string): CampaignTemplate | null {
  return CAMPAIGN_TEMPLATES.find((t) => t.id === id) ?? null;
}
