// Shared type + hand-rolled validator for the SkateHive media-magazine homepage
// config. The portal composes this (draft → preview → publish); skatehive3.0's
// /home route renders entirely from the PUBLISHED doc (it re-declares a mirror
// of HomepageConfigDoc — two repos, no shared package, same as the magazine).
//
// Stored here = copy, order, chosen images, and REFS. Never stored = anything
// money/status-shaped (rewards total, live bounty amounts, user points) — sk3
// hydrates those live so the page can't ship a stale dollar figure.

export type PostRef = { author: string; permlink: string };

export type CtaTarget =
  | { kind: "post"; author: string; permlink: string }
  | { kind: "spot"; id: string }
  | { kind: "url"; url: string };

export type HeroSlide = {
  id: string; // client-generated, reorder key
  image: string; // chosen image URL (post media or Pinata upload)
  tag: string; // outlined pill, e.g. "VIDEO PART"
  title: string;
  subtitle: string;
  meta: string; // free text, e.g. "Uploaded 5h ago · 239 votes"
  cta: CtaTarget | null; // play-button target
  postRef?: PostRef; // source post (byline / re-hydration)
};

export type StripCard = { id: string; postRef: PostRef; image: string; title: string };
export type JunkItem = { id: string; postRef: PostRef; thumb: string; title: string; blurb: string };
export type FeaturedVideo = { postRef: PostRef; cover: string; title: string; caption: string };

export type SpotPick = {
  id: string;
  name: string;
  image: string;
  author: string | null;
  permlink: string | null;
  coords: string | null; // "lat,lng" — for the distance badge (client-side)
};

// poidh bounties: store the identity + a display fallback (name/issuer). The
// live USD amount is hydrated on sk3 from /api/poidh/bounties (amount is ETH
// wei) × /api/prices. Hive-sourced bounties carry their own fields.
export type BountyRef =
  | { source: "poidh"; id: string; chainId: number; name: string; issuer: string; image?: string }
  | { source: "hive"; author: string; permlink: string; title: string; sponsor: string };

// Kept for forward-compat; not rendered/edited in v1 (no home for it in the
// prototype yet — decided to ship without a users section).
export type FeaturedUser = { username: string };

export type HomepageConfigDoc = {
  heroSlides: HeroSlide[]; // ≥ 1 to publish
  strip: StripCard[]; // exactly 4 to publish
  junkDrawer: JunkItem[]; // 1–6
  featuredVideo: FeaturedVideo | null;
  spot: SpotPick | null; // null → sk3 falls back to live /api/spotmap/featured
  bounties: BountyRef[]; // rows in the rewards card (order = display)
  featuredUsers: FeaturedUser[]; // v1: stored but not rendered
  banner: { headline: string; subtext: string; ctaLabel: string };
  footer: { tagline: string };
};

export function emptyHomepageDoc(): HomepageConfigDoc {
  return {
    heroSlides: [],
    strip: [],
    junkDrawer: [],
    featuredVideo: null,
    spot: null,
    bounties: [],
    featuredUsers: [],
    banner: {
      headline: "This is the magazine. The community is where it happens.",
      subtext: "Post your clips, vote on lines, chat with the crew, and earn rewards — live, chronological, unfiltered.",
      ctaLabel: "ENTER COMMUNITY",
    },
    footer: { tagline: "SKATEHIVE MAGAZINE — BY SKATERS, FOR SKATERS" },
  };
}

// ── Sanitize + validate before persisting (Prisma Json) ─────────────────────
// Strips unknown keys, clamps string lengths, drops malformed rows. Never
// throws — returns a safe doc. Publish-readiness is a separate check.

const clamp = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const str = (v: unknown, max = 500): string => clamp(v, max);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const isHttp = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//.test(v);

function cta(v: unknown): CtaTarget | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.kind === "post" && typeof o.author === "string" && typeof o.permlink === "string")
    return { kind: "post", author: str(o.author, 32), permlink: str(o.permlink, 300) };
  if (o.kind === "spot" && typeof o.id === "string") return { kind: "spot", id: str(o.id, 128) };
  if (o.kind === "url" && isHttp(o.url)) return { kind: "url", url: str(o.url, 1000) };
  return null;
}

function postRef(v: unknown): PostRef | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.author !== "string" || typeof o.permlink !== "string") return undefined;
  return { author: str(o.author, 32), permlink: str(o.permlink, 300) };
}

/** Coerce arbitrary input (AI/UI/DB) into a safe HomepageConfigDoc. */
export function sanitizeHomepageDoc(input: unknown): HomepageConfigDoc {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const base = emptyHomepageDoc();

  const heroSlides: HeroSlide[] = arr(o.heroSlides)
    .map((s): HeroSlide | null => {
      const r = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
      if (!isHttp(r.image)) return null;
      return {
        id: str(r.id, 64) || cryptoId(),
        image: str(r.image, 1000),
        tag: str(r.tag, 80),
        title: str(r.title, 200),
        subtitle: str(r.subtitle, 400),
        meta: str(r.meta, 200),
        cta: cta(r.cta),
        postRef: postRef(r.postRef),
      };
    })
    .filter((x): x is HeroSlide => x !== null)
    .slice(0, 12);

  const strip: StripCard[] = arr(o.strip)
    .map((c): StripCard | null => {
      const r = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
      const ref = postRef(r.postRef);
      if (!ref || !isHttp(r.image)) return null;
      return { id: str(r.id, 64) || cryptoId(), postRef: ref, image: str(r.image, 1000), title: str(r.title, 200) };
    })
    .filter((x): x is StripCard => x !== null)
    .slice(0, 4);

  const junkDrawer: JunkItem[] = arr(o.junkDrawer)
    .map((j): JunkItem | null => {
      const r = (j && typeof j === "object" ? j : {}) as Record<string, unknown>;
      const ref = postRef(r.postRef);
      if (!ref || !isHttp(r.thumb)) return null;
      return { id: str(r.id, 64) || cryptoId(), postRef: ref, thumb: str(r.thumb, 1000), title: str(r.title, 200), blurb: str(r.blurb, 400) };
    })
    .filter((x): x is JunkItem => x !== null)
    .slice(0, 6);

  let featuredVideo: FeaturedVideo | null = null;
  if (o.featuredVideo && typeof o.featuredVideo === "object") {
    const r = o.featuredVideo as Record<string, unknown>;
    const ref = postRef(r.postRef);
    if (ref && isHttp(r.cover)) featuredVideo = { postRef: ref, cover: str(r.cover, 1000), title: str(r.title, 200), caption: str(r.caption, 400) };
  }

  let spot: SpotPick | null = null;
  if (o.spot && typeof o.spot === "object") {
    const r = o.spot as Record<string, unknown>;
    if (isHttp(r.image))
      spot = {
        id: str(r.id, 128),
        name: str(r.name, 200),
        image: str(r.image, 1000),
        author: typeof r.author === "string" ? str(r.author, 32) : null,
        permlink: typeof r.permlink === "string" ? str(r.permlink, 300) : null,
        coords: typeof r.coords === "string" ? str(r.coords, 64) : null,
      };
  }

  const bounties: BountyRef[] = arr(o.bounties)
    .map((b): BountyRef | null => {
      const r = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
      if (r.source === "hive" && typeof r.author === "string" && typeof r.permlink === "string")
        return { source: "hive", author: str(r.author, 32), permlink: str(r.permlink, 300), title: str(r.title, 200), sponsor: str(r.sponsor, 120) };
      if (r.source === "poidh" && typeof r.id === "string")
        return {
          source: "poidh",
          id: str(r.id, 64),
          chainId: typeof r.chainId === "number" ? r.chainId : 8453,
          name: str(r.name, 200),
          issuer: str(r.issuer, 64),
          image: isHttp(r.image) ? str(r.image, 1000) : undefined,
        };
      return null;
    })
    .filter((x): x is BountyRef => x !== null)
    .slice(0, 8);

  const featuredUsers: FeaturedUser[] = arr(o.featuredUsers)
    .map((u): FeaturedUser | null => {
      const r = (u && typeof u === "object" ? u : {}) as Record<string, unknown>;
      return typeof r.username === "string" ? { username: str(r.username, 32) } : null;
    })
    .filter((x): x is FeaturedUser => x !== null)
    .slice(0, 12);

  const banner = (o.banner && typeof o.banner === "object" ? o.banner : {}) as Record<string, unknown>;
  const footer = (o.footer && typeof o.footer === "object" ? o.footer : {}) as Record<string, unknown>;

  return {
    heroSlides,
    strip,
    junkDrawer,
    featuredVideo,
    spot,
    bounties,
    featuredUsers,
    banner: {
      headline: str(banner.headline, 240) || base.banner.headline,
      subtext: str(banner.subtext, 400) || base.banner.subtext,
      ctaLabel: str(banner.ctaLabel, 60) || base.banner.ctaLabel,
    },
    footer: { tagline: str(footer.tagline, 200) || base.footer.tagline },
  };
}

/** Publish-readiness: the design requires a hero, exactly 4 strip cards, and
 *  banner copy. Returns the list of problems ([] = ready). */
export function homepagePublishErrors(doc: HomepageConfigDoc): string[] {
  const errs: string[] = [];
  if (doc.heroSlides.length < 1) errs.push("Adicione ao menos 1 slide no hero.");
  if (doc.strip.length !== 4) errs.push("A faixa em destaque precisa de exatamente 4 cards.");
  if (!doc.banner.headline.trim()) errs.push("O banner precisa de um título.");
  return errs;
}

let _idSeq = 0;
function cryptoId(): string {
  // Fallback id when the UI didn't supply one (it normally sends a uuid).
  // Not security-sensitive — just a stable reorder key within a save.
  _idSeq = (_idSeq + 1) % Number.MAX_SAFE_INTEGER;
  return `id-${Date.now().toString(36)}-${_idSeq}`;
}
