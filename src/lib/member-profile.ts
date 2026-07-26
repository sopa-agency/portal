// Public-profile fields a member fills in about themselves, consumed by the
// static SOPA site (site-sopa) through /api/sopa/site-data. Shared between
// server actions and the client card — no "server-only" here on purpose.

/** Editorial grouping of the people directory. Mirrors TERRITORY_KEYS on the site. */
export const TERRITORIES = [
  "design / motion",
  "dev / web3",
  "vídeo",
  "estratégia / produto",
  "social / conteúdo",
  "comunidade",
] as const;

export type Territory = (typeof TERRITORIES)[number];

export type MemberProfile = {
  /** how the person presents themselves — ["dev", "web3", "criativo"] */
  roles: string[];
  territory: string | null;
  location: string | null;
  languages: string | null;
  since: number | null;
};

export const EMPTY_PROFILE: MemberProfile = {
  roles: [],
  territory: null,
  location: null,
  languages: null,
  since: null,
};

const MAX_ROLES = 6;
const MAX_ROLE_LEN = 24;

/** Free text ("dev · web3, criativo") → clean token list. */
export function parseRoles(input: string): string[] {
  return [
    ...new Set(
      input
        .split(/[·,]/)
        .map((r) => r.trim().toLowerCase())
        .filter(Boolean)
        .map((r) => r.slice(0, MAX_ROLE_LEN)),
    ),
  ].slice(0, MAX_ROLES);
}

/** The inverse, for the input's initial value. */
export function formatRoles(roles: string[]): string {
  return roles.join(" · ");
}

/** Trim + bound everything before it touches the DB. */
export function sanitizeProfile(input: Partial<MemberProfile>): MemberProfile {
  const text = (v: unknown, max: number): string | null => {
    const s = typeof v === "string" ? v.trim().slice(0, max) : "";
    return s || null;
  };
  const year = Number(input.since);
  const thisYear = new Date().getFullYear();

  return {
    roles: Array.isArray(input.roles)
      ? parseRoles(input.roles.filter((r): r is string => typeof r === "string").join(" · "))
      : [],
    // Unknown territories are dropped rather than stored — the site's filter
    // is built from this exact list.
    territory: TERRITORIES.includes(text(input.territory, 40) as Territory)
      ? (text(input.territory, 40) as Territory)
      : null,
    location: text(input.location, 60),
    languages: text(input.languages, 60),
    since: Number.isInteger(year) && year >= 1990 && year <= thisYear ? year : null,
  };
}
