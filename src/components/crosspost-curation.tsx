"use client";

// Instagram cross-post curation. A community member marks "cross-post" on a
// snap in the main app; nothing goes out until someone here approves it. The
// curator fixes the caption, sets the collaborators, and either publishes now
// or picks a time.
//
// Approving is instant: it only claims the row and enqueues an InstagramPost.
// The Mac worker transcodes the video to an IG-safe MP4 and talks to Meta in
// the background, with retry — so there's no minutes-long request to sit through.

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Inbox,
  Loader2,
  RefreshCw,
  Save,
  Send,
  X,
} from "lucide-react";
import { SocialBrandIcon } from "@/components/social-brand-icon";
import {
  approveInstagramCrossPost,
  listCrossPostQueue,
  rejectCrossPost,
  saveCrossPostPayload,
  type CrossPostSetup,
} from "@/app/actions/crossposts";
import {
  IG_CAPTION_MAX,
  IG_MAX_COLLABORATORS,
  STATUS_CLASS,
  STATUS_LABEL,
  mediaOf,
  type CrossPostItem,
  type CrossPostStatus,
  type InstagramPayload,
} from "@/lib/crosspost-shared";

const REVIEW: CrossPostStatus[] = ["pending_review"];
const DECIDED: CrossPostStatus[] = ["approved", "publishing", "published", "rejected", "failed"];

/** Date → the `datetime-local` input's format, in the curator's own timezone. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ago(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(d) || d < 0) return "";
  const m = Math.floor(d / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

function MediaPreview({ payload }: { payload: InstagramPayload }) {
  const items = mediaOf(payload);
  const [index, setIndex] = useState(0);
  const [broken, setBroken] = useState<Record<number, boolean>>({});

  if (items.length === 0) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-xl border border-border bg-surface-elevated text-xs text-foreground-faint">
        Sem mídia no payload
      </div>
    );
  }

  const current = items[Math.min(index, items.length - 1)];

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-xl border border-border bg-surface-elevated">
        {broken[index] ? (
          <div className="flex aspect-square flex-col items-center justify-center gap-2 px-4 text-center">
            <AlertTriangle className="h-5 w-5 text-warning" />
            <p className="text-xs text-foreground-muted">Mídia fora do ar</p>
            <p className="text-[11px] leading-relaxed text-foreground-faint">
              O payload guarda a URL do IPFS, não o arquivo. Se o conteúdo saiu do ar, o
              preview quebra — quase sempre não é bug do portal.
            </p>
          </div>
        ) : current.type === "video" ? (
          <video
            key={current.url}
            src={current.url}
            controls
            playsInline
            preload="metadata"
            onError={() => setBroken((b) => ({ ...b, [index]: true }))}
            className="aspect-square w-full bg-background object-contain"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={current.url}
            src={current.url}
            alt=""
            onError={() => setBroken((b) => ({ ...b, [index]: true }))}
            className="aspect-square w-full bg-background object-contain"
          />
        )}

        {items.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => setIndex((i) => (i - 1 + items.length) % items.length)}
              aria-label="Mídia anterior"
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full border border-border bg-surface/90 p-1.5 text-foreground-muted backdrop-blur transition-colors hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setIndex((i) => (i + 1) % items.length)}
              aria-label="Próxima mídia"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-border bg-surface/90 p-1.5 text-foreground-muted backdrop-blur transition-colors hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      <div className="flex items-center justify-between text-[11px] text-foreground-faint">
        <span className="rounded-full border border-border px-2 py-0.5 uppercase tracking-wider">
          {payload.ig_media_type}
        </span>
        {items.length > 1 && (
          <span>
            {index + 1} / {items.length}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Queue list
// ---------------------------------------------------------------------------

function QueueRow({
  item,
  selected,
  onSelect,
}: {
  item: CrossPostItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const preview = (item.payload.caption ?? "").replace(/\s+/g, " ").trim();
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
        selected
          ? "border-accent-border bg-surface-elevated ring-1 ring-accent/30"
          : "border-border bg-surface/70 hover:border-border-strong hover:bg-surface-elevated"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <SocialBrandIcon platform="instagram" className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
          @{item.hiveAuthor || item.requestedByHandle}
        </span>
        <span className="shrink-0 text-[10px] text-foreground-faint">{ago(item.createdAt)}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-foreground-muted">
        {preview || "(sem legenda)"}
      </p>
      {item.status !== "pending_review" && (
        <span
          className={`mt-1.5 inline-block rounded-full border px-1.5 py-0.5 text-[10px] ${STATUS_CLASS[item.status]}`}
        >
          {STATUS_LABEL[item.status]}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Detail / editor
// ---------------------------------------------------------------------------

type Banner = { kind: "ok" | "warn" | "error"; text: string } | null;

function Detail({
  item,
  onReplace,
  onRemove,
  onReload,
}: {
  item: CrossPostItem;
  onReplace: (next: CrossPostItem) => void;
  onRemove: (id: string) => void;
  onReload: () => void;
}) {
  const payload = item.payload;

  // No reset-on-change effect needed: the shell renders <Detail key={item.id}>,
  // so picking another request remounts this editor and every initializer reruns.
  const [caption, setCaption] = useState(() => payload.caption ?? "");
  const [collabs, setCollabs] = useState<string[]>(() => payload.collaborators ?? []);
  const [collabDraft, setCollabDraft] = useState("");
  /** datetime-local value. Empty = publish as soon as the worker picks it up. */
  const [when, setWhen] = useState("");
  /**
   * Whether that time is far enough out that the author gets an "approved for
   * <date>" notice. Mirrors SCHEDULE_NOTICE_HORIZON_MS on the server. Computed
   * on change rather than during render — reading the clock while rendering is
   * impure and can desync between server and client.
   */
  const [farOut, setFarOut] = useState(false);

  function pickWhen(value: string) {
    setWhen(value);
    setFarOut(!!value && new Date(value).getTime() - Date.now() >= 15 * 60_000);
  }
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [saving, startSaving] = useTransition();
  const [busyReject, startReject] = useTransition();
  const [queueing, startQueue] = useTransition();

  const over = caption.length > IG_CAPTION_MAX;
  const editable = item.status === "pending_review";
  const busy = saving || busyReject || queueing;
  const dirty =
    caption !== (payload.caption ?? "") ||
    collabs.join(",") !== (payload.collaborators ?? []).join(",");

  function addCollab() {
    const v = collabDraft.trim().replace(/^@/, "");
    if (!v || collabs.includes(v) || collabs.length >= IG_MAX_COLLABORATORS) return;
    setCollabs((c) => [...c, v]);
    setCollabDraft("");
  }

  const save = () =>
    startSaving(async () => {
      setBanner(null);
      const res = await saveCrossPostPayload(item.id, { caption, collaborators: collabs });
      if (res.ok) {
        onReplace(res.item);
        setBanner({ kind: "ok", text: "Legenda salva." });
      } else {
        setBanner({ kind: res.stale ? "warn" : "error", text: res.error });
        if (res.stale) onReload();
      }
    });

  const approve = () =>
    startQueue(async () => {
      setBanner(null);
      const res = await approveInstagramCrossPost(
        item.id,
        { caption, collaborators: collabs },
        when ? new Date(when).toISOString() : undefined,
      );
      if (res.ok) {
        onRemove(item.id);
      } else {
        setBanner({ kind: res.stale ? "warn" : "error", text: res.error });
        if (res.stale) onReload();
      }
    });

  const doReject = () =>
    startReject(async () => {
      setBanner(null);
      const res = await rejectCrossPost(item.id, note);
      if (res.ok) {
        onRemove(item.id);
      } else {
        setBanner({ kind: res.stale ? "warn" : "error", text: res.error });
        if (res.stale) onReload();
      }
    });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <SocialBrandIcon platform="instagram" className="h-4 w-4" />
        <span className="text-sm font-semibold text-foreground">
          @{item.hiveAuthor || item.requestedByHandle}
        </span>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] ${STATUS_CLASS[item.status]}`}
        >
          {STATUS_LABEL[item.status]}
        </span>
        <span className="text-[11px] text-foreground-faint">pedido {ago(item.createdAt)}</span>
        {payload.permalink_url && (
          <a
            href={payload.permalink_url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
          >
            ver o snap <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </header>

      {banner && (
        <div
          className={`rounded-xl border px-3 py-2 text-xs leading-relaxed ${
            banner.kind === "ok"
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-500"
              : banner.kind === "warn"
                ? "border-warning/30 bg-warning/10 text-warning"
                : "border-danger/30 bg-danger/10 text-danger"
          }`}
        >
          {banner.text}
        </div>
      )}

      {item.status === "failed" && item.publishError && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          Última falha: {item.publishError}
          {item.attempts > 0 && ` · ${item.attempts} tentativa(s)`}
        </p>
      )}

      {item.status === "published" && item.result?.ig_permalink && (
        <a
          href={item.result.ig_permalink}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-500 hover:underline"
        >
          Ver no Instagram <ExternalLink className="h-3 w-3" />
        </a>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <MediaPreview payload={payload} />

        <div className="space-y-3">
          <div>
            <div className="flex items-baseline justify-between">
              <label
                htmlFor="crosspost-caption"
                className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle"
              >
                Legenda
              </label>
              <span className={`text-[11px] ${over ? "text-danger" : "text-foreground-faint"}`}>
                {caption.length} / {IG_CAPTION_MAX}
              </span>
            </div>
            <textarea
              id="crosspost-caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={10}
              disabled={!editable || busy}
              placeholder="Escreva a legenda que vai sair no Instagram…"
              className={`mt-1 w-full resize-y rounded-xl border bg-surface-elevated px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-foreground-faint focus:outline-none focus:ring-1 disabled:opacity-60 ${
                over
                  ? "border-danger/50 focus:border-danger focus:ring-danger/30"
                  : "border-border focus:border-accent-border focus:ring-accent/30"
              }`}
            />
            {over && (
              <p className="mt-1 text-[11px] text-danger">
                O Instagram corta em {IG_CAPTION_MAX} — encurte antes de publicar.
              </p>
            )}
          </div>

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
              Colaboradores ({collabs.length}/{IG_MAX_COLLABORATORS})
            </label>
            <p className="mt-0.5 text-[11px] text-foreground-faint">
              Handles do Instagram convidados como coautores do post.
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {collabs.map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-elevated px-2 py-0.5 text-xs text-foreground"
                >
                  @{c}
                  {editable && (
                    <button
                      type="button"
                      onClick={() => setCollabs((p) => p.filter((x) => x !== c))}
                      aria-label={`Remover ${c}`}
                      className="text-foreground-faint hover:text-danger"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
              {editable && collabs.length < IG_MAX_COLLABORATORS && (
                <input
                  value={collabDraft}
                  onChange={(e) => setCollabDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addCollab();
                    }
                  }}
                  onBlur={addCollab}
                  placeholder="@handle"
                  disabled={busy}
                  className="w-32 rounded-full border border-border bg-surface-elevated px-2.5 py-1 text-xs text-foreground placeholder:text-foreground-faint focus:border-accent-border focus:outline-none disabled:opacity-50"
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {editable && !rejecting && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={approve}
            disabled={busy || over}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-40"
          >
            {queueing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : when ? (
              <CalendarClock className="h-3.5 w-3.5" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {when ? "Aprovar e agendar" : "Aprovar e publicar"}
          </button>

          {/* The button must sit OUTSIDE the label: interactive content inside a
              <label> is invalid HTML, and clicking it would also fire the label
              and yank focus into the date input. */}
          <span className="inline-flex items-center gap-1.5 text-[11px] text-foreground-faint">
            <label htmlFor="crosspost-when" className="sr-only">
              Agendar publicação para
            </label>
            <input
              id="crosspost-when"
              type="datetime-local"
              value={when}
              min={toLocalInput(new Date())}
              onChange={(e) => pickWhen(e.target.value)}
              disabled={busy}
              className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs text-foreground focus:border-accent-border focus:outline-none disabled:opacity-50"
            />
            {when ? (
              <button
                type="button"
                onClick={() => pickWhen("")}
                className="text-foreground-faint underline hover:text-foreground"
              >
                publicar agora
              </button>
            ) : (
              <span>ou escolha quando sai</span>
            )}
          </span>

          {/* The author only hears about an approval when the wait is long
              enough to feel like silence; otherwise the "it's live" notice with
              the permalink is moments away. Say which one they'll get. */}
          <span className="w-full text-[11px] text-foreground-faint">
            {farOut
              ? "O autor será avisado de que foi aprovado e da data."
              : "O autor será avisado quando o post entrar no ar, com o link."}
          </span>

          <button
            type="button"
            onClick={save}
            disabled={busy || !dirty || over}
            title="Guarda a legenda sem publicar — dá pra decidir depois"
            className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-40"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Salvar legenda
          </button>

          <button
            type="button"
            onClick={() => setRejecting(true)}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-medium text-danger transition-colors hover:bg-danger/20 disabled:opacity-40"
          >
            <X className="h-3.5 w-3.5" /> Recusar
          </button>
        </div>
      )}

      {editable && rejecting && (
        <div className="space-y-2 border-t border-border pt-4">
          <label
            htmlFor="crosspost-note"
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle"
          >
            Motivo da recusa (opcional)
          </label>
          <p className="text-[11px] text-foreground-faint">
            Se escrever, o autor recebe uma notificação com esse texto entre aspas, no idioma em
            que você escrever. Em branco, ele só é avisado de que a curadoria não levou esse.
          </p>
          <textarea
            id="crosspost-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="ex: a filmagem está muito escura, manda outra manobra"
            className="w-full resize-y rounded-xl border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground placeholder:text-foreground-faint focus:border-accent-border focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={doReject}
              disabled={busyReject}
              className="inline-flex items-center gap-1.5 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-semibold text-danger hover:bg-danger/20 disabled:opacity-40"
            >
              {busyReject ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Confirmar recusa
            </button>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className="rounded-xl border border-border px-3 py-2 text-xs text-foreground-muted hover:border-border-strong hover:text-foreground"
            >
              Voltar
            </button>
          </div>
        </div>
      )}

      {!editable && (
        <p className="border-t border-border pt-4 text-xs text-foreground-faint">
          Item já decidido{item.reviewedByHandle ? ` por @${item.reviewedByHandle}` : ""} — sem
          edição.
          {item.reviewNote && ` Nota: “${item.reviewNote}”`}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export function CrossPostCuration({ setup }: { setup: CrossPostSetup }) {
  const [items, setItems] = useState<CrossPostItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Rows matching the filter in the DB — may exceed what the query returned. */
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [showDecided, setShowDecided] = useState(false);
  const [reloading, startReload] = useTransition();

  const load = useCallback(() => {
    startReload(async () => {
      const res = await listCrossPostQueue({ statuses: showDecided ? DECIDED : REVIEW });
      if (res.ok) {
        setItems(res.items);
        setTotal(res.total);
        setStatus("ready");
        setSelectedId((prev) =>
          prev && res.items.some((i) => i.id === prev) ? prev : (res.items[0]?.id ?? null),
        );
      } else {
        setError(res.error);
        setStatus("error");
      }
    });
  }, [showDecided]);

  useEffect(() => {
    if (setup.ready) load();
  }, [setup.ready, load]);

  const selected = items.find((i) => i.id === selectedId) ?? null;

  const replace = (next: CrossPostItem) =>
    setItems((prev) => prev.map((i) => (i.id === next.id ? next : i)));

  const remove = (id: string) =>
    setItems((prev) => {
      const next = prev.filter((i) => i.id !== id);
      setSelectedId((cur) => (cur === id ? (next[0]?.id ?? null) : cur));
      return next;
    });

  if (!setup.ready) {
    return (
      <div className="rounded-2xl border border-warning/30 bg-warning/10 px-5 py-4 text-sm">
        <p className="font-medium text-foreground">Fila não conectada.</p>
        <p className="mt-1 text-foreground-muted">
          Faltam: {setup.missing.join(", ") || "configuração"}.
        </p>
        <p className="mt-3 text-xs leading-relaxed text-foreground-muted">
          A fila mora no Supabase do app da SkateHive e usa as mesmas credenciais do userbase
          que o portal já tem. Confira o schema antes de ligar:
        </p>
        <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-surface-elevated px-3 py-2 text-[11px] text-foreground-muted">
{`npx dotenv -e .env.local -- node scripts/crosspost-preflight.cjs`}
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-1.5 text-[11px] text-foreground-faint">
          <SocialBrandIcon platform="instagram" className="h-3.5 w-3.5" />
          {status === "ready" && !showDecided && total > 0 ? (
            <span>
              <span className="font-semibold text-foreground">{total}</span> aguardando revisão
              {items.length < total && ` · mostrando os ${items.length} mais antigos`}
            </span>
          ) : (
            <span>pedidos de cross-post da comunidade · nada sai sem passar por aqui</span>
          )}
        </p>

        <button
          type="button"
          onClick={() => setShowDecided((v) => !v)}
          aria-pressed={showDecided}
          className={`ml-auto rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
            showDecided
              ? "border-accent-border bg-accent-bg text-accent"
              : "border-border text-foreground-muted hover:border-border-strong hover:text-foreground"
          }`}
        >
          {showDecided ? "Vendo decididos" : "Ver decididos"}
        </button>

        <button
          type="button"
          onClick={load}
          disabled={reloading}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs text-foreground-muted hover:border-border-strong disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${reloading ? "animate-spin" : ""}`} /> Atualizar
        </button>
      </div>

      {setup.publisher === "unconfigured" && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-xs leading-relaxed">
          <p className="font-medium text-foreground">
            A máquina que publica está sem as credenciais do userbase.
          </p>
          <p className="mt-1 text-foreground-muted">
            O post até sai no Instagram, mas o portal não consegue escrever o resultado de volta:
            o pedido fica travado e o autor nunca é avisado. Configure{" "}
            <code className="rounded bg-surface-elevated px-1">SUPABASE_USERBASE_*</code> no worker
            antes de aprovar.
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {status === "loading" ? (
        <p className="flex items-center gap-2 py-10 text-sm text-foreground-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando a fila…
        </p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-12 text-center">
          <Inbox className="h-5 w-5 text-foreground-faint" />
          <p className="text-sm text-foreground-muted">
            {showDecided ? "Nada decidido ainda." : "Nenhum pedido aguardando revisão."}
          </p>
          {!showDecided && (
            <p className="max-w-md text-[11px] leading-relaxed text-foreground-faint">
              Se você esperava ver itens aqui: o app tem um kill switch,{" "}
              <code className="rounded bg-surface-elevated px-1">CROSSPOST_QUEUE_ENABLED</code>.
              Desligado, os cross-posts publicam na hora e nada entra na fila.
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
          <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto pr-1">
            {items.map((i) => (
              <QueueRow
                key={i.id}
                item={i}
                selected={i.id === selectedId}
                onSelect={() => setSelectedId(i.id)}
              />
            ))}
          </div>
          <div className="rounded-2xl border border-border bg-surface p-4">
            {selected ? (
              <Detail
                key={selected.id}
                item={selected}
                onReplace={replace}
                onRemove={remove}
                onReload={load}
              />
            ) : (
              <p className="py-10 text-center text-sm text-foreground-faint">
                Escolha um pedido na lista.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
