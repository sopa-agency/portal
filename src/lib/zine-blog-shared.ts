// Plain shared module for the Zine blog importer — NOT "use server".
// A "use server" file may only export async functions; exporting a const value
// (ZINE_BLOG_AUTHORS) from one made the client receive a server-action proxy
// instead of the array → "D.map is not a function". Keep these here so both the
// server action and the client component import a real value/type.

export type ZineBlogImage = { url: string; title: string };

/** Hive authors selectable in the Zine blog image filter. */
export const ZINE_BLOG_AUTHORS = ["xvlad", "nogenta", "web-gnar", "gnars", "coletivoxv", "reelflip"] as const;
