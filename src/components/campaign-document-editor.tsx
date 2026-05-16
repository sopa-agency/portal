"use client";

import { Eye, Pencil } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { renameDocument, updateDocumentContent } from "@/app/actions/campaigns";
import { MarkdownContent } from "@/components/markdown-content";

type Mode = "edit" | "preview";

export function CampaignDocumentEditor({
  documentId,
  initialName,
  initialContent,
}: {
  documentId: string;
  initialName: string;
  initialContent: string;
}) {
  const [name, setName] = useState(initialName);
  const [content, setContent] = useState(initialContent);
  const [mode, setMode] = useState<Mode>("edit");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [, startTransition] = useTransition();
  const savedContentRef = useRef(initialContent);
  const savedNameRef = useRef(initialName);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (content === savedContentRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setStatus("saving");
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const next = content;
        await updateDocumentContent(documentId, next);
        savedContentRef.current = next;
        setStatus("saved");
        setTimeout(() => setStatus("idle"), 1200);
      });
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [content, documentId]);

  return (
    <div className="rounded-2xl border border-border bg-surface/70 p-5">
      <div className="flex items-center justify-between gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() === savedNameRef.current) return;
            startTransition(async () => {
              await renameDocument(documentId, name);
              savedNameRef.current = name.trim() || "Untitled";
            });
          }}
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-foreground outline-none focus:ring-0"
          aria-label="Document name"
        />
        <ModeToggle mode={mode} onChange={setMode} />
        <span className="w-16 text-right text-[11px] text-foreground-subtle" aria-live="polite">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : ""}
        </span>
      </div>

      {mode === "edit" ? (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write the brief here. What's the goal, who's it for, what's the angle?"
          className="mt-4 min-h-[70vh] w-full resize-y rounded-xl border border-border bg-black/30 px-4 py-3 text-[14px] leading-7 text-foreground outline-none focus:border-accent-border focus:ring-1 focus:ring-lime-400/20"
        />
      ) : (
        <div className="mt-4 min-h-[70vh] rounded-xl border border-border bg-black/20 px-4 py-3">
          {content.trim() ? (
            <MarkdownContent markdown={content} />
          ) : (
            <p className="text-sm text-foreground-subtle">
              Nothing to preview yet. Switch back to Edit to start writing.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (next: Mode) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Document mode"
      className="inline-flex rounded-lg border border-border bg-surface/70 p-0.5"
    >
      <ToggleButton
        active={mode === "edit"}
        onClick={() => onChange("edit")}
        icon={<Pencil className="h-3.5 w-3.5" />}
        label="Edit"
      />
      <ToggleButton
        active={mode === "preview"}
        onClick={() => onChange("preview")}
        icon={<Eye className="h-3.5 w-3.5" />}
        label="Preview"
      />
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
        active ? "bg-white/[0.08] text-foreground" : "text-foreground-subtle hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
