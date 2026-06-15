"use client";

import { useState } from "react";
import { Eye, Pencil } from "lucide-react";
import {
  CampaignDocumentPreview,
  previewKindMeta,
  type CampaignPreviewBrand,
} from "@/components/campaign-document-preview";
import { CampaignDocumentEditor } from "@/components/campaign-document-editor";
import { CampaignArtifactActions } from "@/components/campaign-artifact-actions";
import { ageFromDate } from "@/lib/utils";

/** Kinds that have a rich channel-accurate preview (everything but brief/email/markdown). */
type PreviewableKind = "hive" | "hive_mag" | "farcaster" | "tweets" | "discord" | "doc";

type PanelDoc = {
  id: string;
  name: string;
  updatedAt: Date;
  postedAt: Date | null;
};

/**
 * One unified document card: header (name + kind + Preview/Edit toggle), body
 * (rich preview OR raw editor), and the publish/copy/remix actions in a footer
 * — all in a single bordered card instead of a preview box stacked on an
 * actions box. Editing updates shared content so the preview stays live.
 */
export function CampaignDocumentPanel({
  doc,
  kind,
  brand,
  content,
  onContentChange,
}: {
  doc: PanelDoc;
  kind: PreviewableKind;
  brand?: CampaignPreviewBrand;
  content: string;
  onContentChange: (content: string) => void;
}) {
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const meta = previewKindMeta(kind);
  const Icon = meta.icon;

  return (
    <section className="rounded-2xl border border-border bg-surface/70">
      {/* Header: identity + single Preview/Edit switch */}
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${meta.tone}`}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{doc.name}</p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-foreground-subtle">
              {meta.label} · Updated {ageFromDate(doc.updatedAt)}
            </p>
          </div>
        </div>
        <div role="tablist" aria-label="Document view" className="inline-flex shrink-0 rounded-lg border border-border bg-surface/70 p-0.5">
          <Tab active={mode === "preview"} onClick={() => setMode("preview")} icon={<Eye className="h-3.5 w-3.5" />} label="Preview" />
          <Tab active={mode === "edit"} onClick={() => setMode("edit")} icon={<Pencil className="h-3.5 w-3.5" />} label="Edit" />
        </div>
      </header>

      {/* Body */}
      <div className="p-5">
        {mode === "preview" ? (
          <CampaignDocumentPreview bare name={doc.name} content={content} updatedAt={doc.updatedAt} kind={kind} brand={brand} />
        ) : (
          <CampaignDocumentEditor
            key={doc.id}
            documentId={doc.id}
            initialName={doc.name}
            initialContent={content}
            editorOnly
            bare
            imageKind={kind === "doc" ? undefined : kind}
            onContentChange={onContentChange}
          />
        )}
      </div>

      {/* Footer: publish / copy / remix actions */}
      <footer className="border-t border-border px-5 py-3">
        <CampaignArtifactActions
          documentId={doc.id}
          kind={kind}
          content={content}
          initialPostedAt={doc.postedAt}
          onContentChange={onContentChange}
        />
      </footer>
    </section>
  );
}

function Tab({
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
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition ${
        active ? "bg-white/[0.08] text-foreground" : "text-foreground-subtle hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
