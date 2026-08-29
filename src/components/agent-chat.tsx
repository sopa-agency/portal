"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Paperclip,
  ArrowUp,
  Square,
  Plus,
  Trash2,
  Pin,
  PinOff,
  Pencil,
  Copy,
  Check,
  RefreshCw,
  ArrowDown,
  PanelLeftClose,
  PanelLeftOpen,
  FileText,
  Link2,
  X,
  Loader2,
} from "lucide-react";
import { MarkdownContent } from "@/components/markdown-content";
import type { Dictionary } from "@/lib/i18n/dictionary";

type T = Dictionary["chat"];

const MAX_FILES = 10;
const MAX_BYTES = 8 * 1024 * 1024;

export type ConversationRow = {
  id: string;
  title: string;
  pinned: boolean;
  updatedAt: string | Date;
};

type Attachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  /** O agente leu o conteúdo (texto) ou recebeu só a URL? */
  inlined: boolean;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  error?: string | null;
  attachments?: Attachment[];
};

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function AgentChat({
  t,
  agentName,
  agentEmoji,
  initialConversations,
}: {
  t: T;
  agentName: string;
  agentEmoji: string;
  initialConversations: ConversationRow[];
}) {
  const [conversations, setConversations] = useState<ConversationRow[]>(initialConversations);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");
  const [streamed, setStreamed] = useState("");
  const [error, setError] = useState("");
  const [deep, setDeep] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loadingConversation, setLoadingConversation] = useState(false);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dragDepth = useRef(0);

  // O texto chega token a token. Reagir a cada delta com setState re-renderiza
  // o markdown inteiro dezenas de vezes por segundo — o navegador engasga e a
  // resposta parece MAIS lenta do que sem streaming. Acumulamos num ref e
  // publicamos em ritmo de quadro.
  const bufferRef = useRef("");
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const startFlushing = useCallback(() => {
    if (flushTimer.current) return;
    flushTimer.current = setInterval(() => {
      setStreamed((prev) => (prev === bufferRef.current ? prev : bufferRef.current));
    }, 60);
  }, []);

  const stopFlushing = useCallback(() => {
    if (flushTimer.current) {
      clearInterval(flushTimer.current);
      flushTimer.current = null;
    }
    setStreamed(bufferRef.current);
  }, []);

  useEffect(() => () => stopFlushing(), [stopFlushing]);

  // -------------------------------------------------------------------------
  // Rolagem
  // -------------------------------------------------------------------------
  const [atBottom, setAtBottom] = useState(true);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // 80px de folga: quem está "quase" no fim quer continuar acompanhando.
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
  }, []);

  useEffect(() => {
    // Só puxa a rolagem se a pessoa já estava no fim. Arrastar a tela de alguém
    // que subiu para reler é a forma mais rápida de tornar um chat irritante.
    if (atBottom) scrollToBottom(streamed ? "auto" : "smooth");
  }, [messages, streamed, atBottom, scrollToBottom]);

  // -------------------------------------------------------------------------
  // Conversas
  // -------------------------------------------------------------------------
  const refreshConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/conversations");
      const data = (await res.json()) as { ok: boolean; conversations?: ConversationRow[] };
      if (data.ok && data.conversations) setConversations(data.conversations);
    } catch {
      // lista desatualizada não impede conversar
    }
  }, []);

  const openConversation = useCallback(
    async (id: string) => {
      setActiveId(id);
      setError("");
      setLoadingConversation(true);
      try {
        const res = await fetch(`/api/chat/conversations/${id}`);
        const data = (await res.json()) as { ok: boolean; conversation?: { messages: Message[] } };
        if (!data.ok || !data.conversation) throw new Error();
        setMessages(data.conversation.messages);
        requestAnimationFrame(() => scrollToBottom("auto"));
      } catch {
        setError(t.loadFailed);
        setMessages([]);
      } finally {
        setLoadingConversation(false);
      }
    },
    [scrollToBottom, t.loadFailed],
  );

  const newConversation = useCallback(() => {
    setActiveId(null);
    setMessages([]);
    setError("");
    setFiles([]);
    setStreamed("");
    bufferRef.current = "";
    textareaRef.current?.focus();
  }, []);

  const removeConversation = useCallback(
    async (id: string) => {
      if (!window.confirm(t.removeConfirm)) return;
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) newConversation();
      await fetch(`/api/chat/conversations/${id}`, { method: "DELETE" }).catch(() => {});
    },
    [activeId, newConversation, t.removeConfirm],
  );

  const renameConversation = useCallback(async (id: string, current: string) => {
    const title = window.prompt("", current)?.trim();
    if (!title) return;
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
    await fetch(`/api/chat/conversations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    }).catch(() => {});
  }, []);

  const togglePin = useCallback(async (id: string, pinned: boolean) => {
    setConversations((prev) =>
      [...prev.map((c) => (c.id === id ? { ...c, pinned: !pinned } : c))].sort(
        (a, b) => Number(b.pinned) - Number(a.pinned),
      ),
    );
    await fetch(`/api/chat/conversations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pinned: !pinned }),
    }).catch(() => {});
  }, []);

  // -------------------------------------------------------------------------
  // Anexos
  // -------------------------------------------------------------------------
  const addFiles = useCallback(
    (incoming: File[]) => {
      setError("");
      const accepted: File[] = [];
      for (const f of incoming) {
        if (f.size > MAX_BYTES) {
          setError(t.fileTooBig(f.name));
          continue;
        }
        accepted.push(f);
      }
      setFiles((prev) => {
        const next = [...prev, ...accepted];
        if (next.length > MAX_FILES) {
          setError(t.tooManyFiles(MAX_FILES));
          return next.slice(0, MAX_FILES);
        }
        return next;
      });
    },
    [t],
  );

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // -------------------------------------------------------------------------
  // Envio
  // -------------------------------------------------------------------------
  const send = useCallback(
    async (override?: string) => {
      const text = (override ?? draft).trim();
      if ((!text && files.length === 0) || sending) return;

      setSending(true);
      setError("");
      setStatus(deep ? t.working : t.thinking);
      bufferRef.current = "";
      setStreamed("");

      const pendingAttachments: Attachment[] = files.map((f, i) => ({
        id: `pending-${i}`,
        name: f.name,
        mimeType: f.type,
        size: f.size,
        inlined: false,
      }));
      setMessages((prev) => [
        ...prev,
        { id: `local-${Date.now()}`, role: "user", content: text, attachments: pendingAttachments },
      ]);
      if (!override) setDraft("");
      const sentFiles = files;
      setFiles([]);
      setAtBottom(true);

      const body = new FormData();
      body.set("message", text);
      body.set("deep", deep ? "1" : "0");
      if (activeId) body.set("conversationId", activeId);
      for (const f of sentFiles) body.append("files", f);

      const controller = new AbortController();
      abortRef.current = controller;
      startFlushing();

      try {
        const res = await fetch("/api/chat/send", {
          method: "POST",
          body,
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || t.sendFailed);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finished = false;

        const handle = (block: string) => {
          const lines = block.split("\n");
          const event = lines.find((l) => l.startsWith("event:"))?.slice(6).trim() || "message";
          const dataLine = lines.find((l) => l.startsWith("data:"));
          if (!dataLine) return;
          let data: Record<string, unknown>;
          try {
            data = JSON.parse(dataLine.slice(5).trim());
          } catch {
            return;
          }

          if (event === "start") {
            const id = String(data.conversationId ?? "");
            if (id && id !== activeId) setActiveId(id);
            const atts = data.attachments as Attachment[] | undefined;
            if (atts) {
              // Troca os chips locais pelos de verdade: agora sabemos quais o
              // agente leu como texto e quais foram só link.
              setMessages((prev) => {
                const next = [...prev];
                for (let i = next.length - 1; i >= 0; i--) {
                  if (next[i].role === "user") {
                    next[i] = { ...next[i], attachments: atts };
                    break;
                  }
                }
                return next;
              });
            }
            setStatus(deep ? t.working : t.thinking);
            return;
          }
          if (event === "delta") {
            bufferRef.current += String(data.chunk ?? "");
            setStatus("");
            return;
          }
          if (event === "reset") {
            bufferRef.current = String(data.text ?? "");
            return;
          }
          if (event === "final") {
            finished = true;
            const content = String(data.content ?? bufferRef.current);
            bufferRef.current = "";
            stopFlushing();
            setStreamed("");
            setMessages((prev) => [
              ...prev,
              { id: String(data.messageId ?? `a-${Date.now()}`), role: "assistant", content },
            ]);
            setStatus("");
            void refreshConversations();
            return;
          }
          if (event === "error") {
            finished = true;
            const partial = String(data.partial ?? bufferRef.current);
            bufferRef.current = "";
            stopFlushing();
            setStreamed("");
            setMessages((prev) => [
              ...prev,
              {
                id: String(data.messageId ?? `e-${Date.now()}`),
                role: "assistant",
                content: partial,
                error: String(data.error ?? t.sendFailed),
              },
            ]);
            setStatus("");
            return;
          }
        };

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";
          for (const b of blocks) handle(b);
        }
        if (buffer.trim()) handle(buffer);
        if (!finished) throw new Error(t.streamDropped);
      } catch (err) {
        const aborted = (err as { name?: string })?.name === "AbortError";
        const partial = bufferRef.current;
        bufferRef.current = "";
        stopFlushing();
        setStreamed("");
        setMessages((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            role: "assistant",
            content: partial,
            // Parar é escolha, não falha: a resposta segue sendo gravada no
            // servidor e reaparece inteira ao reabrir a conversa.
            error: aborted
              ? `${t.stopped} ${t.partialKept}`
              : err instanceof Error
                ? err.message
                : t.sendFailed,
          },
        ]);
        if (!aborted) setError(err instanceof Error ? err.message : t.sendFailed);
        void refreshConversations();
      } finally {
        abortRef.current = null;
        setSending(false);
        setStatus("");
      }
    },
    [
      activeId,
      deep,
      draft,
      files,
      refreshConversations,
      sending,
      startFlushing,
      stopFlushing,
      t,
    ],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const regenerate = useCallback(() => {
    // A última pergunta da pessoa, reenviada. Não apagamos o turno anterior: o
    // histórico do que foi tentado é parte do que a conversa conta.
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) void send(lastUser.content);
  }, [messages, send]);

  const copy = useCallback(async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1600);
    } catch {
      // clipboard bloqueado — nada a fazer além de não quebrar
    }
  }, []);

  // -------------------------------------------------------------------------
  // Teclado / colar / arrastar
  // -------------------------------------------------------------------------
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const pasted = Array.from(e.clipboardData.files);
    if (pasted.length > 0) {
      e.preventDefault();
      addFiles(pasted);
    }
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [draft]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, query]);

  const showEmpty = messages.length === 0 && !streamed && !loadingConversation;

  return (
    <div
      className="flex h-[calc(100vh-4rem)] min-h-0 w-full overflow-hidden"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDragLeave={() => {
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragging(false);
        }
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Trilho de conversas                                                 */}
      {/* ------------------------------------------------------------------ */}
      <aside
        className={`${
          railOpen ? "w-64" : "w-0"
        } hidden shrink-0 flex-col overflow-hidden border-r border-border bg-surface transition-[width] duration-200 md:flex`}
      >
        <div className="flex items-center gap-2 p-3">
          <button
            type="button"
            onClick={newConversation}
            className="flex flex-1 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-border-strong hover:bg-surface-elevated"
          >
            <Plus className="size-4" />
            {t.newConversation}
          </button>
        </div>
        <div className="px-3 pb-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchConversations}
            className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs text-foreground placeholder:text-foreground-faint focus:border-accent-border focus:outline-none"
          />
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-xs text-foreground-subtle">{t.noConversations}</p>
          ) : (
            <ul className="space-y-0.5">
              {filtered.map((c) => (
                <li key={c.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => void openConversation(c.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 pr-16 text-left text-sm transition-colors ${
                      activeId === c.id
                        ? "bg-accent-bg text-foreground"
                        : "text-foreground-muted hover:bg-surface-elevated hover:text-foreground"
                    }`}
                  >
                    {c.pinned ? <Pin className="size-3 shrink-0 text-accent" /> : null}
                    <span className="truncate">{c.title || t.newConversation}</span>
                  </button>
                  <div className="absolute right-1 top-1.5 hidden items-center gap-0.5 group-hover:flex">
                    <button
                      type="button"
                      title={c.pinned ? t.unpin : t.pin}
                      aria-label={c.pinned ? t.unpin : t.pin}
                      onClick={() => void togglePin(c.id, c.pinned)}
                      className="rounded p-1 text-foreground-subtle transition-colors hover:bg-surface hover:text-foreground"
                    >
                      {c.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                    </button>
                    <button
                      type="button"
                      title={t.rename}
                      aria-label={t.rename}
                      onClick={() => void renameConversation(c.id, c.title)}
                      className="rounded p-1 text-foreground-subtle transition-colors hover:bg-surface hover:text-foreground"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      title={t.remove}
                      aria-label={t.remove}
                      onClick={() => void removeConversation(c.id)}
                      className="rounded p-1 text-foreground-subtle transition-colors hover:bg-surface hover:text-danger"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </nav>
      </aside>

      {/* ------------------------------------------------------------------ */}
      {/* Conversa                                                            */}
      {/* ------------------------------------------------------------------ */}
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <header className="flex items-center gap-2 border-b border-border px-4 py-2">
          <button
            type="button"
            onClick={() => setRailOpen((v) => !v)}
            aria-label={t.conversations}
            title={t.conversations}
            className="hidden rounded-lg p-1.5 text-foreground-subtle transition-colors hover:bg-surface hover:text-foreground md:block"
          >
            {railOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
          </button>
          <span className="text-sm font-medium text-foreground">
            {agentEmoji} {agentName}
          </span>
          <button
            type="button"
            onClick={newConversation}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground md:hidden"
          >
            <Plus className="size-3.5" />
            {t.newConversation}
          </button>
        </header>

        <div
          ref={scrollerRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto w-full max-w-3xl px-4 py-6">
            {showEmpty ? (
              <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
                <span className="text-4xl">{agentEmoji}</span>
                <h2 className="text-lg font-semibold text-foreground">{t.emptyTitle(agentName)}</h2>
                <p className="max-w-md text-sm text-foreground-subtle">{t.emptyHint}</p>
              </div>
            ) : null}

            {loadingConversation ? (
              <div className="flex justify-center py-12">
                <Loader2 className="size-5 animate-spin text-foreground-faint" />
              </div>
            ) : null}

            <div className="space-y-6">
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex flex-col items-end gap-1.5">
                    {m.content ? (
                      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-surface-elevated px-4 py-2.5 text-sm text-foreground">
                        {m.content}
                      </div>
                    ) : null}
                    {m.attachments && m.attachments.length > 0 ? (
                      <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
                        {m.attachments.map((a) => (
                          <span
                            key={a.id}
                            title={`${a.name} — ${a.inlined ? t.inlined : t.linked}`}
                            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1 text-[11px] text-foreground-muted"
                          >
                            {a.inlined ? (
                              <FileText className="size-3 text-accent" />
                            ) : (
                              <Link2 className="size-3 text-foreground-faint" />
                            )}
                            <span className="max-w-40 truncate">{a.name}</span>
                            <span className="text-foreground-faint">{formatBytes(a.size)}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div key={m.id} className="group flex flex-col gap-2">
                    {m.content ? <MarkdownContent markdown={m.content} /> : null}
                    {m.error ? (
                      <p className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
                        {t.failedTurn}: {m.error}
                      </p>
                    ) : null}
                    {m.content ? (
                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => void copy(m.id, m.content)}
                          title={t.copy}
                          aria-label={t.copy}
                          className="rounded p-1.5 text-foreground-subtle transition-colors hover:bg-surface hover:text-foreground"
                        >
                          {copiedId === m.id ? (
                            <Check className="size-3.5 text-success" />
                          ) : (
                            <Copy className="size-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={regenerate}
                          disabled={sending}
                          title={t.regenerate}
                          aria-label={t.regenerate}
                          className="rounded p-1.5 text-foreground-subtle transition-colors hover:bg-surface hover:text-foreground disabled:opacity-40"
                        >
                          <RefreshCw className="size-3.5" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                ),
              )}

              {streamed ? (
                <div className="flex flex-col gap-2">
                  <MarkdownContent markdown={streamed} />
                </div>
              ) : null}

              {status ? (
                <p className="flex items-center gap-2 text-sm text-foreground-subtle">
                  <Loader2 className="size-3.5 animate-spin" />
                  {status}
                </p>
              ) : null}
            </div>
            <div ref={bottomRef} />
          </div>
        </div>

        {!atBottom ? (
          <button
            type="button"
            onClick={() => scrollToBottom()}
            className="absolute bottom-36 left-1/2 -translate-x-1/2 rounded-full border border-border bg-surface p-2 text-foreground-muted shadow-lg transition-colors hover:border-border-strong hover:text-foreground"
            aria-label={t.jumpToBottom}
            title={t.jumpToBottom}
          >
            <ArrowDown className="size-4" />
          </button>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {/* Composer                                                          */}
        {/* ---------------------------------------------------------------- */}
        <div className="border-t border-border bg-background px-4 py-3">
          <div className="mx-auto w-full max-w-3xl">
            {error ? (
              <p className="mb-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
                {error}
              </p>
            ) : null}

            {files.length > 0 ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {files.map((f, i) => (
                  <span
                    key={`${f.name}-${i}`}
                    className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1 text-[11px] text-foreground-muted"
                  >
                    <Paperclip className="size-3" />
                    <span className="max-w-40 truncate">{f.name}</span>
                    <span className="text-foreground-faint">{formatBytes(f.size)}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      aria-label={`${t.remove} ${f.name}`}
                      className="rounded p-0.5 text-foreground-faint transition-colors hover:text-danger"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <div className="rounded-2xl border border-border bg-surface focus-within:border-border-strong">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                rows={1}
                placeholder={t.placeholder}
                className="max-h-60 w-full resize-none bg-transparent px-4 pt-3 text-sm text-foreground placeholder:text-foreground-faint focus:outline-none"
              />
              <div className="flex items-center gap-1 px-2 pb-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    addFiles(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title={t.attach}
                  aria-label={t.attach}
                  className="rounded-lg p-2 text-foreground-subtle transition-colors hover:bg-surface-elevated hover:text-foreground"
                >
                  <Paperclip className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setDeep((v) => !v)}
                  title={t.deepHint}
                  aria-pressed={deep}
                  className={`rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                    deep
                      ? "bg-accent-bg text-accent"
                      : "text-foreground-subtle hover:bg-surface-elevated hover:text-foreground"
                  }`}
                >
                  {t.deep}
                </button>
                <span className="ml-auto hidden pr-1 text-[11px] text-foreground-faint sm:block">
                  {t.enterToSend}
                </span>
                {sending ? (
                  <button
                    type="button"
                    onClick={stop}
                    title={t.stop}
                    aria-label={t.stop}
                    className="rounded-lg bg-surface-elevated p-2 text-foreground transition-colors hover:bg-border"
                  >
                    <Square className="size-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={!draft.trim() && files.length === 0}
                    title={t.send}
                    aria-label={t.send}
                    className="rounded-lg bg-accent p-2 text-background transition-opacity disabled:opacity-30"
                  >
                    <ArrowUp className="size-4" />
                  </button>
                )}
              </div>
            </div>
            <p className="mt-1.5 text-center text-[11px] text-foreground-faint">
              {t.attachmentNote}
            </p>
          </div>
        </div>

        {dragging ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-accent-border bg-accent-bg/60 backdrop-blur-sm">
            <p className="text-sm font-medium text-accent">{t.dropToAttach}</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
