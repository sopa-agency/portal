"use client";

import {
  BookOpenText,
  CalendarDays,
  ClipboardCheck,
  ClipboardCopy,
  Coins,
  FileText,
  Flame,
  Images,
  Mail,
  MessageCircleMore,
  MessageSquare,
  Loader2,
  Plus,
  Send,
  Star,
  Trash2,
} from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addCampaignArtifact,
  createDocument,
  deleteDocument,
  setCampaignDocSchedule,
} from "@/app/actions/campaigns";
import { GENERATABLE_ARTIFACTS, type GeneratableArtifactKind } from "@/lib/campaign-artifacts";
import { CampaignCalendar, type CalendarAsset } from "@/components/campaign-calendar";
import { PressBlastPanel } from "@/components/press-blast-panel";
import { CampaignArtifactActions } from "@/components/campaign-artifact-actions";
import { CampaignCarouselEditor } from "@/components/campaign-carousel-editor";
import { CampaignDocumentEditor } from "@/components/campaign-document-editor";
import { CampaignDocumentPanel } from "@/components/campaign-document-panel";
import {
  classifyCampaignDocument,
  type CampaignDocumentKind,
  type CampaignPreviewBrand,
} from "@/components/campaign-document-preview";
import { CampaignEmailEditor } from "@/components/campaign-email-editor";
import { CampaignOutreachPanel } from "@/components/campaign-outreach-panel";
import { DEFAULT_EMAIL_BRAND } from "@/lib/campaign-email";
import { CampaignGenerateBar } from "@/components/campaign-generate-bar";
import { buildClaudeDesignPrompt } from "@/lib/campaign-design-prompt";

type CampaignDocument = {
  id: string;
  name: string;
  content: string;
  isMain: boolean;
  updatedAt: Date;
  postedAt: Date | null;
  scheduledFor: Date | null;
};

const KIND_META: Record<CampaignDocumentKind, { label: string; icon: typeof Mail; tone: string }> = {
  brief:     { label: "Brief / Hive blog",       icon: FileText,          tone: "text-foreground-muted" },
  hive:      { label: "Hive snap",               icon: Flame,             tone: "text-red-400" },
  hive_mag:  { label: "Hive blog (mag post)",    icon: BookOpenText,      tone: "text-red-400" },
  farcaster: { label: "Farcaster cast",          icon: Send,              tone: "text-purple-400" },
  tweets:    { label: "Twitter / X thread",      icon: MessageCircleMore, tone: "text-foreground" },
  discord:   { label: "Discord announcement",    icon: MessageSquare,     tone: "text-indigo-400" },
  binance:   { label: "Binance Square post",     icon: Coins,             tone: "text-yellow-500" },
  instagram: { label: "Instagram carousel",      icon: Images,            tone: "text-pink-400" },
  email:     { label: "Email",                   icon: Mail,              tone: "text-accent" },
  markdown:  { label: "Markdown post",           icon: BookOpenText,      tone: "text-amber-400" },
  doc:       { label: "Document",                icon: FileText,          tone: "text-foreground-muted" },
};

export function CampaignFolderShell({
  campaignId,
  documents,
  brand,
}: {
  campaignId: string;
  documents: CampaignDocument[];
  brand?: CampaignPreviewBrand;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const enriched = useMemo(() => {
    // Brief first, then EN artifacts, then the "(PT)" translations stacked at the
    // bottom. Sort is stable, so order within each group is preserved.
    const rank = (d: CampaignDocument) => (d.isMain ? -1 : /\(pt\)/i.test(d.name) ? 1 : 0);
    return documents
      .map((d) => ({ ...d, kind: classifyCampaignDocument(d.name, d.isMain) }))
      .sort((a, b) => rank(a) - rank(b));
  }, [documents]);

  const [selectedId, setSelectedId] = useState<string | null>(() => enriched[0]?.id ?? null);
  const selected = enriched.find((d) => d.id === selectedId) ?? enriched[0] ?? null;

  // Local content override — updated after a successful remix so the preview
  // refreshes immediately without a full router.refresh().
  const [localContent, setLocalContent] = useState<Record<string, string>>({});

  const getContent = (doc: typeof enriched[number]) =>
    localContent[doc.id] ?? doc.content;

  // Build a Claude Design (claude.ai/design) prompt from this campaign's pieces
  // and copy it — turns the per-piece copy into one paste-ready image-gen brief,
  // so the campaign→images step stops being hand-written each time.
  const [promptCopied, setPromptCopied] = useState(false);
  const handleCopyDesignPrompt = async () => {
    const prompt = buildClaudeDesignPrompt({
      brandName: brand?.displayName,
      accent: brand?.accent,
      documents: enriched.map((d) => ({ name: d.name, content: getContent(d), kind: d.kind })),
    });
    try {
      await navigator.clipboard.writeText(prompt);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2000);
    } catch {
      // Clipboard blocked (e.g. insecure context) — surface the text to copy by hand.
      window.prompt("Copie o prompt para o Claude Design:", prompt);
    }
  };

  const handleNew = () => {
    const name = window.prompt("Name the document", "Untitled document");
    if (!name) return;
    startTransition(async () => {
      const result = await createDocument(campaignId, name);
      if (result.ok && result.documentId) {
        setSelectedId(result.documentId);
        router.refresh();
      }
    });
  };

  // Generate ANOTHER artifact of a chosen type from the brief (never overwrites)
  // so each can be scheduled separately. The action feeds the model the existing
  // same-kind artifacts so the new one takes a different angle. One click per type.
  const [genPending, startGen] = useTransition();
  const [pendingKind, setPendingKind] = useState<GeneratableArtifactKind | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const handleGenerate = (kind: GeneratableArtifactKind) => {
    setGenError(null);
    setPendingKind(kind);
    setGenOpen(false);
    startGen(async () => {
      const res = await addCampaignArtifact(campaignId, kind);
      if (res.ok) {
        setSelectedId(res.documentId);
        router.refresh();
      } else setGenError(res.error);
      setPendingKind(null);
    });
  };

  const handleDelete = (doc: CampaignDocument) => {
    if (doc.isMain) return;
    if (!window.confirm(`Delete "${doc.name}"?`)) return;
    startTransition(async () => {
      const result = await deleteDocument(doc.id);
      if (result.ok) {
        if (doc.id === selectedId) {
          const next = enriched.find((d) => d.id !== doc.id);
          setSelectedId(next?.id ?? null);
        }
        router.refresh();
      }
    });
  };

  const [view, setView] = useState<"files" | "calendar">("files");
  const [schedPending, startSched] = useTransition();
  const handleSchedule = (id: string, iso: string | null) => {
    startSched(async () => {
      await setCampaignDocSchedule(id, iso);
      router.refresh();
    });
  };
  const calAssets: CalendarAsset[] = enriched
    .filter((d) => !d.isMain)
    .map((d) => ({ id: d.id, name: d.name, kind: d.kind, tone: KIND_META[d.kind].tone, scheduledFor: d.scheduledFor }));

  if (!selected) {
    return <p className="text-sm text-foreground-subtle">This campaign has no documents yet.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="inline-flex gap-0.5 rounded-lg border border-border bg-surface p-0.5 text-xs">
        <button
          type="button"
          onClick={() => setView("files")}
          className={`rounded-md px-3 py-1 font-medium transition ${view === "files" ? "bg-surface-elevated text-foreground" : "text-foreground-muted hover:text-foreground"}`}
        >
          Arquivos
        </button>
        <button
          type="button"
          onClick={() => setView("calendar")}
          className={`inline-flex items-center gap-1 rounded-md px-3 py-1 font-medium transition ${view === "calendar" ? "bg-surface-elevated text-foreground" : "text-foreground-muted hover:text-foreground"}`}
        >
          <CalendarDays className="h-3.5 w-3.5" /> Calendário
        </button>
      </div>

      {view === "calendar" ? (
        <CampaignCalendar
          assets={calAssets}
          onSchedule={handleSchedule}
          onOpen={(id) => {
            setSelectedId(id);
            setView("files");
          }}
          busy={schedPending}
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="space-y-2">
        <div className="flex items-center justify-between px-2">
          <p className="text-[10px] uppercase tracking-[0.2em] text-foreground-subtle">Files</p>
          <button
            type="button"
            onClick={handleNew}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-accent hover:bg-accent-bg disabled:opacity-50"
            aria-label="New document"
          >
            <Plus className="h-3 w-3" />
            New
          </button>
        </div>
        <div className="relative px-2">
          <button
            type="button"
            onClick={() => setGenOpen((v) => !v)}
            disabled={genPending}
            title="Gera um novo post a partir do briefing, com IA — escolha o tipo"
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground-muted transition hover:border-border-strong hover:text-foreground disabled:opacity-50"
          >
            {genPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            {genPending
              ? `Gerando ${pendingKind ? GENERATABLE_ARTIFACTS.find((a) => a.kind === pendingKind)?.label : "post"}…`
              : "Gerar post ▾"}
          </button>
          {genOpen && !genPending && (
            <div className="absolute left-2 right-2 z-20 mt-1 overflow-hidden rounded-md border border-border bg-surface shadow-lg">
              {GENERATABLE_ARTIFACTS.map((a) => (
                <button
                  key={a.kind}
                  type="button"
                  onClick={() => handleGenerate(a.kind)}
                  className="block w-full px-2.5 py-1.5 text-left text-[11px] text-foreground-muted transition hover:bg-accent-bg hover:text-foreground"
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
          {genError && <p className="mt-1 text-[10px] text-danger">{genError}</p>}
        </div>
        <div className="px-2">
          <button
            type="button"
            onClick={handleCopyDesignPrompt}
            title="Monta um prompt com as peças desta campanha e copia — cole no Claude Design (claude.ai/design) para gerar as imagens"
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground-muted transition hover:border-border-strong hover:text-foreground"
          >
            {promptCopied ? (
              <ClipboardCheck className="h-3 w-3 text-success" />
            ) : (
              <ClipboardCopy className="h-3 w-3" />
            )}
            {promptCopied ? "Prompt copiado!" : "Prompt p/ Claude Design"}
          </button>
        </div>
        <ul className="max-h-[45vh] space-y-1 overflow-y-auto pr-1 lg:max-h-none lg:overflow-visible lg:pr-0">
          {enriched.map((doc) => {
            const meta = KIND_META[doc.kind];
            const Icon = doc.isMain ? Star : meta.icon;
            const active = doc.id === selected.id;
            return (
              <li key={doc.id} className="group relative">
                <button
                  type="button"
                  onClick={() => setSelectedId(doc.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition ${
                    active
                      ? "border-accent-border bg-accent-bg"
                      : "border-transparent hover:border-border hover:bg-foreground/5"
                  }`}
                  aria-pressed={active}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      active ? "text-foreground" : doc.isMain ? "text-accent/70" : meta.tone
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{doc.name}</p>
                    <p className="truncate text-[10px] uppercase tracking-[0.18em] text-foreground-subtle">
                      {meta.label}
                    </p>
                  </div>
                </button>
                {!doc.isMain && (
                  <button
                    type="button"
                    onClick={() => handleDelete(doc)}
                    disabled={pending}
                    aria-label={`Delete ${doc.name}`}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-foreground-subtle opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </aside>

      <div className="min-w-0 space-y-4">
        {selected.kind !== "brief" && (
          <a
            href={`/quick-image?caption=${encodeURIComponent(selected.content.slice(0, 1500))}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Abre o gerador de imagem (horizontal/vertical) com a legenda desta peça"
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/20"
          >
            <Images className="h-3.5 w-3.5" /> Criar imagem
          </a>
        )}
        {selected.kind === "brief" ? (
          <>
            <CampaignGenerateBar campaignId={campaignId} />
            <CampaignDocumentEditor
              key={selected.id}
              documentId={selected.id}
              initialName={selected.name}
              initialContent={selected.content}
            />
          </>
        ) : selected.kind === "markdown" ? (
          <CampaignDocumentEditor
            key={selected.id}
            documentId={selected.id}
            initialName={selected.name}
            initialContent={selected.content}
          />
        ) : selected.kind === "email" ? (
          <div className="space-y-4">
            <CampaignEmailEditor
              key={selected.id}
              documentId={selected.id}
              initialName={selected.name}
              initialContent={selected.content}
              updatedAt={selected.updatedAt}
              emailBrand={
                brand
                  ? {
                      name: brand.displayName,
                      url: brand.siteUrl ?? DEFAULT_EMAIL_BRAND.url,
                      accent: brand.accent ?? DEFAULT_EMAIL_BRAND.accent,
                      accentDark: brand.accentDark ?? DEFAULT_EMAIL_BRAND.accentDark,
                    }
                  : undefined
              }
            />
            <CampaignArtifactActions
              documentId={selected.id}
              kind="email"
              content={getContent(selected)}
              initialPostedAt={selected.postedAt}
              onContentChange={(c) => setLocalContent((prev) => ({ ...prev, [selected.id]: c }))}
            />
            <CampaignOutreachPanel campaignId={campaignId} />
          </div>
        ) : selected.kind === "hive" ||
          selected.kind === "hive_mag" ||
          selected.kind === "farcaster" ||
          selected.kind === "tweets" ||
          selected.kind === "discord" ||
          selected.kind === "binance" ? (
          <CampaignDocumentPanel
            key={selected.id}
            doc={{
              id: selected.id,
              name: selected.name,
              updatedAt: selected.updatedAt,
              postedAt: selected.postedAt,
            }}
            kind={selected.kind}
            brand={brand}
            content={getContent(selected)}
            onContentChange={(c) => setLocalContent((prev) => ({ ...prev, [selected.id]: c }))}
          />
        ) : selected.kind === "instagram" ? (
          <CampaignCarouselEditor
            key={selected.id}
            documentId={selected.id}
            initialName={selected.name}
            initialContent={selected.content}
            initialPostedAt={selected.postedAt}
            brand={brand}
            onContentChange={(c) => setLocalContent((prev) => ({ ...prev, [selected.id]: c }))}
          />
        ) : (
          <CampaignDocumentEditor
            key={selected.id}
            documentId={selected.id}
            initialName={selected.name}
            initialContent={selected.content}
          />
        )}
        {/press release/i.test(selected.name) && (
          <PressBlastPanel campaignId={campaignId} documentId={selected.id} />
        )}
      </div>
        </div>
      )}
    </div>
  );
}
