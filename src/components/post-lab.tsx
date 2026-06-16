"use client";

import { useMemo, useRef, useState } from "react";
import { ImagePlus, Loader2, X, Calendar, Send, FlaskConical } from "lucide-react";
import { signLabMediaUpload } from "@/app/actions/lab";

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

export function PostLab({ brand }: { brand: LabBrand }) {
  const [mode, setMode] = useState<Mode>("single");
  const [baseText, setBaseText] = useState("");
  const [media, setMedia] = useState<Media[]>([]);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({ instagram: true, hive: true, farcaster: true });
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string>("base"); // "base" | network id
  const [scheduleWhen, setScheduleWhen] = useState("");
  const [uploading, setUploading] = useState(false);
  const [plan, setPlan] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  function buildPlan() {
    const when = scheduleWhen ? new Date(scheduleWhen).toLocaleString() : "agora";
    const lines = activeNetworks.map((n) => {
      const t = effectiveText(n.id).trim();
      const over = overrides[n.id] !== undefined ? " (texto próprio)" : "";
      return `• ${n.label}${over}: ${t.slice(0, 60)}${t.length > 60 ? "…" : ""}`;
    });
    const kind = mode === "single" ? "Single post (cross-post)" : "Campanha (conjunto coordenado)";
    setPlan(
      `${kind}\nQuando: ${when}\nMídia: ${media.length} arquivo(s)\nRedes:\n${lines.join("\n")}\n\n` +
        `(protótipo — o disparo real pluga nas actions existentes: ${
          mode === "single" ? "createDraft/scheduleDraft + publish por rede" : "createCampaign + generate/publish artifacts"
        })`,
    );
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
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
        {/* LEFT — composer */}
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-2xl border border-border bg-surface p-4">
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
          </div>

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
              onClick={buildPlan}
              disabled={activeNetworks.length === 0 || !baseText.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
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
              {activeNetworks.map((n) => (
                <ChannelPreview key={n.id} network={n} text={effectiveText(n.id)} media={media} brand={brand} />
              ))}
            </div>
          )}
        </div>
      </div>
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
