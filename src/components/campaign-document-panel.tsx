"use client";

import { useState } from "react";
import { Eye, Loader2, Pencil, ShieldCheck, TriangleAlert } from "lucide-react";
import {
  CampaignDocumentPreview,
  previewKindMeta,
  type CampaignPreviewBrand,
} from "@/components/campaign-document-preview";
import { CampaignDocumentEditor } from "@/components/campaign-document-editor";
import { CampaignArtifactActions } from "@/components/campaign-artifact-actions";
import { ageFromDate } from "@/lib/utils";
import { checkCampaignDocument } from "@/app/actions/campaigns";
import type { DraftCheck, DraftFlag } from "@/lib/draft-check";
import { useLocale } from "@/components/locale-provider";

/** Kinds that have a rich channel-accurate preview (everything but brief/email/markdown). */
type PreviewableKind = "hive" | "hive_mag" | "paragraph" | "farcaster" | "tweets" | "discord" | "binance" | "doc";

type PanelDoc = {
  id: string;
  name: string;
  updatedAt: Date;
  postedAt: Date | null;
  /** Destino registrado. Opcional porque nem todo chamador o carrega ainda; sem
   *  ele o botão do Paragraph só não destaca, nada quebra. */
  postedTo?: string | null;
  postedUrl?: string | null;
};

/**
 * One unified document card: header (name + kind + Preview/Edit toggle), body
 * (rich preview OR raw editor), and the publish/copy/remix actions in a footer
 * — all in a single bordered card instead of a preview box stacked on an
 * actions box. Editing updates shared content so the preview stays live.
 */
const CHECK_STR = {
  pt: { ok: "Fiel ao briefing", review: "Revisar", stale: "Editado depois da checagem", run: "Conferir", again: "Conferir de novo", running: "Conferindo…", flags: { number: "número", date: "data", reward: "prêmio", hype: "hype" } as Record<DraftFlag, string>, tip: "Chance de o texto trazer algo que o briefing não sustenta" },
  en: { ok: "Faithful to the brief", review: "Review", stale: "Edited after the check", run: "Check", again: "Check again", running: "Checking…", flags: { number: "number", date: "date", reward: "reward", hype: "hype" } as Record<DraftFlag, string>, tip: "Chance that the text brings something the brief does not support" },
};

/**
 * O selo da checagem contra o briefing: o gerador tem regras de "não invente", e
 * isto confere o texto que saiu (lib/draft-check.ts). Sem checagem ainda, só o
 * botão; texto editado depois, o selo cai e o botão chama de novo.
 */
function DraftCheckBadge({ documentId, initial, stale, enabled }: { documentId: string; initial: DraftCheck | null; stale: boolean; enabled: boolean }) {
  const { locale } = useLocale();
  const s = CHECK_STR[locale === "pt" ? "pt" : "en"];
  const [check, setCheck] = useState<DraftCheck | null>(initial);
  const [isStale, setIsStale] = useState(stale);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!enabled && !check) return null;
  // Estado simples em vez de transição: a ação revalida a página, e uma transição
  // deixaria o botão em "Conferindo…" até essa revalidação terminar.
  const run = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await checkCampaignDocument(documentId);
      if (r.ok) {
        setCheck(r.check);
        setIsStale(false);
      } else setError(r.error);
    } finally {
      setBusy(false);
    }
  };
  const fresh = check && !isStale;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const tip = check ? `${s.tip} — ${s.flags.number} ${pct(check.scores.number)} · ${s.flags.date} ${pct(check.scores.date)} · ${s.flags.reward} ${pct(check.scores.reward)} · ${s.flags.hype} ${check.scores.hype.toFixed(1)}/2 · ${check.model}` : undefined;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
      {fresh && check.verdict === "ok" && <span title={tip} className="inline-flex items-center gap-1 font-medium text-success"><ShieldCheck className="h-3.5 w-3.5" /> {s.ok}</span>}
      {fresh && check.verdict === "review" && <span title={tip} className="inline-flex items-center gap-1 font-medium text-warning"><TriangleAlert className="h-3.5 w-3.5" /> {s.review}: {check.flags.map((f) => s.flags[f]).join(" · ")}</span>}
      {check && isStale && <span className="text-foreground-subtle">{s.stale}</span>}
      {enabled && (
        <button type="button" onClick={() => void run()} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-elevated px-2 py-0.5 font-medium text-foreground-muted hover:border-border-strong hover:text-foreground disabled:opacity-60">
          {busy && <Loader2 className="h-3 w-3 animate-spin" />} {busy ? s.running : check ? s.again : s.run}
        </button>
      )}
      {error && <span className="text-danger">{error}</span>}
    </span>
  );
}

export function CampaignDocumentPanel({
  doc,
  kind,
  brand,
  content,
  onContentChange,
  check = null,
  checkStale = false,
  checkEnabled = false,
}: {
  doc: PanelDoc;
  kind: PreviewableKind;
  brand?: CampaignPreviewBrand;
  content: string;
  onContentChange: (content: string) => void;
  /** Checagem do rascunho contra o briefing, quando já houve uma. */
  check?: DraftCheck | null;
  checkStale?: boolean;
  checkEnabled?: boolean;
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
            {kind !== "doc" && <div className="mt-1"><DraftCheckBadge documentId={doc.id} initial={check} stale={checkStale} enabled={checkEnabled} /></div>}
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
            imageKind={kind === "doc" || kind === "binance" || kind === "paragraph" ? undefined : kind}
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
          initialPostedTo={doc.postedTo ?? null}
          initialPostedUrl={doc.postedUrl ?? null}
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
