// Plain (non-"use server") module: types + constants shared between the snap
// curation server action and its client UI. Kept out of the action file because
// a "use server" module may only export async functions.

export type CurationSnap = {
  id: string; // "author/permlink"
  author: string;
  permlink: string;
  title: string;
  votes: number;
  payout: number;
  /** Link to the snap's post page (peakd). */
  url: string;
  /** IPFS video URL — used as the card's visual reference (first frame). */
  thumbnail: string;
  created: string;
  /** Boost pacing state, if this snap is/was boosted. */
  boost: { budget: number; released: number; status: string } | null;
  /** True if the portal's Hive account has already replied to this post. */
  replied?: boolean;
  /** Link to that existing reply, when known. */
  replyUrl?: string | null;
};

export type BoostLevel = "light" | "medium" | "strong";
export type BoostKind = "snap" | "blog";
type BoostLevelDef = { value: BoostLevel; label: string; voters: number; hint: string };

// Snaps (quick clips) get a modest push.
export const BOOST_LEVELS: BoostLevelDef[] = [
  { value: "light", label: "Leve", voters: 10, hint: "~10 contas" },
  { value: "medium", label: "Médio", voters: 25, hint: "~25 contas" },
  { value: "strong", label: "Forte", voters: 50, hint: "~50 contas" },
];

// Blog / magazine posts (full articles) get a bigger push — the strong tier
// goes up to 200 accounts for a mag post.
export const BLOG_BOOST_LEVELS: BoostLevelDef[] = [
  { value: "light", label: "Leve", voters: 25, hint: "~25 contas" },
  { value: "medium", label: "Médio", voters: 75, hint: "~75 contas" },
  { value: "strong", label: "Forte", voters: 200, hint: "até 200 contas" },
];

export function boostLevelsFor(kind: BoostKind): BoostLevelDef[] {
  return kind === "blog" ? BLOG_BOOST_LEVELS : BOOST_LEVELS;
}
