"use client";

import { useState } from "react";
import { Eye, Pencil } from "lucide-react";
import {
  CampaignDocumentPreview,
  type CampaignPreviewBrand,
} from "@/components/campaign-document-preview";
import { CampaignDocumentEditor } from "@/components/campaign-document-editor";
import { CampaignArtifactActions } from "@/components/campaign-artifact-actions";

/** Kinds that have a rich channel-accurate preview (everything but brief/email/markdown). */
type PreviewableKind = "hive" | "hive_mag" | "farcaster" | "tweets" | "discord" | "doc";

type PanelDoc = {
  id: string;
  name: string;
  updatedAt: Date;
  postedAt: Date | null;
};

/**
 * One unified document panel: a single Preview / Edit toggle over the rich
 * channel preview and the raw editor (instead of stacking both + a second
 * editor-preview), with the publish/copy actions underneath. Editing updates
 * the shared content so the preview reflects changes live.
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

  return (
    <div className="space-y-4">
      {/* Single Preview / Edit switch */}
      <div className="flex items-center justify-end">
        <div
          role="tablist"
          aria-label="Document view"
          className="inline-flex rounded-lg border border-border bg-surface/70 p-0.5"
        >
          <Tab active={mode === "preview"} onClick={() => setMode("preview")} icon={<Eye className="h-3.5 w-3.5" />} label="Preview" />
          <Tab active={mode === "edit"} onClick={() => setMode("edit")} icon={<Pencil className="h-3.5 w-3.5" />} label="Edit" />
        </div>
      </div>

      {mode === "preview" ? (
        <CampaignDocumentPreview
          name={doc.name}
          content={content}
          updatedAt={doc.updatedAt}
          kind={kind}
          brand={brand}
        />
      ) : (
        <CampaignDocumentEditor
          key={doc.id}
          documentId={doc.id}
          initialName={doc.name}
          initialContent={content}
          editorOnly
          onContentChange={onContentChange}
        />
      )}

      <CampaignArtifactActions
        documentId={doc.id}
        kind={kind}
        content={content}
        initialPostedAt={doc.postedAt}
        onContentChange={onContentChange}
      />
    </div>
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
