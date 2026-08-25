/**
 * Where the brand portals actually live.
 *
 * The switcher must build `<brand>.sopa.team` from THIS, never from whatever
 * host it happens to be running on. Deriving from the current host used to
 * work by stripping the leftmost label when it matched a project slug — but
 * `portal` is a real host label that is NOT a brand slug, so from
 * portal.sopa.team nothing got stripped and the target was appended instead of
 * swapped: `<brand>.portal.sopa.team`. Three levels, which no certificate
 * covers, because a wildcard matches exactly one label. It only broke once you
 * were already inside the portal, which is why it survived so long.
 */
export const PORTAL_ROOT_DOMAIN = process.env.NEXT_PUBLIC_PORTAL_ROOT_DOMAIN?.trim() || "sopa.team";

type Loc = { protocol: string; hostname: string; port: string };

/**
 * Absolute URL of a brand portal.
 *
 * On the real domain the root is FIXED, so the result cannot grow a third
 * level no matter which host you start from — that is the whole point, and the
 * reason this does not "fix" the broken URL by teaching the infra to serve it.
 *
 * Everywhere else (localhost, Tailscale nip.io, *.vercel.app previews) there is
 * no such root, so it falls back to swapping the leftmost label — the old
 * behaviour those environments have always relied on.
 */
export function portalUrlFor(targetLabel: string, loc: Loc, knownLabels: readonly string[]): string {
  const { protocol, hostname, port } = loc;
  const suffix = port ? `:${port}` : "";
  const bare = hostname.toLowerCase();

  if (bare === PORTAL_ROOT_DOMAIN || bare.endsWith(`.${PORTAL_ROOT_DOMAIN}`)) {
    return `${protocol}//${targetLabel}.${PORTAL_ROOT_DOMAIN}${suffix}/`;
  }

  const labels = hostname.split(".");
  const base = knownLabels.includes(labels[0]) ? labels.slice(1) : labels;
  return `${protocol}//${[targetLabel, ...base].join(".")}${suffix}/`;
}
