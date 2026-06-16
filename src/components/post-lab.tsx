"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { ImagePlus, Loader2, X, Calendar, Send, FlaskConical, Clapperboard, Sparkles, Wand2, GitBranch } from "lucide-react";
import {
  signLabMediaUpload,
  labImproveText,
  labGenerateText,
  labGenerateVariants,
  labGeneratePostFromInsight,
  labAnalyzeRepo,
  labPublishNow,
  labSchedulePost,
  type LabInsight,
} from "@/app/actions/lab";
import { Lightbulb } from "lucide-react";
import { type PostType, type CalendarExtra, createDraft, scheduleDraft } from "@/app/actions/post-creator";
import { ScheduleCalendar } from "@/components/schedule-calendar";
import { IgPreview } from "@/components/post/ig-preview";
import { ReelCoverPicker } from "@/components/post/reel-cover-picker";
import { aspectToClass, snapToFeedRatio, type UploadState } from "@/lib/post-aspect";

// The real Studio editors (image + video), reused as-is — same ones the Post
// Creator uses. They hand finished media back via onUseInPost.
const StudioEditor = dynamic(() => import("@/components/studio/editor").then((m) => m.Editor), {
  ssr: false,
  loading: () => <div className="p-8 text-center text-sm text-foreground-muted">Carregando Studio…</div>,
});
const StudioVideoEditor = dynamic(
  () => import("@/components/studio/video-editor").then((m) => m.VideoEditor),
  { ssr: false, loading: () => <div className="p-8 text-center text-sm text-foreground-muted">Carregando Studio…</div> },
);

// ---------------------------------------------------------------------------
// Lab — experimental unified composer. Compose ONE base message, fan it out to
// any set of networks (with optional per-network overrides), preview each
// channel accurately side by side, and decide single-post vs campaign in one
// place. Publish/schedule wiring to the existing actions is the next iteration;
// for now the action bar produces a precise plan summary (clearly a prototype).
// This route is isolated — it does not touch Post Creator / Campaign Creator.
// ---------------------------------------------------------------------------

export type LabBrand = {
  projectName: string;
  accent: string;
  logo: string;
  instagramHandle: string;
  hiveAccount: string;
  hiveFrontend: string;
  farcasterChannel: string;
};

type Mode = "single" | "campaign";
type ImageRule = "media" | "markdown" | "bare" | "attach" | "none";

type Network = {
  id: string;
  label: string;
  color: string; // brand color — reads on both themes
  limit: number; // 0 = no hard limit
  image: ImageRule;
  needsMedia?: boolean;
  campaignOnly?: boolean;
  note: string; // how images/format behave on this channel
};

const NETWORKS: Network[] = [
  { id: "instagram", label: "Instagram", color: "#E1306C", limit: 2200, image: "media", needsMedia: true, note: "Mídia é o post; legenda acompanha." },
  { id: "hive", label: "Hive", color: "#E31337", limit: 0, image: "markdown", note: "Imagem inline em markdown ![](url)." },
  { id: "farcaster", label: "Farcaster", color: "#8A63D2", limit: 320, image: "bare", note: "URL nua auto-embeda (máx 2)." },
  { id: "x", label: "X", color: "#1d9bf0", limit: 280, image: "attach", note: "Thread separada por linha '---'; imagem anexada na mão." },
  { id: "discord", label: "Discord", color: "#5865F2", limit: 0, image: "bare", note: "**bold** + URL nua auto-embeda." },
  { id: "binance", label: "Binance Square", color: "#F0B90B", limit: 0, image: "none", note: "Só texto — sem URL/markdown." },
  { id: "hive_mag", label: "Hive Magazine", color: "#E31337", limit: 0, image: "markdown", campaignOnly: true, note: "Post longo em markdown na comunidade." },
  { id: "email", label: "Email / Newsletter", color: "#0ea5e9", limit: 0, image: "none", campaignOnly: true, note: "Corpo do email; o builder visual entra na próxima fatia." },
];

type Media = { url: string; isVideo: boolean };

async function uploadLabMedia(
  file: File,
): Promise<{ ok: true; media: Media } | { ok: false; error: string }> {
  try {
    const signed = await signLabMediaUpload(file.name, file.size, file.type);
    if (!signed.ok) return signed;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("network", "public");
    const res = await fetch(signed.url, { method: "POST", body: fd });
    if (!res.ok) return { ok: false, error: `Pinata HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as { data?: { cid?: string } } | null;
    const cid = json?.data?.cid;
    if (!cid) return { ok: false, error: "Pinata returned no CID" };
    return {
      ok: true,
      media: {
        url: `${signed.gateway}/${cid}?filename=${encodeURIComponent(file.name)}`,
        isVideo: file.type.startsWith("video/"),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Fold the composer's media into a channel's text per its image rule, so what
// actually publishes matches the preview: Hive renders inline markdown, Farcaster
// and Discord auto-embed a bare URL. Instagram carries media via createDraft;
// X intent, Binance and email take text only.
function appendMedia(n: Network, text: string, media: Media[]): string {
  if (!media.length) return text;
  if (n.image === "markdown") {
    const parts = media.map((m) => (m.isVideo ? m.url : `![](${m.url})`));
    return `${text}\n\n${parts.join("\n")}`;
  }
  if (n.image === "bare") {
    const limit = n.id === "farcaster" ? 2 : media.length; // Farcaster embeds ≤2
    return `${text}\n\n${media.slice(0, limit).map((m) => m.url).join("\n")}`;
  }
  return text;
}

export function PostLab({
  brand,
  calendarEvents,
  activeSlug,
  insights,
  hasRepo,
}: {
  brand: LabBrand;
  calendarEvents: CalendarExtra[];
  activeSlug: string;
  insights: LabInsight[];
  hasRepo: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<"compose" | "calendar">("compose");
  const [mode, setMode] = useState<Mode>("single");
  const [submitting, setSubmitting] = useState(false);
  const [baseText, setBaseText] = useState("");
  const [media, setMedia] = useState<Media[]>([]);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({ instagram: true, hive: true, farcaster: true });
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string>("base"); // "base" | network id
  const [scheduleWhen, setScheduleWhen] = useState("");
  const [uploading, setUploading] = useState(false);
  const [plan, setPlan] = useState<string | null>(null);
  const [studio, setStudio] = useState<null | "image" | "video">(null);
  const [igFit, setIgFit] = useState<"cover" | "contain">("cover");
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [thumbOffsetMs, setThumbOffsetMs] = useState<number | null>(null);
  const [aiBusy, setAiBusy] = useState<null | "improve" | "generate" | "variants" | "insight" | "repo">(null);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [openInsight, setOpenInsight] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const postType: PostType =
    media.length > 1 ? "CAROUSEL" : media.some((m) => m.isVideo) ? "REELS" : "IMAGE";

  async function aiImprove() {
    if (!editingText.trim()) return;
    setAiErr(null);
    setAiBusy("improve");
    const r = await labImproveText(editingText, postType);
    setAiBusy(null);
    if (r.ok) setEditingText(r.text);
    else setAiErr(r.error);
  }
  async function aiAnalyzeRepo() {
    setAiErr(null);
    setAiBusy("repo");
    const r = await labAnalyzeRepo(postType);
    setAiBusy(null);
    if (r.ok) {
      setBaseText(r.text);
      setEditing("base");
    } else setAiErr(r.error);
  }
  async function aiGenerate() {
    const topic = editingText.trim() || baseText.trim();
    if (!topic) return;
    setAiErr(null);
    setAiBusy("generate");
    const r = await labGenerateText(topic, postType);
    setAiBusy(null);
    if (r.ok) setEditingText(r.text);
    else setAiErr(r.error);
  }
  async function aiFromInsight(body: string) {
    setAiErr(null);
    setAiBusy("insight");
    const r = await labGeneratePostFromInsight(body, postType);
    setAiBusy(null);
    if (r.ok) {
      setBaseText(r.text);
      setEditing("base");
      setView("compose");
    } else setAiErr(r.error);
  }
  async function aiVariants() {
    setAiErr(null);
    setAiBusy("variants");
    const nets = activeNetworks.map((n) => ({
      id: n.id,
      label: n.label,
      rule: `${n.limit ? `máx ${n.limit} chars` : "sem limite"}; ${n.note}`,
    }));
    const r = await labGenerateVariants(baseText, nets);
    setAiBusy(null);
    if (r.ok) setOverrides((prev) => ({ ...prev, ...r.variants }));
    else setAiErr(r.error);
  }

  // Studio handoff — the real editor returns File[]; upload them into the lab.
  async function handleStudioUseInPost(files: File[], caption: string) {
    setUploading(true);
    for (const f of files) {
      const r = await uploadLabMedia(f);
      if (r.ok) setMedia((prev) => [...prev, r.media]);
    }
    setUploading(false);
    if (caption.trim() && !baseText.trim()) setBaseText(caption.trim());
    setStudio(null);
  }

  // Map lab media → the IgPreview's UploadState shape.
  const igUploads: UploadState[] = media.map((m) => ({
    url: m.url,
    previewUrl: m.url,
    isVideo: m.isVideo,
  }));
  const igAspectClass = aspectToClass(
    media.some((m) => m.isVideo) ? "9:16" : snapToFeedRatio(1),
  );

  const availableNetworks = useMemo(
    () => NETWORKS.filter((n) => mode === "campaign" || !n.campaignOnly),
    [mode],
  );
  const activeNetworks = availableNetworks.filter((n) => enabled[n.id]);
  const effectiveText = (id: string) => overrides[id] ?? baseText;

  function toggleNetwork(id: string) {
    setEnabled((p) => ({ ...p, [id]: !p[id] }));
  }

  function setEditingText(value: string) {
    if (editing === "base") setBaseText(value);
    else setOverrides((p) => ({ ...p, [editing]: value }));
  }

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setUploading(true);
    for (const f of files) {
      const r = await uploadLabMedia(f);
      if (r.ok) setMedia((prev) => [...prev, r.media]);
    }
    setUploading(false);
  }

  async function submit() {
    setSubmitting(true);
    setPlan(null);
    const when = scheduleWhen ? new Date(scheduleWhen).toLocaleString() : "agora";

    // REAL: Instagram lane → create (and schedule) an InstagramPost draft, which
    // then shows up in the Calendário tab. Other networks stay a planned summary
    // (their real wiring is the next slice).
    let igLine = "";
    if (enabled.instagram) {
      if (media.length === 0) {
        igLine = "• Instagram: precisa de mídia — pulado";
      } else {
        const r = await createDraft({
          type: postType,
          caption: effectiveText("instagram"),
          mediaUrls: media.map((m) => m.url),
          aspectRatio: media.some((m) => m.isVideo) ? "9:16" : "1:1",
          coverUrl: postType === "REELS" ? coverUrl : null,
          thumbOffsetMs: postType === "REELS" ? thumbOffsetMs : null,
        });
        if (!r.ok) igLine = `• Instagram: erro — ${r.error}`;
        else if (scheduleWhen) {
          const s = await scheduleDraft(r.id, new Date(scheduleWhen).toISOString());
          igLine = s.ok ? `• Instagram: ✓ agendado (${when})` : `• Instagram: rascunho criado, mas agendar falhou — ${s.error}`;
        } else {
          igLine = "• Instagram: ✓ rascunho criado (publique pelo Post Creator ou agende com data)";
        }
      }
    }

    // Other networks: schedule (labSchedulePost) or publish NOW via the real
    // primitives — X is intent-only. Media is folded into the text per channel
    // (appendMedia) so what publishes matches the preview.
    const others: string[] = [];
    for (const n of activeNetworks.filter((nn) => nn.id !== "instagram")) {
      const t = effectiveText(n.id).trim();
      if (!t) {
        others.push(`• ${n.label}: sem texto — pulado`);
        continue;
      }
      if (n.id === "x") {
        if (scheduleWhen) {
          others.push("• X: agendar não é suportado (sem API de publish) — abra o intent na hora");
        } else {
          window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(t)}`, "_blank");
          others.push("• X: intent aberto numa aba — publique lá");
        }
        continue;
      }
      const body = appendMedia(n, t, media);
      if (scheduleWhen) {
        const sr = await labSchedulePost(n.id, body, new Date(scheduleWhen).toISOString());
        others.push(sr.ok ? `• ${n.label}: ✓ agendado (${when})` : `• ${n.label}: erro ao agendar — ${sr.error}`);
        continue;
      }
      const pr = await labPublishNow(n.id, body);
      others.push(pr.ok ? `• ${n.label}: ✓ publicado${pr.url ? ` — ${pr.url}` : ""}` : `• ${n.label}: erro — ${pr.error}`);
    }

    const kind = mode === "single" ? "Single post (cross-post)" : "Campanha (conjunto coordenado)";
    setPlan(
      [
        `${kind} · Quando: ${when}`,
        igLine,
        ...others,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    setSubmitting(false);
    router.refresh(); // refresh the unified calendar with the new scheduled post
  }

  const editingText = editing === "base" ? baseText : overrides[editing] ?? "";

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col gap-4 md:h-[calc(100dvh-4rem)]">
      {/* Header + mode toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-accent" />
          <div>
            <h1 className="text-xl font-bold text-foreground">Lab — Composer unificado</h1>
            <p className="text-[11px] text-foreground-faint">
              Compõe uma vez · preview de todas as redes · decide single ou campanha — experimental
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-border p-0.5">
            {(["compose", "calendar"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  view === v ? "bg-accent-bg text-accent" : "text-foreground-muted hover:text-foreground"
                }`}
              >
                {v === "compose" ? "Compor" : "Calendário"}
              </button>
            ))}
          </div>
          {view === "compose" && (
            <div className="flex items-center rounded-lg border border-border p-0.5">
              {(["single", "campaign"] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    mode === m ? "bg-accent-bg text-accent" : "text-foreground-muted hover:text-foreground"
                  }`}
                >
                  {m === "single" ? "Single post" : "Campanha"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {view === "calendar" ? (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border bg-surface p-4">
          {calendarEvents.length === 0 ? (
            <p className="py-12 text-center text-sm text-foreground-faint">
              Nada agendado ainda. Agende um post na aba Compor.
            </p>
          ) : (
            <ScheduleCalendar events={calendarEvents} activeSlug={activeSlug} />
          )}
        </div>
      ) : (
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
        {/* LEFT — composer */}
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-2xl border border-border bg-surface p-4">
          {/* AI Insights → post */}
          {insights.length > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
                <Lightbulb className="h-3.5 w-3.5 text-accent" /> Criar a partir de AI insights
              </p>
              <div className="space-y-1.5">
                {insights.map((ins) => {
                  const open = openInsight === ins.key;
                  return (
                    <div key={ins.key} className="rounded-lg border border-border bg-surface-elevated">
                      <button
                        type="button"
                        onClick={() => setOpenInsight(open ? null : ins.key)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                      >
                        <span className="truncate text-xs font-medium text-foreground">{ins.label}</span>
                        <span className="shrink-0 text-[10px] text-foreground-faint">
                          {new Date(ins.generatedAt).toLocaleDateString()}
                        </span>
                      </button>
                      {open && (
                        <div className="border-t border-border px-3 py-2">
                          <p className="mb-2 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-foreground-muted">
                            {ins.body}
                          </p>
                          <button
                            type="button"
                            onClick={() => void aiFromInsight(ins.body)}
                            disabled={!!aiBusy}
                            className="inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-bg px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
                          >
                            {aiBusy === "insight" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                            Gerar post deste insight
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Networks */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
              Redes
            </p>
            <div className="flex flex-wrap gap-2">
              {availableNetworks.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => toggleNetwork(n.id)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    enabled[n.id]
                      ? "text-white"
                      : "border-border bg-surface-elevated text-foreground-muted hover:border-border-strong"
                  }`}
                  style={enabled[n.id] ? { backgroundColor: n.color, borderColor: n.color } : undefined}
                >
                  {n.label}
                </button>
              ))}
            </div>
          </div>

          {/* Which text am I editing */}
          {activeNetworks.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
                Editando
              </p>
              <div className="flex flex-wrap gap-1.5">
                <EditTab label="Base (todas)" active={editing === "base"} onClick={() => setEditing("base")} />
                {activeNetworks.map((n) => (
                  <EditTab
                    key={n.id}
                    label={n.label}
                    dot={overrides[n.id] !== undefined}
                    active={editing === n.id}
                    onClick={() => setEditing(n.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Text */}
          <div className="flex flex-col gap-1.5">
            {/* Agentic toolbar — the real project agent (same prompts as the Post Creator). */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void aiGenerate()}
                disabled={!!aiBusy}
                className="inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-bg px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
              >
                {aiBusy === "generate" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Gerar com IA
              </button>
              <button
                type="button"
                onClick={() => void aiImprove()}
                disabled={!!aiBusy || !editingText.trim()}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground-muted hover:border-border-strong hover:text-foreground disabled:opacity-50"
              >
                {aiBusy === "improve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                Improve with AI
              </button>
              {hasRepo && (
                <button
                  type="button"
                  onClick={() => void aiAnalyzeRepo()}
                  disabled={!!aiBusy}
                  title="Lê os commits recentes do repo e escreve um post do que saiu"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground-muted hover:border-border-strong hover:text-foreground disabled:opacity-50"
                >
                  {aiBusy === "repo" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitBranch className="h-3.5 w-3.5" />}
                  Analisar repo
                </button>
              )}
            </div>
            <textarea
              value={editingText}
              onChange={(e) => setEditingText(e.target.value)}
              rows={7}
              placeholder={
                editing === "base"
                  ? "Escreva a mensagem base — vai pra todas as redes…"
                  : `Texto só para ${NETWORKS.find((n) => n.id === editing)?.label}…`
              }
              className="w-full resize-none rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none"
            />
            {editing !== "base" && overrides[editing] !== undefined && (
              <button
                type="button"
                onClick={() =>
                  setOverrides((p) => {
                    const next = { ...p };
                    delete next[editing];
                    return next;
                  })
                }
                className="w-fit text-[11px] text-foreground-muted hover:text-danger"
              >
                Voltar pro texto base
              </button>
            )}
            {/* Campaign-style: tailor the base message per channel in one go. */}
            {activeNetworks.length > 1 && (
              <button
                type="button"
                onClick={() => void aiVariants()}
                disabled={!!aiBusy || !baseText.trim()}
                className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-md border border-accent-border bg-accent-bg px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
              >
                {aiBusy === "variants" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {mode === "campaign" ? "Gerar campanha (variações por rede)" : "Gerar variações por rede"}
              </button>
            )}
            {aiErr && <p className="text-[11px] text-danger">{aiErr}</p>}
          </div>

          {/* Media */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
              Mídia
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {media.map((m, i) => (
                <div key={m.url} className="relative h-16 w-16 overflow-hidden rounded-lg border border-border bg-surface-elevated">
                  {m.isVideo ? (
                    <video src={m.url} className="h-full w-full object-cover" muted />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.url} alt="" className="h-full w-full object-cover" />
                  )}
                  <button
                    type="button"
                    onClick={() => setMedia((prev) => prev.filter((_, idx) => idx !== i))}
                    className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"
                    aria-label="Remover"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <input ref={fileRef} type="file" accept="image/*,video/*" multiple onChange={onPickFiles} className="hidden" />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-border text-foreground-faint hover:border-accent-border hover:text-accent disabled:opacity-50"
              >
                {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
              </button>
            </div>
            {/* Real Studio editors (image + video) — same as the Post Creator. */}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setStudio("image")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs font-medium text-foreground-muted hover:border-border-strong hover:text-foreground"
              >
                <Clapperboard className="h-3.5 w-3.5" /> Studio (imagem/figma)
              </button>
              <button
                type="button"
                onClick={() => setStudio("video")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs font-medium text-foreground-muted hover:border-border-strong hover:text-foreground"
              >
                <Clapperboard className="h-3.5 w-3.5" /> Studio (vídeo)
              </button>
            </div>
          </div>

          {/* Reel cover/thumbnail picker — same component as the Post Creator,
              shown when there's a video (the Reel cover applies to Instagram). */}
          {media.some((m) => m.isVideo) && (
            <ReelCoverPicker
              videoUrl={media.find((m) => m.isVideo)!.url}
              coverUrl={coverUrl}
              thumbOffsetMs={thumbOffsetMs}
              onCoverUrl={setCoverUrl}
              onThumbOffset={setThumbOffsetMs}
              uploadImage={async (file) => {
                const r = await uploadLabMedia(file);
                return r.ok ? { ok: true, url: r.media.url } : r;
              }}
            />
          )}

          {/* Schedule + action */}
          <div className="mt-auto border-t border-border pt-4">
            <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
              <Calendar className="h-3.5 w-3.5" /> Agendar
            </label>
            <input
              type="datetime-local"
              value={scheduleWhen}
              onChange={(e) => setScheduleWhen(e.target.value)}
              className="mb-3 w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting || activeNetworks.length === 0 || !baseText.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {scheduleWhen ? "Agendar" : "Publicar"} {mode === "single" ? "post" : "campanha"}
            </button>
            {plan && (
              <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-accent-border bg-accent-bg p-3 text-[11px] leading-relaxed text-foreground">
                {plan}
              </pre>
            )}
          </div>
        </div>

        {/* RIGHT — live previews */}
        <div className="min-h-0 overflow-y-auto rounded-2xl border border-border bg-surface-elevated/40 p-4">
          {activeNetworks.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-foreground-faint">
              Selecione ao menos uma rede para ver o preview.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {activeNetworks.map((n) =>
                n.id === "instagram" ? (
                  <div key={n.id} className="flex flex-col items-center gap-2">
                    <span className="flex items-center gap-1.5 self-start text-xs font-bold" style={{ color: n.color }}>
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: n.color }} />
                      Instagram
                    </span>
                    <IgPreview
                      handle={brand.instagramHandle}
                      caption={effectiveText(n.id)}
                      uploads={igUploads}
                      type={igUploads.length > 1 ? "CAROUSEL" : igUploads.some((u) => u.isVideo) ? "REELS" : "IMAGE"}
                      aspectClass={igAspectClass}
                      collaborators={[]}
                      userTags={[]}
                      taggingActive={false}
                      onTagClick={() => {}}
                      onRemoveTag={() => {}}
                      fit={igFit}
                      onToggleFit={() => setIgFit((f) => (f === "cover" ? "contain" : "cover"))}
                    />
                  </div>
                ) : (
                  <ChannelPreview key={n.id} network={n} text={effectiveText(n.id)} media={media} brand={brand} />
                ),
              )}
            </div>
          )}
        </div>
      </div>
      )}

      {/* Studio overlay — the real image/video editor */}
      {studio && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <span className="text-sm font-semibold text-foreground">
              Studio — {studio === "image" ? "imagem / figma" : "vídeo"}
            </span>
            <button
              type="button"
              onClick={() => setStudio(null)}
              className="rounded-md p-1.5 text-foreground-muted hover:text-foreground"
              aria-label="Fechar Studio"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {studio === "image" ? (
              <StudioEditor onUseInPost={handleStudioUseInPost} />
            ) : (
              <StudioVideoEditor onUseInPost={handleStudioUseInPost} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EditTab({
  label,
  active,
  dot,
  onClick,
}: {
  label: string;
  active: boolean;
  dot?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition ${
        active
          ? "border-accent-border bg-accent-bg text-accent"
          : "border-border text-foreground-muted hover:border-border-strong"
      }`}
    >
      {label}
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
    </button>
  );
}

function ChannelPreview({
  network,
  text,
  media,
  brand,
}: {
  network: Network;
  text: string;
  media: Media[];
  brand: LabBrand;
}) {
  const len = text.length;
  const over = network.limit > 0 && len > network.limit;
  const firstImage = media.find((m) => !m.isVideo);
  const handle =
    network.id === "instagram"
      ? brand.instagramHandle
      : network.id === "hive" || network.id === "hive_mag"
        ? `@${brand.hiveAccount}`
        : network.id === "farcaster"
          ? `/${brand.farcasterChannel}`
          : `@${brand.hiveAccount}`;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex items-center justify-between px-3 py-2" style={{ backgroundColor: `${network.color}1a` }}>
        <span className="flex items-center gap-2 text-xs font-bold" style={{ color: network.color }}>
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: network.color }} />
          {network.label}
        </span>
        <span className="text-[10px] text-foreground-faint">{handle}</span>
      </div>

      <div className="space-y-2 p-3">
        {/* media */}
        {(network.image === "media" || firstImage) && media.length > 0 && network.image !== "none" && (
          <div className="overflow-hidden rounded-lg border border-border">
            {media[0].isVideo ? (
              <video src={media[0].url} className="max-h-56 w-full object-cover" muted />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={media[0].url} alt="" className="max-h-56 w-full object-cover" />
            )}
          </div>
        )}

        {/* text */}
        {text.trim() ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{text}</p>
        ) : (
          <p className="text-sm italic text-foreground-faint">Sem texto ainda…</p>
        )}

        {/* footer: char count + image rule */}
        <div className="flex items-center justify-between border-t border-border pt-2 text-[10px]">
          <span className="text-foreground-faint">{network.note}</span>
          {network.limit > 0 && (
            <span className={over ? "font-semibold text-danger" : "text-foreground-faint"}>
              {len}/{network.limit}
            </span>
          )}
        </div>
        {network.needsMedia && media.length === 0 && (
          <p className="text-[10px] text-warning">{network.label} exige mídia.</p>
        )}
      </div>
    </div>
  );
}
