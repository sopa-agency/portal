"use client";

// TikTok review queue: upload a video → someone on the team approves it →
// it goes on the calendar → the scheduler publishes it.
//
// Two TikTok rules shape this UI:
//  - The publish screen must reflect the creator's CURRENT settings, so the
//    privacy options and the duet/stitch/comment toggles come from
//    creator_info at render time instead of being hardcoded.
//  - Until TikTok audits the app, every post is forced to private. The banner
//    says so rather than letting someone schedule a "public" post that isn't.

import { useRef, useState, useTransition } from "react";
import {
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
  Send,
} from "lucide-react";
import {
  approveTikTokPost,
  createTikTokUploadUrl,
  deleteTikTokPost,
  publishTikTokNow,
  refreshTikTokStatus,
  saveTikTokDraft,
  scheduleTikTokPost,
  type TikTokAccountInfo,
  type TikTokRow,
} from "@/app/actions/tiktok";
import type { TikTokPrivacy } from "@/lib/tiktok";

const CAPTION_MAX = 2200;

const PRIVACY_LABELS: Record<TikTokPrivacy, string> = {
  PUBLIC_TO_EVERYONE: "Público",
  MUTUAL_FOLLOW_FRIENDS: "Amigos",
  FOLLOWER_OF_CREATOR: "Seguidores",
  SELF_ONLY: "Só eu (privado)",
};

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function statusBadge(status: TikTokRow["status"]): string {
  const map: Record<TikTokRow["status"], string> = {
    draft: "bg-accent-bg text-accent border-accent-border",
    scheduled: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    publishing: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400",
    published: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    failed: "border-danger/40 bg-danger/10 text-danger",
  };
  return map[status];
}

async function uploadVideo(file: File): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const signed = await createTikTokUploadUrl(file.name, file.size, file.type);
    if (!signed.ok) return signed;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("network", "public");
    const res = await fetch(signed.url, { method: "POST", body: fd });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Pinata upload HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    const json = (await res.json().catch(() => null)) as { data?: { cid?: string } } | null;
    const cid = json?.data?.cid;
    if (!cid) return { ok: false, error: "Pinata returned no CID" };
    return { ok: true, url: `${signed.gateway}/${cid}?filename=${encodeURIComponent(file.name)}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function TikTokQueue({
  rows: initialRows,
  loadError,
  account,
  credsConfigured,
  envPrefix,
  justConnected,
  connectError,
}: {
  rows: TikTokRow[];
  loadError: string | null;
  account: TikTokAccountInfo;
  credsConfigured: boolean;
  envPrefix: string;
  justConnected: boolean;
  connectError: string | null;
}) {
  const [rows, setRows] = useState(initialRows);
  const [banner, setBanner] = useState<string | null>(connectError);
  const [ok, setOk] = useState<string | null>(justConnected ? "TikTok conectado." : null);

  const privacyOptions =
    account.creator?.privacy_level_options?.length
      ? account.creator.privacy_level_options
      : (["SELF_ONLY"] as TikTokPrivacy[]);

  function upsert(row: TikTokRow) {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === row.id);
      if (idx === -1) return [row, ...prev];
      const next = [...prev];
      next[idx] = row;
      return next;
    });
  }

  return (
    <div className="space-y-6">
      {/* ── Connection ─────────────────────────────────────────────────── */}
      <ConnectionCard
        account={account}
        credsConfigured={credsConfigured}
        envPrefix={envPrefix}
      />

      {banner && (
        <p className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {banner}
        </p>
      )}
      {ok && (
        <p className="flex items-start gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          {ok}
        </p>
      )}
      {loadError && (
        <p className="rounded-xl border border-border bg-surface px-4 py-6 text-sm text-foreground-muted">
          {loadError}
        </p>
      )}

      <Composer
        privacyOptions={privacyOptions}
        creator={account.creator}
        onSaved={(row) => {
          upsert(row);
          setOk("Rascunho salvo.");
          setBanner(null);
        }}
        onError={(e) => {
          setBanner(e);
          setOk(null);
        }}
      />

      {/* ── Queue ──────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          Fila <span className="text-foreground-subtle">({rows.length})</span>
        </h2>
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-surface px-4 py-8 text-center text-sm text-foreground-muted">
            Nada na fila ainda. Suba um vídeo acima pra começar.
          </p>
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => (
              <QueueItem
                key={row.id}
                row={row}
                privacyOptions={privacyOptions}
                onChanged={upsert}
                onRemoved={(id) => setRows((prev) => prev.filter((r) => r.id !== id))}
                onError={(e) => {
                  setBanner(e);
                  setOk(null);
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connection card
// ---------------------------------------------------------------------------

function ConnectionCard({
  account,
  credsConfigured,
  envPrefix,
}: {
  account: TikTokAccountInfo;
  credsConfigured: boolean;
  envPrefix: string;
}) {
  if (!credsConfigured) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 text-sm">
        <p className="font-medium text-foreground">TikTok ainda não configurado</p>
        <p className="mt-1 text-foreground-muted">
          Falta o app na TikTok. Defina{" "}
          <code className="rounded bg-surface-elevated px-1 py-0.5 text-xs">
            {envPrefix}_TIKTOK_CLIENT_KEY
          </code>{" "}
          e{" "}
          <code className="rounded bg-surface-elevated px-1 py-0.5 text-xs">
            {envPrefix}_TIKTOK_CLIENT_SECRET
          </code>
          . O passo a passo está em <code className="text-xs">docs/tiktok-setup.md</code>.
        </p>
      </div>
    );
  }

  if (!account.connected) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4">
        <div className="text-sm">
          <p className="font-medium text-foreground">Conta não conectada</p>
          <p className="mt-1 text-foreground-muted">
            Autorize a conta da marca no TikTok pra liberar a publicação.
          </p>
        </div>
        <a
          href="/api/tiktok/auth"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
        >
          Conectar TikTok
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4 text-sm">
        <div>
          <p className="font-medium text-foreground">
            Conectado{account.username ? ` — @${account.username}` : ""}
          </p>
          {account.creator && (
            <p className="mt-1 text-foreground-subtle">
              Vídeo até {Math.floor(account.creator.max_video_post_duration_sec / 60)}min
              {account.creator.max_video_post_duration_sec % 60
                ? ` ${account.creator.max_video_post_duration_sec % 60}s`
                : ""}
            </p>
          )}
        </div>
        <a
          href="/api/tiktok/auth"
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
        >
          Reconectar
        </a>
      </div>

      {account.creatorError && (
        <p className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          Não consegui ler as configurações da conta: {account.creatorError}
        </p>
      )}

      {!account.audited && (
        <p className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          O app ainda não passou pela auditoria da TikTok — <strong>tudo publica como
          privado</strong>, mesmo marcando outra opção. Serve pra testar o fluxo ponta a
          ponta; pra publicar de verdade, é preciso enviar o app pra auditoria e depois
          marcar a conta como auditada.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

type CreatorInfoLike = TikTokAccountInfo["creator"];

function Composer({
  privacyOptions,
  creator,
  onSaved,
  onError,
}: {
  privacyOptions: TikTokPrivacy[];
  creator: CreatorInfoLike;
  onSaved: (row: TikTokRow) => void;
  onError: (e: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  // TikTok's UX guidelines require the privacy dropdown to start with NO value
  // chosen — "" is the unselected state and blocks saving.
  const [pickedPrivacy, setPrivacy] = useState<TikTokPrivacy | "">("");
  const [disableComment, setDisableComment] = useState(false);
  const [disableDuet, setDisableDuet] = useState(false);
  const [disableStitch, setDisableStitch] = useState(false);
  // Commercial disclosure: one master toggle (off by default), then which KIND.
  const [discloseCommercial, setDiscloseCommercial] = useState(false);
  const [brandContent, setBrandContent] = useState(false);
  const [brandOrganic, setBrandOrganic] = useState(false);
  const [isAigc, setIsAigc] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  // The account's allowed privacy levels can change between renders (they come
  // from creator_info), so drop a stale choice during render instead of syncing.
  const privacy: TikTokPrivacy | "" =
    pickedPrivacy && privacyOptions.includes(pickedPrivacy) ? pickedPrivacy : "";

  // Branded content can only go out public/friends — TikTok wants the private
  // option DISABLED with an explanation, not an error after the fact.
  const brandedLocksPrivacy = discloseCommercial && brandContent;
  const disclosureIncomplete = discloseCommercial && !brandContent && !brandOrganic;
  const canSave = !!privacy && !disclosureIncomplete;

  async function pick(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    const res = await uploadVideo(file);
    setUploading(false);
    if (res.ok) setVideoUrl(res.url);
    else onError(res.error);
  }

  function save() {
    if (!privacy) {
      onError("Escolha a visibilidade antes de salvar.");
      return;
    }
    if (disclosureIncomplete) {
      onError("Diga se o conteúdo promove a própria marca ou é parceria paga.");
      return;
    }
    startTransition(async () => {
      const res = await saveTikTokDraft({
        title,
        caption,
        videoUrl,
        privacy,
        disableComment,
        disableDuet,
        disableStitch,
        brandContent: discloseCommercial && brandContent,
        brandOrganic: discloseCommercial && brandOrganic,
        isAigc,
      });
      if (!res.ok) {
        onError(res.error);
        return;
      }
      onSaved(res.row);
      setTitle("");
      setCaption("");
      setVideoUrl(null);
      setPrivacy("");
      setDiscloseCommercial(false);
      setBrandContent(false);
      setBrandOrganic(false);
      setIsAigc(false);
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-4">
      {/* The guidelines require the destination account to be named on the
          publish screen, using the nickname from creator_info. */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Novo vídeo</h2>
        {creator?.creator_nickname && (
          <p className="text-xs text-foreground-muted">
            Vai publicar em{" "}
            <strong className="font-medium text-foreground">{creator.creator_nickname}</strong>
            {creator.creator_username ? ` (@${creator.creator_username})` : ""}
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        {/* Video */}
        <div className="space-y-2">
          <div className="flex aspect-[9/16] items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-surface-elevated">
            {videoUrl ? (
                  <video src={videoUrl} controls className="h-full w-full object-contain" />
            ) : (
              <span className="px-4 text-center text-xs text-foreground-faint">
                {uploading ? "Subindo…" : "Nenhum vídeo"}
              </span>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50"
          >
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {videoUrl ? "Trocar vídeo" : "Subir vídeo"}
          </button>
        </div>

        {/* Fields */}
        <div className="space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Nome interno (só pra identificar na fila)"
            className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground placeholder:text-foreground-faint focus:border-border-strong focus:outline-none"
          />
          <div>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, CAPTION_MAX))}
              rows={5}
              placeholder="Legenda — hashtags e @mentions funcionam aqui"
              className="w-full resize-y rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground placeholder:text-foreground-faint focus:border-border-strong focus:outline-none"
            />
            <p className="mt-1 text-right text-xs text-foreground-faint">
              {caption.length}/{CAPTION_MAX}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs text-foreground-muted">
              Quem pode ver
              <select
                value={privacy}
                onChange={(e) => setPrivacy(e.target.value as TikTokPrivacy | "")}
                className="ml-2 rounded-lg border border-border bg-surface-elevated px-2 py-1.5 text-sm text-foreground focus:border-border-strong focus:outline-none"
              >
                {/* No default: TikTok's guidelines require an explicit choice. */}
                <option value="">Selecione…</option>
                {privacyOptions.map((p) => {
                  // Branded content can't be private — disable rather than error.
                  const blocked = brandedLocksPrivacy && p === "SELF_ONLY";
                  return (
                    <option
                      key={p}
                      value={p}
                      disabled={blocked}
                      title={blocked ? "Parceria paga não pode ser privada" : undefined}
                    >
                      {PRIVACY_LABELS[p] ?? p}
                      {blocked ? " — indisponível em parceria paga" : ""}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-foreground-muted">
            <Toggle
              label="Desligar comentários"
              checked={disableComment}
              disabled={creator?.comment_disabled}
              hint={creator?.comment_disabled ? "a conta já bloqueia comentários" : undefined}
              onChange={setDisableComment}
            />
            <Toggle
              label="Desligar duet"
              checked={disableDuet}
              disabled={creator?.duet_disabled}
              hint={creator?.duet_disabled ? "a conta já bloqueia duet" : undefined}
              onChange={setDisableDuet}
            />
            <Toggle
              label="Desligar stitch"
              checked={disableStitch}
              disabled={creator?.stitch_disabled}
              hint={creator?.stitch_disabled ? "a conta já bloqueia stitch" : undefined}
              onChange={setDisableStitch}
            />
          </div>

          {/* Commercial disclosure — one toggle off by default, then the kind.
              TikTok audits this exact shape, including the label notices. */}
          <div className="space-y-2 border-t border-border pt-3 text-xs text-foreground-muted">
            <Toggle
              label="Divulgar conteúdo comercial"
              checked={discloseCommercial}
              onChange={(v) => {
                setDiscloseCommercial(v);
                if (!v) {
                  setBrandContent(false);
                  setBrandOrganic(false);
                }
              }}
            />
            {discloseCommercial && (
              <div className="space-y-2 pl-5">
                <Toggle
                  label="Sua marca — promove o próprio negócio"
                  checked={brandOrganic}
                  onChange={setBrandOrganic}
                />
                <Toggle
                  label="Conteúdo de marca — parceria paga com outra marca"
                  checked={brandContent}
                  onChange={setBrandContent}
                />
                {(brandContent || brandOrganic) && (
                  <p className="text-foreground-subtle">
                    O vídeo vai ser marcado como{" "}
                    <strong className="text-foreground">
                      {brandContent ? "“Parceria paga”" : "“Conteúdo promocional”"}
                    </strong>
                    .
                  </p>
                )}
                {disclosureIncomplete && (
                  <p className="text-danger">Escolha pelo menos uma das duas opções.</p>
                )}
              </div>
            )}
            <Toggle label="Conteúdo gerado por IA" checked={isAigc} onChange={setIsAigc} />
          </div>

          {/* Required declaration before the publish action. */}
          <p className="border-t border-border pt-3 text-xs text-foreground-subtle">
            Ao publicar, você concorda com{" "}
            {brandContent ? (
              <a
                href="https://www.tiktok.com/legal/page/global/bc-policy/en"
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                a Política de Conteúdo de Marca da TikTok
              </a>
            ) : (
              <a
                href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                a Confirmação de Uso de Música da TikTok
              </a>
            )}
            . Depois de enviado, o TikTok processa o vídeo — pode levar alguns minutos até
            aparecer no perfil.
          </p>

          <button
            type="button"
            onClick={save}
            disabled={pending || uploading || !canSave}
            title={!privacy ? "Escolha quem pode ver o vídeo" : undefined}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Salvando…" : "Salvar rascunho"}
          </button>
        </div>
      </div>
    </section>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className={`flex items-center gap-2 ${disabled ? "opacity-50" : ""}`} title={hint}>
      <input
        type="checkbox"
        checked={checked || !!disabled}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 accent-[var(--accent)]"
      />
      {label}
      {hint && <span className="text-foreground-faint">({hint})</span>}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Queue item
// ---------------------------------------------------------------------------

function QueueItem({
  row,
  privacyOptions,
  onChanged,
  onRemoved,
  onError,
}: {
  row: TikTokRow;
  privacyOptions: TikTokPrivacy[];
  onChanged: (row: TikTokRow) => void;
  onRemoved: (id: string) => void;
  onError: (e: string) => void;
}) {
  const [when, setWhen] = useState(() =>
    toLocalInput(row.scheduledFor ? new Date(row.scheduledFor) : new Date(Date.now() + 3600_000)),
  );
  const [busy, setBusy] = useState<string | null>(null);

  async function run(kind: string, fn: () => Promise<{ ok: boolean; error?: string; row?: TikTokRow }>) {
    setBusy(kind);
    const res = await fn();
    setBusy(null);
    if (!res.ok) {
      onError(res.error ?? "Falhou");
      return;
    }
    if (res.row) onChanged(res.row);
  }

  const locked = row.status === "published" || row.status === "publishing";

  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusBadge(row.status)}`}
            >
              {row.status}
            </span>
            {row.reviewed && (
              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                aprovado{row.reviewedBy ? ` por @${row.reviewedBy}` : ""}
              </span>
            )}
            <span className="text-[11px] text-foreground-faint">
              {PRIVACY_LABELS[row.privacy] ?? row.privacy}
            </span>
          </div>
          <p className="mt-2 truncate text-sm font-medium text-foreground">
            {row.title || "(sem nome)"}
          </p>
          <p className="mt-1 line-clamp-2 text-sm text-foreground-muted">{row.caption || "—"}</p>
          {row.error && <p className="mt-2 text-xs text-danger">{row.error}</p>}
          {row.scheduledFor && row.status === "scheduled" && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-foreground-subtle">
              <CalendarClock className="size-3.5" />
              {new Date(row.scheduledFor).toLocaleString()}
            </p>
          )}
          {row.shareUrl && (
            <a
              href={row.shareUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
            >
              Ver no TikTok <ExternalLink className="size-3" />
            </a>
          )}
        </div>

        {row.videoUrl && (
          <video
            src={row.videoUrl}
            className="h-28 w-20 shrink-0 rounded-lg border border-border object-cover"
            muted
          />
        )}
      </div>

      {!locked && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <button
            type="button"
            onClick={() => run("approve", () => approveTikTokPost(row.id, !row.reviewed))}
            disabled={busy !== null}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50"
          >
            {busy === "approve" ? "…" : row.reviewed ? "Remover aprovação" : "Aprovar"}
          </button>

          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="rounded-lg border border-border bg-surface-elevated px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none"
          />
          <button
            type="button"
            onClick={() =>
              run("schedule", () => scheduleTikTokPost(row.id, new Date(when).toISOString()))
            }
            disabled={busy !== null || !row.reviewed}
            title={row.reviewed ? undefined : "Aprove antes de agendar"}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50"
          >
            {busy === "schedule" ? "…" : "Agendar"}
          </button>
          {row.status === "scheduled" && (
            <button
              type="button"
              onClick={() => run("unschedule", () => scheduleTikTokPost(row.id, null))}
              disabled={busy !== null}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50"
            >
              Desagendar
            </button>
          )}

          <button
            type="button"
            onClick={() => run("publish", () => publishTikTokNow(row.id))}
            disabled={busy !== null || !row.reviewed}
            title={row.reviewed ? undefined : "Aprove antes de publicar"}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy === "publish" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
            Publicar agora
          </button>

          <button
            type="button"
            onClick={async () => {
              if (!window.confirm("Apagar este vídeo da fila?")) return;
              setBusy("delete");
              const res = await deleteTikTokPost(row.id);
              setBusy(null);
              if (res.ok) onRemoved(row.id);
              else onError(res.error);
            }}
            disabled={busy !== null}
            className="ml-auto rounded-lg border border-border p-1.5 text-foreground-faint transition-colors hover:border-danger/40 hover:text-danger disabled:opacity-50"
            aria-label="Apagar"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      )}

      {row.status === "published" && (
        <div className="mt-4 border-t border-border pt-3">
          <button
            type="button"
            onClick={() => run("status", () => refreshTikTokStatus(row.id))}
            disabled={busy !== null}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50"
          >
            {busy === "status" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Conferir status
          </button>
          <p className="mt-2 text-xs text-foreground-faint">
            A TikTok processa o vídeo depois de receber — o link público só aparece quando
            ela termina.
          </p>
        </div>
      )}

      {/* privacyOptions is read here so the item can warn when a stored value
          is no longer allowed by the account (e.g. the creator went private). */}
      {!locked && !privacyOptions.includes(row.privacy) && (
        <p className="mt-2 text-xs text-warning">
          A conta não permite mais “{PRIVACY_LABELS[row.privacy] ?? row.privacy}” — edite
          antes de publicar.
        </p>
      )}
    </li>
  );
}
