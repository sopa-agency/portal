import { Flame, MessageCircleMore, MessageSquare, Send } from "lucide-react";
import { MarkdownContent } from "@/components/markdown-content";
import { ageFromDate } from "@/lib/utils";

export type CampaignDocumentKind =
  | "brief"
  | "hive"
  | "hive_mag"
  | "farcaster"
  | "tweets"
  | "discord"
  | "email"
  | "markdown"
  | "doc";

export function classifyCampaignDocument(name: string, isMain: boolean): CampaignDocumentKind {
  if (isMain) return "brief";
  const lower = name.toLowerCase();
  // The Portuguese translation rides in the mag post's json_metadata — it's a
  // plain doc, not separately publishable.
  if (lower.includes("mag post") && lower.includes("(pt)")) return "doc";
  if (lower.includes("mag post") || lower.includes("magazine")) return "hive_mag";
  if (lower.includes("hive") || lower.includes("snap")) return "hive";
  if (lower.includes("farcaster") || lower.includes("cast") || lower.includes("warpcast")) return "farcaster";
  if (lower.includes("tweet") || lower.includes("twitter") || lower.includes("x thread")) return "tweets";
  if (lower.includes("discord")) return "discord";
  if (lower.includes("email")) return "email";
  if (lower.includes("markdown") || lower.includes("blog") || lower.includes("post")) return "markdown";
  return "doc";
}

/** Per-project branding passed into previews. */
export type CampaignPreviewBrand = {
  avatarUrl: string;
  displayName: string;
  /** Handle WITHOUT leading @, e.g. "skatehive" */
  handle: string;
  hiveAccount: string;
  hiveCommunity: string;
};

type PreviewKind = Exclude<CampaignDocumentKind, "brief" | "email" | "markdown">;

export function CampaignDocumentPreview({
  name,
  content,
  updatedAt,
  kind,
  headerExtra,
  brand,
  bare = false,
}: {
  name: string;
  content: string;
  updatedAt: Date;
  kind: PreviewKind;
  headerExtra?: React.ReactNode;
  brand?: CampaignPreviewBrand;
  /** Render only the channel preview body — no card chrome. The parent panel
   *  supplies the surrounding card so preview + actions read as one unit. */
  bare?: boolean;
}) {
  const meta = META[kind];
  const Icon = meta.icon;

  const previewBody = (
    <>
      {kind === "hive" ? <HiveSnapPreview content={content} brand={brand} /> : null}
      {kind === "farcaster" ? <FarcasterCastPreview content={content} brand={brand} /> : null}
      {kind === "tweets" ? <TweetsPreview content={content} brand={brand} /> : null}
      {kind === "discord" ? <DiscordPreview content={content} brand={brand} /> : null}
      {kind === "hive_mag" ? <MarkdownContent markdown={content} /> : null}
      {kind === "doc" ? <MarkdownContent markdown={content} /> : null}
    </>
  );

  if (bare) return previewBody;

  return (
    <section className="rounded-2xl border border-border bg-surface/70">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${meta.tone}`}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{name}</p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-foreground-subtle">
              {meta.label} · Updated {ageFromDate(updatedAt)}
            </p>
          </div>
        </div>
        {headerExtra}
      </header>
      <div className="p-5">{previewBody}</div>
    </section>
  );
}

// Per-kind header label/icon, reused by the unified document panel.
export function previewKindMeta(kind: PreviewKind) {
  return META[kind];
}

const META: Record<PreviewKind, { label: string; tone: string; icon: typeof MessageSquare }> = {
  hive:      { label: "Hive snap",            tone: "bg-red-500/15 text-red-300",       icon: Flame },
  hive_mag:  { label: "Hive blog (mag post)", tone: "bg-red-500/15 text-red-300",       icon: Flame },
  farcaster: { label: "Farcaster cast",       tone: "bg-purple-500/15 text-purple-300", icon: Send },
  tweets:    { label: "Twitter / X thread",   tone: "bg-foreground/10 text-foreground", icon: MessageCircleMore },
  discord:   { label: "Discord announcement", tone: "bg-indigo-500/15 text-indigo-300", icon: MessageSquare },
  doc:       { label: "Document",             tone: "bg-foreground/10 text-foreground-muted", icon: MessageCircleMore },
};

// ---------------------------------------------------------------------------
// Token highlighter shared by all chat-style previews.
// ---------------------------------------------------------------------------

type SocialTokenKind = "text" | "mention" | "hashtag" | "url" | "newline";
type SocialToken = { kind: SocialTokenKind; value: string };

function tokenizeSocial(text: string): SocialToken[] {
  const out: SocialToken[] = [];
  const lines = text.split("\n");
  lines.forEach((line, lineIdx) => {
    if (lineIdx > 0) out.push({ kind: "newline", value: "\n" });
    const re = /(https?:\/\/\S+|@[A-Za-z0-9_]+|#[A-Za-z0-9_]+)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) out.push({ kind: "text", value: line.slice(last, m.index) });
      const v = m[0];
      out.push({
        kind: v.startsWith("http") ? "url" : v.startsWith("@") ? "mention" : "hashtag",
        value: v,
      });
      last = m.index + v.length;
    }
    if (last < line.length) out.push({ kind: "text", value: line.slice(last) });
  });
  return out;
}

function HighlightedText({ tokens, linkClassName }: { tokens: SocialToken[]; linkClassName: string }) {
  return (
    <>
      {tokens.map((t, i) => {
        if (t.kind === "newline") return <br key={i} />;
        if (t.kind === "text") return <span key={i}>{t.value}</span>;
        return (
          <span key={i} className={linkClassName}>
            {t.value}
          </span>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Hive snap preview — mirrors SkateHive web app's snap card
// ---------------------------------------------------------------------------

function HiveSnapPreview({ content, brand }: { content: string; brand?: CampaignPreviewBrand }) {
  const body = content.trim();
  if (!body) {
    return <p className="text-sm text-foreground-subtle">No snap yet.</p>;
  }
  const tokens = tokenizeSocial(body);
  const overLimit = body.length > 280;

  const displayName = brand?.displayName ?? "skatehive";
  const handle = brand?.handle ?? "skatehive";
  const avatarUrl = brand?.avatarUrl ?? "/skatehive-logo-circle.svg";
  const hiveAccount = brand?.hiveAccount ?? "peak.snaps";
  const hiveCommunity = brand?.hiveCommunity ?? "hive-173115";

  return (
    <div className="rounded-2xl border border-red-500/30 bg-black px-4 py-3 text-zinc-100">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-zinc-500">
        <span>Hive snap · {hiveAccount} · {hiveCommunity}</span>
        <span className={overLimit ? "text-rose-400" : "text-zinc-500"}>{body.length} chars</span>
      </div>
      <div className="mt-2 flex gap-3">
        <div className="shrink-0">
          <div className="h-10 w-10 overflow-hidden rounded-full bg-black ring-1 ring-red-500/30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-[15px] leading-5">
            <span className="font-bold text-white">{displayName}</span>
            <span className="text-red-400">●</span>
            <span className="text-zinc-500">@{handle}</span>
            <span className="text-zinc-500">·</span>
            <span className="text-zinc-500">now</span>
          </div>
          <div className="mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-5 text-zinc-100">
            <HighlightedText tokens={tokens} linkClassName="text-red-400" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Farcaster cast preview — purple-on-dark, /skateboard channel
// ---------------------------------------------------------------------------

function FarcasterCastPreview({ content, brand }: { content: string; brand?: CampaignPreviewBrand }) {
  const body = content.trim();
  if (!body) {
    return <p className="text-sm text-foreground-subtle">No cast yet.</p>;
  }
  const tokens = tokenizeSocial(body);
  const overLimit = body.length > 320;

  const displayName = brand?.displayName ?? "skatehive";
  const handle = brand?.handle ?? "skatehive";
  const avatarUrl = brand?.avatarUrl ?? "/skatehive-logo-circle.svg";

  return (
    <div className="rounded-2xl border border-purple-500/30 bg-black px-4 py-3 text-zinc-100">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-zinc-500">
        <span>Farcaster cast · /skateboard</span>
        <span className={overLimit ? "text-rose-400" : "text-zinc-500"}>{body.length}/320</span>
      </div>
      <div className="mt-2 flex gap-3">
        <div className="shrink-0">
          <div className="h-10 w-10 overflow-hidden rounded-full bg-black ring-1 ring-purple-500/40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-[15px] leading-5">
            <span className="font-bold text-white">{displayName}</span>
            <span className="text-purple-400">◆</span>
            <span className="text-zinc-500">@{handle}</span>
            <span className="text-zinc-500">·</span>
            <span className="text-zinc-500">/skateboard</span>
          </div>
          <div className="mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-5 text-zinc-100">
            <HighlightedText tokens={tokens} linkClassName="text-purple-300" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tweets — X-style multi-tweet thread, split on "\n---\n"
// ---------------------------------------------------------------------------

function TweetsPreview({ content, brand }: { content: string; brand?: CampaignPreviewBrand }) {
  const tweets = content
    .split(/\n-{3,}\n/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (tweets.length === 0) {
    return <p className="text-sm text-foreground-subtle">No tweets yet.</p>;
  }

  return (
    <div className="space-y-3">
      {tweets.map((tweet, idx) => (
        <TweetCard key={idx} tweet={tweet} index={idx} total={tweets.length} brand={brand} />
      ))}
    </div>
  );
}

function TweetCard({ tweet, index, total, brand }: { tweet: string; index: number; total: number; brand?: CampaignPreviewBrand }) {
  const tokens = tokenizeSocial(tweet);
  const overLimit = tweet.length > 280;

  const displayName = brand?.displayName ?? "skatehive";
  const handle = brand?.handle ?? "skatehive";
  const avatarUrl = brand?.avatarUrl ?? "/skatehive-logo-circle.svg";

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-black px-4 py-3 text-zinc-100">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-zinc-600">
        <span>
          Tweet {index + 1} / {total}
        </span>
        <span className={overLimit ? "text-rose-400" : "text-zinc-600"}>{tweet.length}/280</span>
      </div>
      <div className="mt-2 flex gap-3">
        <div className="shrink-0">
          <div className="h-10 w-10 overflow-hidden rounded-full bg-black ring-1 ring-white/[0.08]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-[15px] leading-5">
            <span className="font-bold text-white">{displayName}</span>
            <svg viewBox="0 0 22 22" aria-label="Verified account" className="h-[18px] w-[18px] fill-[#1d9bf0]">
              <g>
                <path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" />
              </g>
            </svg>
            <span className="text-zinc-500">@{handle}</span>
            <span className="text-zinc-500">·</span>
            <span className="text-zinc-500">now</span>
          </div>
          <div className="mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-5 text-zinc-100">
            <HighlightedText tokens={tokens} linkClassName="text-[#1d9bf0]" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Discord — dark grey channel mockup
// ---------------------------------------------------------------------------

function DiscordPreview({ content, brand }: { content: string; brand?: CampaignPreviewBrand }) {
  const displayName = brand?.displayName ?? "skatehive";
  const avatarUrl = brand?.avatarUrl ?? "/skatehive-logo-circle.svg";

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#313338] p-4">
      <div className="flex gap-3">
        <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-black ring-1 ring-white/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-white">{displayName}</span>
            <span className="rounded bg-indigo-500/30 px-1 py-px text-[9px] font-bold uppercase tracking-wider text-indigo-200">
              App
            </span>
            <span className="text-[10px] text-zinc-400">Today at 12:00 PM</span>
          </div>
          <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#dcddde]">{content}</div>
        </div>
      </div>
    </div>
  );
}
