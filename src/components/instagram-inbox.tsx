"use client";

import { useEffect, useState, useTransition } from "react";
import { ExternalLink, Loader2, Send, EyeOff, Eye, RefreshCw, MessageCircle } from "lucide-react";
import { SocialBrandIcon } from "@/components/social-brand-icon";
import type { IgComment, IgPostThread } from "@/lib/instagram-publish";
import { listInstagramComments, postInstagramReply, toggleInstagramCommentHidden } from "@/app/actions/instagram-curation";

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

/**
 * A comment needs attention unless WE sent the last message in its thread.
 * - our own top-level comment → handled
 * - the last reply (by time) is ours → handled (ball in their court)
 * - no replies, or the commenter replied after us → needs attention
 */
function needsAttention(c: IgComment, self: string): boolean {
  if (self && c.username === self) return false;
  if (c.replies.length === 0) return true;
  const last = c.replies.reduce((a, b) => (a.timestamp >= b.timestamp ? a : b));
  return !(self && last.username === self);
}

export function InstagramInbox() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [threads, setThreads] = useState<IgPostThread[]>([]);
  const [self, setSelf] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reloading, startReload] = useTransition();

  function load() {
    startReload(async () => {
      const res = await listInstagramComments();
      if (res.ok) {
        setThreads(res.threads);
        setSelf(res.selfUsername);
        setStatus("ready");
      } else {
        setError(res.error);
        setStatus("error");
      }
    });
  }
  useEffect(() => { load(); }, []);

  const replaceComment = (mediaId: string, next: IgComment) =>
    setThreads((prev) =>
      prev.map((t) =>
        t.media.igMediaId !== mediaId ? t : { ...t, comments: t.comments.map((c) => (c.id === next.id ? next : c)) },
      ),
    );

  // Only show threads with at least one comment still needing a reply.
  const pending = threads
    .map((t) => ({ ...t, comments: t.comments.filter((c) => needsAttention(c, self)) }))
    .filter((t) => t.comments.length > 0);

  if (status === "loading") {
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-foreground-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando comentários do Instagram…
      </p>
    );
  }

  if (status === "error") {
    const needsScope = /permission|instagram_manage_comments|não conectado|token|business/i.test(error ?? "");
    return (
      <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-4 text-sm">
        <p className="font-medium text-foreground">Não consegui carregar os comentários.</p>
        <p className="mt-1 text-foreground-muted">{error}</p>
        {needsScope && (
          <p className="mt-2 text-xs text-foreground-muted">
            Reemita o token do Instagram com o escopo <code className="rounded bg-surface-elevated px-1">instagram_manage_comments</code> e
            atualize <code className="rounded bg-surface-elevated px-1">&lt;PREFIX&gt;_INSTAGRAM_ACCESS_TOKEN</code>.
          </p>
        )}
        <button
          type="button"
          onClick={load}
          disabled={reloading}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground-muted hover:border-border-strong disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${reloading ? "animate-spin" : ""}`} /> Tentar de novo
        </button>
      </div>
    );
  }

  if (pending.length === 0) {
    return (
      <div className="space-y-3">
        <Toolbar onReload={load} reloading={reloading} />
        <p className="rounded-xl border border-border bg-surface px-4 py-8 text-center text-sm text-foreground-faint">
          Tudo respondido — nenhum comentário aguardando. 🎉
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Toolbar onReload={load} reloading={reloading} />
      {pending.map((t) => (
        <PostThread key={t.media.igMediaId} thread={t} self={self} onChange={(c) => replaceComment(t.media.igMediaId, c)} />
      ))}
    </div>
  );
}

function Toolbar({ onReload, reloading }: { onReload: () => void; reloading: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <p className="flex items-center gap-1.5 text-[11px] text-foreground-faint">
        <SocialBrandIcon platform="instagram" className="h-3.5 w-3.5" /> comentários dos seus posts · responda direto daqui
      </p>
      <button
        type="button"
        onClick={onReload}
        disabled={reloading}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-foreground-muted hover:border-border-strong disabled:opacity-50"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${reloading ? "animate-spin" : ""}`} /> Atualizar
      </button>
    </div>
  );
}

function PostThread({ thread, self, onChange }: { thread: IgPostThread; self: string; onChange: (c: IgComment) => void }) {
  const { media, comments } = thread;
  const cover = media.coverUrl ?? media.mediaUrls[0] ?? null;
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface">
      <header className="flex items-center gap-3 border-b border-border bg-surface-elevated/40 p-3">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover ring-1 ring-border" />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-surface-elevated text-foreground-faint">
            <SocialBrandIcon platform="instagram" className="h-5 w-5" />
          </span>
        )}
        <p className="min-w-0 flex-1 truncate text-sm text-foreground-muted">{media.caption || "(sem legenda)"}</p>
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-foreground-faint">
          <MessageCircle className="h-3.5 w-3.5" /> {comments.length}
        </span>
        {media.permalink && (
          <a href={media.permalink} target="_blank" rel="noreferrer" className="shrink-0 text-accent hover:underline" title="Abrir no Instagram">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </header>
      <ul className="divide-y divide-border">
        {comments.map((c) => (
          <CommentRow key={c.id} comment={c} self={self} onChange={onChange} />
        ))}
      </ul>
    </section>
  );
}

function CommentRow({ comment, self, onChange }: { comment: IgComment; self: string; onChange: (c: IgComment) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();

  const reply = () =>
    startBusy(async () => {
      setError(null);
      const res = await postInstagramReply(comment.id, text);
      if (res.ok) {
        // Mark our reply as the last message → the comment leaves the inbox
        // until the user replies again.
        onChange({
          ...comment,
          replies: [...comment.replies, { id: res.id || `tmp-${Date.now()}`, text: text.trim(), username: self || "you", timestamp: new Date().toISOString() }],
        });
        setText("");
      } else setError(res.error);
    });

  const toggleHide = () =>
    startBusy(async () => {
      const res = await toggleInstagramCommentHidden(comment.id, !comment.hidden);
      if (res.ok) onChange({ ...comment, hidden: !comment.hidden });
      else setError(res.error);
    });

  return (
    <li className={`p-3 ${comment.hidden ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm">
            <span className="font-semibold text-foreground">@{comment.username || "usuário"}</span>{" "}
            <span className="text-foreground">{comment.text}</span>
          </p>
          <p className="mt-0.5 text-[11px] text-foreground-faint">
            {ago(comment.timestamp)}
            {comment.likeCount > 0 ? ` · ${comment.likeCount} likes` : ""}
            {comment.hidden ? " · oculto" : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={toggleHide}
          disabled={busy}
          title={comment.hidden ? "Reexibir comentário" : "Ocultar comentário"}
          className="shrink-0 rounded-md p-1.5 text-foreground-faint transition-colors hover:bg-surface-elevated hover:text-foreground disabled:opacity-50"
        >
          {comment.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>
      </div>

      {comment.replies.length > 0 && (
        <ul className="mt-2 space-y-1 border-l-2 border-border pl-3">
          {comment.replies.map((r) => (
            <li key={r.id} className="text-xs">
              <span className="font-medium text-foreground-muted">@{r.username || "you"}</span>{" "}
              <span className="text-foreground-muted">{r.text}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) reply(); }}
          placeholder="Responder…"
          maxLength={300}
          disabled={busy}
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-sm text-foreground placeholder:text-foreground-faint focus:border-accent-border focus:outline-none focus:ring-1 focus:ring-accent/30 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={reply}
          disabled={busy || !text.trim()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Responder
        </button>
      </div>
      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
    </li>
  );
}
