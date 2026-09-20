"use client";

// Settings → API & MCP. Cada pessoa cria o próprio token, vê o segredo UMA vez,
// e leva para o cliente que quiser: MCP (Claude Code, Claude Desktop, Cursor…)
// ou REST. O token enxerga o que a pessoa enxerga no portal.

import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { createApiToken, myApiTokens, revokeApiToken } from "@/app/actions/api-tokens";
import type { TokenRow } from "@/lib/api-tokens";
import { useLocale } from "@/components/locale-provider";

const STR = {
  pt: {
    intro: "Um token pessoal dá ao seu agente (Claude Code, Cursor, um script) o contexto da SOPA e dos projetos: briefings, kanban, tesouro, custos, time, campanhas e as notas dos agentes. Ele enxerga o que você enxerga no portal, e só leitura.",
    newToken: "Novo token",
    namePlaceholder: "Onde vai usar (ex.: Claude Code no notebook)",
    withAgents: "Permitir perguntar aos agentes (gasta modelo; até 10 por dia)",
    create: "Criar token",
    creating: "Criando…",
    onceTitle: "Copie agora. Este token não aparece de novo.",
    copy: "Copiar",
    copied: "Copiado",
    yourTokens: "Seus tokens",
    none: "Nenhum token ainda.",
    created: "criado",
    lastUsed: "último uso",
    never: "nunca usado",
    calls: "chamadas",
    revoke: "Revogar",
    confirmRevoke: "Revogar este token? Quem usa ele para de funcionar na hora.",
    howTo: "Como conectar",
    claudeCode: "Claude Code",
    jsonClients: "Claude Desktop, Cursor e outros clientes MCP (JSON)",
    rest: "REST, para scripts",
    placeholderNote: "Os exemplos usam o token recém-criado quando ele está na tela; senão, troque SEU_TOKEN.",
    agents: "agentes",
  },
  en: {
    intro: "A personal token gives your agent (Claude Code, Cursor, a script) the context of SOPA and its projects: briefings, kanban, treasury, costs, team, campaigns and the agents' notes. It sees what you see in the portal, read-only.",
    newToken: "New token",
    namePlaceholder: "Where it will be used (e.g. Claude Code on my laptop)",
    withAgents: "Allow asking the agents (spends model budget; up to 10 a day)",
    create: "Create token",
    creating: "Creating…",
    onceTitle: "Copy it now. This token will not be shown again.",
    copy: "Copy",
    copied: "Copied",
    yourTokens: "Your tokens",
    none: "No tokens yet.",
    created: "created",
    lastUsed: "last used",
    never: "never used",
    calls: "calls",
    revoke: "Revoke",
    confirmRevoke: "Revoke this token? Whatever uses it stops working immediately.",
    howTo: "How to connect",
    claudeCode: "Claude Code",
    jsonClients: "Claude Desktop, Cursor and other MCP clients (JSON)",
    rest: "REST, for scripts",
    placeholderNote: "The examples use the token you just created while it is on screen; otherwise replace YOUR_TOKEN.",
    agents: "agents",
  },
};

function CopyBlock({ text, label, copiedLabel }: { text: string; label: string; copiedLabel: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-border bg-surface-elevated p-3 pr-20 font-mono text-[11px] leading-relaxed text-foreground">{text}</pre>
      <button
        type="button"
        onClick={() => void navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); })}
        className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-semibold text-foreground-muted hover:text-foreground"
      >
        {ok ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />} {ok ? copiedLabel : label}
      </button>
    </div>
  );
}

export function ApiAccess() {
  const { locale } = useLocale();
  const s = STR[locale === "pt" ? "pt" : "en"];
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [admin, setAdmin] = useState(false);
  const [name, setName] = useState("");
  const [withAgents, setWithAgents] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  // A origem é a do portal em que a pessoa está (cada marca tem o seu domínio).
  const origin = useSyncExternalStore(() => () => {}, () => window.location.origin, () => "https://sopa.sopa.team");

  async function load() {
    const r = await myApiTokens();
    if (r.ok) {
      setTokens(r.tokens);
      setAdmin(r.admin);
    } else setError(r.error);
  }
  useEffect(() => {
    void load();
  }, []);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const r = await createApiToken(name, withAgents);
      if (r.ok) {
        setFresh(r.token);
        setName("");
        setWithAgents(false);
        await load();
      } else setError(r.error);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    if (!window.confirm(s.confirmRevoke)) return;
    const r = await revokeApiToken(id);
    if (r.ok) await load();
    else setError(r.error);
  }

  const tk = fresh ?? (locale === "pt" ? "SEU_TOKEN" : "YOUR_TOKEN");
  const when = (iso: string) => new Date(iso).toLocaleDateString(locale === "pt" ? "pt-BR" : "en-US", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm leading-relaxed text-foreground-muted">{s.intro}</p>

      <section className="rounded-2xl border border-border bg-surface p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><Plus className="h-4 w-4 text-accent" /> {s.newToken}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={name} maxLength={60} placeholder={s.namePlaceholder} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground" />
          <button type="button" onClick={() => void create()} disabled={busy || !name.trim()} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} {busy ? s.creating : s.create}
          </button>
        </div>
        {admin && (
          <label className="mt-3 flex items-center gap-2 text-xs text-foreground-muted">
            <input type="checkbox" checked={withAgents} onChange={(e) => setWithAgents(e.target.checked)} /> {s.withAgents}
          </label>
        )}
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        {fresh && (
          <div className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-3">
            <p className="mb-2 text-xs font-semibold text-warning">{s.onceTitle}</p>
            <CopyBlock text={fresh} label={s.copy} copiedLabel={s.copied} />
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4">
        <p className="text-sm font-semibold text-foreground">{s.yourTokens}</p>
        {tokens === null ? (
          <p className="mt-3 flex items-center gap-2 text-xs text-foreground-muted"><Loader2 className="h-3 w-3 animate-spin" /> …</p>
        ) : tokens.length === 0 ? (
          <p className="mt-3 text-xs text-foreground-subtle">{s.none}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {tokens.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {t.name}
                  {t.scopes.includes("agents") && <span className="ml-2 rounded bg-accent-bg px-1.5 text-[10px] font-semibold uppercase tracking-wider text-accent">{s.agents}</span>}
                </span>
                <span className="font-mono text-xs text-foreground-subtle">{t.prefix}…</span>
                <span className="text-xs text-foreground-subtle">{s.created} {when(t.createdAt)} · {t.lastUsedAt ? `${s.lastUsed} ${when(t.lastUsedAt)}` : s.never} · {t.calls} {s.calls}</span>
                <button type="button" onClick={() => void revoke(t.id)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-danger hover:bg-surface"><Trash2 className="h-3.5 w-3.5" /> {s.revoke}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-surface p-4">
        <p className="text-sm font-semibold text-foreground">{s.howTo}</p>
        <div>
          <p className="mb-1.5 text-xs font-semibold text-foreground-muted">{s.claudeCode}</p>
          <CopyBlock label={s.copy} copiedLabel={s.copied} text={`claude mcp add --transport http sopa ${origin}/api/mcp \\\n  --header "Authorization: Bearer ${tk}"`} />
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold text-foreground-muted">{s.jsonClients}</p>
          <CopyBlock label={s.copy} copiedLabel={s.copied} text={JSON.stringify({ mcpServers: { sopa: { type: "http", url: `${origin}/api/mcp`, headers: { Authorization: `Bearer ${tk}` } } } }, null, 2)} />
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold text-foreground-muted">{s.rest}</p>
          <CopyBlock label={s.copy} copiedLabel={s.copied} text={`curl -s ${origin}/api/v1/tools -H "Authorization: Bearer ${tk}"\n\ncurl -s -X POST ${origin}/api/v1/tools/get_kanban \\\n  -H "Authorization: Bearer ${tk}" -H "content-type: application/json" \\\n  -d '{"project":"sopa","status":"Ready"}'`} />
        </div>
        <p className="text-[11px] text-foreground-subtle">{s.placeholderNote}</p>
      </section>
    </div>
  );
}
