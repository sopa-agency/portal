// Derives a "top creators" leaderboard from the same Hive trending feed that
// powers fetchTopSkatehivePosts. No additional API calls — the Marketing
// Suggestions agent gets a ready-made list of authors to highlight.

import { fetchTopSkatehivePosts, type SkatehivePost } from "@/lib/skatehive-content";

export type TopCreator = {
  author: string;
  postsCount: number;
  totalVotes: number;
  totalPayoutHbd: number;
  topPost: {
    title: string;
    url: string;
    netVotes: number;
    payoutHbd: number;
  };
};

export type FetchTopCreatorsOptions = {
  daysBack?: number;
  limit?: number; // how many creators to return (default 10)
  /** Passed through to fetchTopSkatehivePosts — see FetchOptions. */
  communityTag?: string;
  /** Passed through to fetchTopSkatehivePosts — see FetchOptions. */
  frontendUrl?: string;
};

export async function fetchTopSkatehiveCreators(
  opts: FetchTopCreatorsOptions = {},
): Promise<TopCreator[]> {
  const limit = opts.limit ?? 10;

  // Pull a wide window so even creators whose single post fell mid-pack
  // still surface if they had multiple entries.
  const posts = await fetchTopSkatehivePosts({
    daysBack: opts.daysBack ?? 8,
    limit: 20,
    communityTag: opts.communityTag,
    frontendUrl: opts.frontendUrl,
  });

  const byAuthor = new Map<string, { posts: SkatehivePost[] }>();
  for (const post of posts) {
    const entry = byAuthor.get(post.author) ?? { posts: [] };
    entry.posts.push(post);
    byAuthor.set(post.author, entry);
  }

  const creators: TopCreator[] = [];
  for (const [author, { posts: authorPosts }] of byAuthor) {
    const totalVotes = authorPosts.reduce((s, p) => s + p.netVotes, 0);
    const totalPayoutHbd = authorPosts.reduce((s, p) => s + p.payoutHbd, 0);
    const topPost = authorPosts.reduce((best, p) =>
      p.netVotes > best.netVotes ? p : best,
    );
    creators.push({
      author,
      postsCount: authorPosts.length,
      totalVotes,
      totalPayoutHbd,
      topPost: {
        title: topPost.title,
        url: topPost.url,
        netVotes: topPost.netVotes,
        payoutHbd: topPost.payoutHbd,
      },
    });
  }

  creators.sort(
    (a, b) =>
      b.totalVotes - a.totalVotes ||
      b.totalPayoutHbd - a.totalPayoutHbd ||
      b.postsCount - a.postsCount,
  );
  return creators.slice(0, limit);
}

export function formatCreatorsForPrompt(creators: TopCreator[]): string {
  if (creators.length === 0) {
    return "(no qualifying creators surfaced this week — skip the creator-spotlight angle.)";
  }
  return creators
    .map(
      (c, i) =>
        `${i + 1}. @${c.author} — ${c.postsCount} post${c.postsCount === 1 ? "" : "s"} · ${c.totalVotes} total votes · ${c.totalPayoutHbd.toFixed(2)} HBD\n` +
        `   Top post: "${c.topPost.title}" (${c.topPost.netVotes} votes) — ${c.topPost.url}`,
    )
    .join("\n");
}
