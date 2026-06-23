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
  url: string;
  created: string;
  /** Boost pacing state, if this snap is/was boosted. */
  boost: { budget: number; released: number; status: string } | null;
};

export type BoostLevel = "light" | "medium" | "strong";

export const BOOST_LEVELS: { value: BoostLevel; label: string; voters: number; hint: string }[] = [
  { value: "light", label: "Leve", voters: 10, hint: "~10 contas" },
  { value: "medium", label: "Médio", voters: 25, hint: "~25 contas" },
  { value: "strong", label: "Forte", voters: 50, hint: "~50 contas" },
];
