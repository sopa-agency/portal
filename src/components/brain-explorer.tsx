"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  Pin,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { MarkdownContent } from "@/components/markdown-content";

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type BrainTree = { pinned: string[]; core: string[]; folders: Record<string, string[]> };
type Resp<T> = { ok: boolean; data?: T; error?: string };

const EMPTY_TREE: BrainTree = { pinned: [], core: [], folders: {} };

const FOLDER_ORDER = ["memory", "projects", "docs", "scripts", "data", "drafts", "content", "skills"];
const FOLDER_LABELS: Record<string, string> = {
  memory: "📝 memory",
  projects: "📁 projects",
  docs: "📄 docs",
  scripts: "⚙️ scripts",
  data: "💾 data",
  drafts: "✍️ drafts",
  content: "🎬 content",
  skills: "🧩 skills",
};

function pickDefault(tree: BrainTree): string {
  const prefer = ["IDENTITY.md", "SOUL.md", "MEMORY.md", "USER.md"];
  for (const p of prefer) if (tree.core.includes(p)) return p;
  if (tree.core[0]) return tree.core[0];
  if (tree.pinned[0]) return tree.pinned[0];
  const firstFolder = Object.entries(tree.folders).find(([, files]) => files.length > 0);
  if (firstFolder) return `${firstFolder[0]}/${firstFolder[1][0]}`;
  return "";
}

export function BrainExplorer({ agentName }: { agentName: string }) {
  const [tree, setTree] = useState<BrainTree>(EMPTY_TREE);
  const [file, setFile] = useState("");
  const [serverContent, setServerContent] = useState("");
  const [draft, setDraft] = useState("");
  const [binary, setBinary] = useState(false);
  const [tab, setTab] = useState<"edit" | "view">("view");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["memory"]));

  const dirty = useMemo(() => !binary && draft !== serverContent, [binary, draft, serverContent]);
  const isMarkdown = file.endsWith(".md") || file.endsWith(".mdx");

  const loadFile = useCallback(async (f: string) => {
    setError("");
    try {
      const res = await fetch(`/api/brain/file?file=${encodeURIComponent(f)}`, { cache: "no-store" });
      const j = (await res.json()) as Resp<{ binary: boolean; content: string }>;
      if (!res.ok || !j.ok) throw new Error(j.error ?? "failed to load");
      setFile(f);
      setBinary(Boolean(j.data?.binary));
      setServerContent(j.data?.content ?? "");
      setDraft(j.data?.content ?? "");
      setTab(j.data?.binary ? "view" : f.endsWith(".md") ? "view" : "edit");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadTree = useCallback(async (): Promise<BrainTree> => {
    const res = await fetch("/api/brain/list", { cache: "no-store" });
    const j = (await res.json()) as Resp<{ tree: BrainTree }>;
    if (!res.ok || !j.ok) throw new Error(j.error ?? "failed to load brain");
    const t = j.data?.tree ?? EMPTY_TREE;
    setTree(t);
    return t;
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const t = await loadTree();
        const first = pickDefault(t);
        if (first) await loadFile(first);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [loadTree, loadFile]);

  async function switchFile(f: string) {
    if (saving) return;
    if (dirty && !confirm(`Discard unsaved changes to ${file}?`)) return;
    await loadFile(f);
  }

  async function save() {
    if (!dirty) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/brain/file", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file, content: draft }),
      });
      const j = (await res.json()) as Resp<unknown>;
      if (!res.ok || !j.ok) throw new Error(j.error ?? "failed to save");
      setServerContent(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!file) return;
    if (!confirm(`Delete ${file}? This cannot be undone.`)) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/brain/file", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file }),
      });
      const j = (await res.json()) as Resp<unknown>;
      if (!res.ok || !j.ok) throw new Error(j.error ?? "failed to delete");
      const t = await loadTree();
      const next = pickDefault(t);
      if (next) {
        await loadFile(next);
      } else {
        setFile("");
        setServerContent("");
        setDraft("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function toggleFolder(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const orderedFolders = Object.entries(tree.folders)
    .filter(([, files]) => files.length > 0)
    .sort(([a], [b]) => {
      const ai = FOLDER_ORDER.indexOf(a);
      const bi = FOLDER_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.localeCompare(b);
    });

  const fileBtn = (
    full: string,
    label: string,
    opts: { small?: boolean; pinned?: boolean } = {},
  ) => {
    const { small, pinned } = opts;
    const active = file === full;
    const Icon = pinned ? Pin : FileText;
    return (
      <button
        key={full}
        type="button"
        onClick={() => switchFile(full)}
        className={cn(
          "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors",
          small ? "text-xs" : "text-sm",
          active
            ? "bg-accent-bg font-medium text-accent"
            : pinned
              ? "border border-accent-border/40 bg-accent-bg/30 text-foreground hover:bg-accent-bg/60"
              : "text-foreground-muted hover:bg-foreground/5 hover:text-foreground",
        )}
      >
        <Icon className={cn("shrink-0", pinned ? "text-accent" : "", small ? "h-3 w-3" : "h-4 w-4")} />
        <span className="truncate">{label}</span>
        {active && dirty && (
          <span className="ml-auto rounded border border-border px-1 text-[10px] text-foreground-subtle">•</span>
        )}
      </button>
    );
  };

  return (
    <div>
      <header className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">🧠 Brain</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            Files for <span className="font-medium text-accent">{agentName}</span>. Edits write directly to the agent workspace.
          </p>
        </div>
      </header>

      {error && (
        <p className="mb-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-foreground-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading brain…
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          {/* File tree */}
          <div className="rounded-xl border border-border bg-surface p-3 lg:col-span-1">
            {tree.pinned.length > 0 && (
              <div className="mb-4">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-accent">
                  📌 Pinned
                </div>
                <div className="space-y-0.5">
                  {tree.pinned.map((f) => fileBtn(f, f.split("/").pop() ?? f, { pinned: true }))}
                </div>
              </div>
            )}
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-foreground-subtle">
              Core
            </div>
            <div className="space-y-0.5">{tree.core.map((f) => fileBtn(f, f))}</div>

            <div className="mt-4 space-y-2">
              {orderedFolders.map(([folder, files]) => {
                const open = expanded.has(folder);
                return (
                  <div key={folder}>
                    <button
                      type="button"
                      onClick={() => toggleFolder(folder)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm font-medium text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground"
                    >
                      {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                      {open ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />}
                      <span className="truncate">{FOLDER_LABELS[folder] ?? folder}</span>
                      <span className="ml-auto text-[10px] text-foreground-faint">{files.length}</span>
                    </button>
                    {open && (
                      <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-2">
                        {files.map((f) => fileBtn(`${folder}/${f}`, f, { small: true }))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Editor / preview */}
          <div className="rounded-xl border border-border bg-surface lg:col-span-3">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <span className="truncate font-mono text-sm text-foreground">{file || "—"}</span>
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg border border-border p-0.5">
                  {(["edit", "view"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTab(t)}
                      disabled={t === "edit" && binary}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors disabled:opacity-40",
                        tab === t ? "bg-accent-bg text-accent" : "text-foreground-muted hover:text-foreground",
                      )}
                    >
                      {t === "edit" ? "Edit" : "Preview"}
                    </button>
                  ))}
                </div>
                <span
                  className={cn(
                    "rounded-md px-2 py-1 text-[10px] font-medium uppercase tracking-wider",
                    dirty ? "bg-warning/10 text-warning" : "text-foreground-faint",
                  )}
                >
                  {dirty ? "unsaved" : "saved"}
                </span>
                <button
                  type="button"
                  onClick={() => loadFile(file)}
                  disabled={saving || !file}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground-muted transition-colors hover:text-foreground disabled:opacity-40"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Reload
                </button>
                <button
                  type="button"
                  onClick={del}
                  disabled={saving || !file}
                  className="flex items-center gap-1.5 rounded-lg border border-danger/30 px-2.5 py-1.5 text-xs font-medium text-danger transition hover:bg-danger/10 disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !dirty || binary}
                  className="flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-2.5 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:opacity-40"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Save
                </button>
              </div>
            </div>

            <div className="p-4">
              {binary ? (
                <div className="flex min-h-[400px] items-center justify-center rounded-lg border border-border bg-surface-elevated text-sm text-foreground-muted">
                  {serverContent}
                </div>
              ) : tab === "edit" ? (
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  spellCheck={false}
                  className="min-h-[600px] w-full resize-y rounded-lg border border-border bg-surface-elevated p-3 font-mono text-xs text-foreground focus:border-accent-border focus:outline-none focus:ring-1 focus:ring-accent/30"
                />
              ) : isMarkdown ? (
                <div className="min-h-[600px] rounded-lg border border-border bg-surface-elevated p-4">
                  <MarkdownContent markdown={draft} />
                </div>
              ) : (
                <pre className="min-h-[600px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-elevated p-4 font-mono text-xs text-foreground">
                  {draft}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
